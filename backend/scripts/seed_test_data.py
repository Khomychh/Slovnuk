"""
Наповнення бази тестовими даними для ручного тестування й розробки.

На відміну від scripts/import_legacy.py (який був одноразовим і вже прибраний
після переносу 608 карток), цей скрипт багаторазовий: заводить одного
повнофункціонального тестового користувача плюс кількох "читачів" для
Бібліотеки, і його можна перезапускати з --reset скільки завгодно.

Дані не вигадані з нуля рядок за рядком — де є готова доменна логіка, скрипт
іде через неї, а не дублює: нові картки отримують доріжки повторень через
ensure_tracks (services/vocabulary.py), історія повторень прогнана через
справжній review_track (services/scheduler.py) — тож stability/difficulty/due_at
такі самі, якими їх порахував би реальний FSRS-планувальник під час навчання,
а не випадкові числа. Знімок для Бібліотеки зібраний через snapshot_rows
(services/library.py) — той самий код, яким API готує чужий список.

Запуск — з хоста, як import_legacy.py (див. README, розділ 4): venv бекенда
вже має всі залежності, а .env лежить у корені репозиторію.

    cd backend
    python -m scripts.seed_test_data
    python -m scripts.seed_test_data --reset          # спочатку прибрати попередній прогін
    python -m scripts.seed_test_data --email me@x.com --password Test1234!

Без --reset скрипт відмовляється писати поверх наявного тестового акаунта —
щоб повторний запуск не наплодив других "go"/"child"/... і не впав на
UNIQUE(user_id, word_normalized).
"""

import argparse
import asyncio
import random
import sys
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from fsrs import Rating
from sqlalchemy import delete, select

from app.database.database import async_session_maker
from app.database.models import (
    CardListLinkModel,
    CardModel,
    DEFAULT_DAILY_NEW_GOAL,
    DEFAULT_DAILY_REVIEW_GOAL,
    DEFAULT_DESIRED_RETENTION,
    GrammarNoteModel,
    NoteCategoryModel,
    PartOfSpeechEnum,
    PublicationModel,
    PublicationRatingModel,
    PublicationTakeModel,
    ReviewLogModel,
    ReviewTrackModel,
    SenseExampleModel,
    StudyDayModel,
    UserGroupEnum,
    UserGroupModel,
    UserModel,
    UserProfileModel,
    UserSettingsModel,
    WordFormModel,
    WordListModel,
    WordSenseModel,
)
from app.services.library import snapshot_rows
from app.services.scheduler import review_track
from app.services.vocabulary import ensure_tracks

TAKER_PASSWORD = "TakerPass123!"
TAKER_COUNT = 3  # = RATING_VISIBILITY_THRESHOLD, щоб одразу перевірити й межу видимості рейтингу

# Рейтинги відповіді трохи зсунуті в бік "добре": так виглядає реальна історія
# людини, яка вчить слова не вперше, а не свіжий акаунт із суцільними AGAIN.
RATING_WEIGHTS = {1: 0.10, 2: 0.15, 3: 0.47, 4: 0.28}  # Again, Hard, Good, Easy


# ----------------------------------------------------------------------------
# Словник для карток
# ----------------------------------------------------------------------------


@dataclass(frozen=True)
class SenseSeed:
    pos: PartOfSpeechEnum
    translation: str
    transcription: str
    examples: tuple[tuple[str, str], ...]


@dataclass(frozen=True)
class CardSeed:
    word: str
    senses: tuple[SenseSeed, ...]
    forms: tuple[tuple[str, str, str | None], ...] = ()
    list_group: str = "other"  # ключ у WORD_LISTS
    theme: str | None = None  # додаткова тематична позначка ("travel" / "work")
    comment: str | None = None
    drill_enabled: bool = True


CARDS: tuple[CardSeed, ...] = (
    # --- неправильні дієслова -------------------------------------------------
    CardSeed("go", (SenseSeed(PartOfSpeechEnum.VERB, "йти; їхати", "/ɡəʊ/",
        (("I go to work by bus.", "Я їжджу на роботу автобусом."),)),),
        (("Past Simple", "went", "/wɛnt/"), ("Past Participle", "gone", "/ɡɒn/")), "verbs"),
    CardSeed("be", (SenseSeed(PartOfSpeechEnum.VERB, "бути", "/biː/",
        (("She is a doctor.", "Вона лікарка."),)),),
        (("Past Simple", "was / were", "/wɒz/ /wɜː/"), ("Past Participle", "been", "/biːn/")), "verbs"),
    CardSeed("take", (SenseSeed(PartOfSpeechEnum.VERB, "брати; займати (час)", "/teɪk/",
        (("It takes an hour to get there.", "Туди їхати годину."),)),),
        (("Past Simple", "took", "/tʊk/"), ("Past Participle", "taken", "/ˈteɪkən/")), "verbs"),
    CardSeed("see", (SenseSeed(PartOfSpeechEnum.VERB, "бачити", "/siː/",
        (("I see what you mean.", "Розумію, про що ти."),)),),
        (("Past Simple", "saw", "/sɔː/"), ("Past Participle", "seen", "/siːn/")), "verbs"),
    CardSeed("eat", (SenseSeed(PartOfSpeechEnum.VERB, "їсти", "/iːt/",
        (("We ate at a small café.", "Ми поїли в маленькому кафе."),)),),
        (("Past Simple", "ate", "/eɪt/"), ("Past Participle", "eaten", "/ˈiːtn/")), "verbs"),
    CardSeed("buy", (SenseSeed(PartOfSpeechEnum.VERB, "купувати", "/baɪ/",
        (("He bought a new laptop.", "Він купив новий ноутбук."),)),),
        (("Past Simple", "bought", "/bɔːt/"), ("Past Participle", "bought", "/bɔːt/")), "verbs"),
    CardSeed("break", (SenseSeed(PartOfSpeechEnum.VERB, "ламати; порушувати", "/breɪk/",
        (("Don't break the rules.", "Не порушуй правил."),)),),
        (("Past Simple", "broke", "/brəʊk/"), ("Past Participle", "broken", "/ˈbrəʊkən/")), "verbs"),
    CardSeed("choose", (SenseSeed(PartOfSpeechEnum.VERB, "обирати", "/tʃuːz/",
        (("You can choose either option.", "Можеш обрати будь-який варіант."),)),),
        (("Past Simple", "chose", "/tʃəʊz/"), ("Past Participle", "chosen", "/ˈtʃəʊzən/")), "verbs"),
    CardSeed("speak", (SenseSeed(PartOfSpeechEnum.VERB, "говорити", "/spiːk/",
        (("Do you speak Ukrainian?", "Ти розмовляєш українською?"),)),),
        (("Past Simple", "spoke", "/spəʊk/"), ("Past Participle", "spoken", "/ˈspəʊkən/")), "verbs"),
    CardSeed("write", (SenseSeed(PartOfSpeechEnum.VERB, "писати", "/raɪt/",
        (("She wrote a short story.", "Вона написала оповідання."),)),),
        (("Past Simple", "wrote", "/rəʊt/"), ("Past Participle", "written", "/ˈrɪtn/")), "verbs"),
    CardSeed("begin", (SenseSeed(PartOfSpeechEnum.VERB, "починати", "/bɪˈɡɪn/",
        (("The meeting begins at 9.", "Зустріч починається о 9."),)),),
        (("Past Simple", "began", "/bɪˈɡæn/"), ("Past Participle", "begun", "/bɪˈɡʌn/")), "verbs", "work"),
    CardSeed("forget", (SenseSeed(PartOfSpeechEnum.VERB, "забувати", "/fəˈɡɛt/",
        (("I forgot my passport at home.", "Я забув паспорт удома."),)),),
        (("Past Simple", "forgot", "/fəˈɡɒt/"), ("Past Participle", "forgotten", "/fəˈɡɒtn/")), "verbs", "travel"),

    # --- регулярні дієслова ----------------------------------------------------
    CardSeed("travel", (SenseSeed(PartOfSpeechEnum.VERB, "подорожувати", "/ˈtrævl/",
        (("We travelled across three countries.", "Ми проїхали три країни."),)),), (), "verbs", "travel"),
    CardSeed("arrive", (SenseSeed(PartOfSpeechEnum.VERB, "прибувати", "/əˈraɪv/",
        (("The train arrives at noon.", "Потяг прибуває опівдні."),)),), (), "verbs", "travel"),
    CardSeed("negotiate", (SenseSeed(PartOfSpeechEnum.VERB, "вести переговори", "/nɪˈɡəʊʃieɪt/",
        (("They negotiated a better price.", "Вони домовились про кращу ціну."),)),), (), "verbs", "work"),
    CardSeed("postpone", (SenseSeed(PartOfSpeechEnum.VERB, "відкладати", "/pəʊstˈpəʊn/",
        (("Let's postpone the call till Friday.", "Перенесімо дзвінок на пʼятницю."),)),), (), "verbs", "work"),
    CardSeed("borrow", (SenseSeed(PartOfSpeechEnum.VERB, "позичати (у когось)", "/ˈbɒrəʊ/",
        (("Can I borrow your pen?", "Можна позичити ручку?"),)),), (), "verbs"),

    # --- іменники ---------------------------------------------------------------
    CardSeed("child", (SenseSeed(PartOfSpeechEnum.NOUN, "дитина", "/tʃaɪld/",
        (("Every child needs attention.", "Кожній дитині потрібна увага."),)),),
        (("Plural", "children", "/ˈtʃɪldrən/"),), "nouns", drill_enabled=False),
    CardSeed("mouse", (
        SenseSeed(PartOfSpeechEnum.NOUN, "миша (тварина)", "/maʊs/", (("A mouse ran across the floor.", "Миша пробігла по підлозі."),)),
        SenseSeed(PartOfSpeechEnum.NOUN, "мишка (комп'ютерна)", "/maʊs/", (("My mouse stopped working.", "Моя мишка перестала працювати."),)),
    ), (("Plural", "mice", "/maɪs/"),), "nouns", drill_enabled=False,
        comment="Два значення — тваринка й пристрій, множина стосується лише тваринки."),
    CardSeed("airport", (SenseSeed(PartOfSpeechEnum.NOUN, "аеропорт", "/ˈeəpɔːt/",
        (("We landed at a small airport.", "Ми приземлились у маленькому аеропорту."),)),), (), "nouns", "travel"),
    CardSeed("passport", (SenseSeed(PartOfSpeechEnum.NOUN, "паспорт", "/ˈpɑːspɔːt/",
        (("Check your passport is still valid.", "Перевір, чи паспорт ще дійсний."),)),), (), "nouns", "travel"),
    CardSeed("luggage", (SenseSeed(PartOfSpeechEnum.NOUN, "багаж", "/ˈlʌɡɪdʒ/",
        (("Our luggage didn't arrive.", "Наш багаж не приїхав."),)),), (), "nouns", "travel"),
    CardSeed("journey", (SenseSeed(PartOfSpeechEnum.NOUN, "подорож, поїздка", "/ˈdʒɜːni/",
        (("It was a long journey.", "Це була довга подорож."),)),), (), "nouns", "travel"),
    CardSeed("colleague", (SenseSeed(PartOfSpeechEnum.NOUN, "колега", "/ˈkɒliːɡ/",
        (("My colleague is on vacation.", "Мій колега у відпустці."),)),), (), "nouns", "work"),
    CardSeed("deadline", (SenseSeed(PartOfSpeechEnum.NOUN, "дедлайн, кінцевий термін", "/ˈdɛdlaɪn/",
        (("We're close to the deadline.", "Дедлайн вже скоро."),)),), (), "nouns", "work"),
    CardSeed("salary", (SenseSeed(PartOfSpeechEnum.NOUN, "зарплата", "/ˈsæləri/",
        (("She got a salary raise.", "Їй підвищили зарплату."),)),), (), "nouns", "work"),
    CardSeed("meeting", (SenseSeed(PartOfSpeechEnum.NOUN, "зустріч, нарада", "/ˈmiːtɪŋ/",
        (("The meeting ran late.", "Нарада затягнулась."),)),), (), "nouns", "work"),
    CardSeed("receipt", (SenseSeed(PartOfSpeechEnum.NOUN, "чек, квитанція", "/rɪˈsiːt/",
        (("Keep the receipt just in case.", "Збережи чек про всяк випадок."),)),), (), "nouns"),
    CardSeed("refund", (SenseSeed(PartOfSpeechEnum.NOUN, "повернення коштів", "/ˈriːfʌnd/",
        (("They gave me a full refund.", "Мені повністю повернули гроші."),)),), (), "nouns"),

    # --- прикметники / прислівники ----------------------------------------------
    CardSeed("exhausted", (SenseSeed(PartOfSpeechEnum.ADJECTIVE, "виснажений", "/ɪɡˈzɔːstɪd/",
        (("I'm exhausted after the flight.", "Я виснажений після перельоту."),)),), (), "other", "travel"),
    CardSeed("reliable", (SenseSeed(PartOfSpeechEnum.ADJECTIVE, "надійний", "/rɪˈlaɪəbl/",
        (("He's a reliable colleague.", "Він надійний колега."),)),), (), "other", "work"),
    CardSeed("fluent", (SenseSeed(PartOfSpeechEnum.ADJECTIVE, "вільний, швидкий (про мовлення)", "/ˈfluːənt/",
        (("She's fluent in three languages.", "Вона вільно говорить трьома мовами."),)),), (), "other"),
    CardSeed("thoroughly", (SenseSeed(PartOfSpeechEnum.ADVERB, "ретельно", "/ˈθʌrəli/",
        (("Check the contract thoroughly.", "Ретельно перевір контракт."),)),), (), "other", "work"),
    CardSeed("eventually", (SenseSeed(PartOfSpeechEnum.ADVERB, "врешті-решт", "/ɪˈvɛntʃuəli/",
        (("We eventually found the hotel.", "Ми врешті-решт знайшли готель."),)),), (), "other", "travel"),

    # --- прийменники --------------------------------------------------------------
    CardSeed("among", (SenseSeed(PartOfSpeechEnum.PREPOSITION, "серед", "/əˈmʌŋ/",
        (("She felt at home among friends.", "Вона почувалась як удома серед друзів."),)),), (), "other"),
    CardSeed("beneath", (SenseSeed(PartOfSpeechEnum.PREPOSITION, "під, унизу", "/bɪˈniːθ/",
        (("The cat is beneath the table.", "Кіт сидить під столом."),)),), (), "other"),

    # --- фрази -----------------------------------------------------------------
    CardSeed("by the way", (SenseSeed(PartOfSpeechEnum.PHRASE, "до речі", "",
        (("By the way, did you call her?", "До речі, ти їй дзвонив?"),)),), (), "phrases"),
    CardSeed("in a nutshell", (SenseSeed(PartOfSpeechEnum.PHRASE, "коротко кажучи", "",
        (("In a nutshell, the plan failed.", "Коротко кажучи, план провалився."),)),), (), "phrases"),
    CardSeed("as soon as possible", (SenseSeed(PartOfSpeechEnum.PHRASE, "якнайшвидше", "",
        (("Send it as soon as possible.", "Надішли це якнайшвидше."),)),), (), "phrases", "work"),
    CardSeed("on second thought", (SenseSeed(PartOfSpeechEnum.PHRASE, "якщо подумати ще раз", "",
        (("On second thought, let's stay home.", "Якщо подумати, лишімось удома."),)),), (), "phrases"),
    CardSeed("get the hang of", (SenseSeed(PartOfSpeechEnum.PHRASE, "навчитися, розібратися (з чимось)", "",
        (("You'll get the hang of it soon.", "Ти скоро це освоїш."),)),), (), "phrases"),
)

WORD_LISTS: dict[str, str] = {
    "verbs": "Дієслова",
    "nouns": "Іменники",
    "other": "Прикметники, прислівники і прийменники",
    "phrases": "Фрази",
}
THEME_LISTS: dict[str, str] = {
    "travel": "Подорожі",
    "work": "Робота",
}

GRAMMAR_NOTES: dict[str, tuple[tuple[str, str], ...]] = {
    "Часи": (
        (
            "Present Perfect vs Past Simple",
            "**Present Perfect** — результат важливий зараз: `I have lost my keys` "
            "(і досі їх не знайшов).\n\n**Past Simple** — просто факт у минулому, "
            "час указано або малося на увазі: `I lost my keys yesterday`.",
        ),
        (
            "used to / would",
            "Обидва — про звичку в минулому, якої вже немає.\n\n"
            "`used to` годиться і для станів, і для дій: `I used to live there`.\n\n"
            "`would` — лише для повторюваних дій: `We would meet every Friday`.",
        ),
    ),
    "Прийменники": (
        (
            "at / in / on — час",
            "- `at` — точний момент: `at 6 pm`, `at night`\n"
            "- `in` — місяці, роки, пори року: `in July`, `in 2026`\n"
            "- `on` — дні й дати: `on Monday`, `on July 31st`",
        ),
    ),
}


# ----------------------------------------------------------------------------
# Допоміжне
# ----------------------------------------------------------------------------


def _new_settings() -> UserSettingsModel:
    """
    Явно проставлені дефолти, а не покладання на server_default колонок:
    об'єкт іде в build_scheduler/StudyDayModel ще ДО flush, коли значення
    server_default в базу ще не підставлені й атрибут — просто None.
    """
    return UserSettingsModel(
        daily_new_goal=DEFAULT_DAILY_NEW_GOAL,
        daily_review_goal=DEFAULT_DAILY_REVIEW_GOAL,
        desired_retention=DEFAULT_DESIRED_RETENTION,
    )


def _pick_rating() -> int:
    values, weights = zip(*RATING_WEIGHTS.items())
    return random.choices(values, weights=weights, k=1)[0]


def _simulate_history(
    track: ReviewTrackModel,
    user: UserModel,
    settings: UserSettingsModel,
    now: datetime,
    days_history: int,
) -> None:
    """
    Прогнати доріжку через СПРАВЖНІЙ review_track заднім числом.

    Так track.stability/difficulty/due_at виходять такими, якими їх порахував
    би планувальник під час реального навчання, а не вигаданими для вигляду
    числами. Наступна відповідь завжди приходить рівно тоді, коли доріжка мала
    показатись — це найпростіше правдоподібне припущення про читача, який не
    пропускає повторень.
    """
    t = now - timedelta(days=random.uniform(1, days_history))
    for _ in range(random.randint(1, 5)):
        if t > now:
            return
        rating = _pick_rating()
        duration = random.randint(900, 6000)
        state_before = review_track(
            track=track,
            settings=settings,
            rating=Rating(rating),
            review_datetime=t,
            review_duration=duration,
        )
        ReviewLogModel(
            rating=rating,
            reviewed_at=t,
            review_duration=duration,
            state_before=state_before,
            due_at_after=track.due_at,
            track=track,
            user=user,
        )
        t = track.due_at


def _build_card(seed: CardSeed, now: datetime) -> CardModel:
    card = CardModel(
        word=seed.word,
        comment=seed.comment,
        forms_drill_enabled=seed.drill_enabled,
        created_at=now - timedelta(days=random.uniform(0, 45)),
    )
    for sense in seed.senses:
        sense_row = WordSenseModel(
            part_of_speech=sense.pos,
            translation=sense.translation,
            transcription=sense.transcription or None,
        )
        for text_en, text_uk in sense.examples:
            sense_row.examples.append(SenseExampleModel(text_en=text_en, text_uk=text_uk))
        card.senses.append(sense_row)
    for label, value, transcription in seed.forms:
        card.forms.append(WordFormModel(label=label, value=value, transcription=transcription))
    ensure_tracks(card, now)
    return card


@dataclass
class SeedSummary:
    lists: int = 0
    cards: int = 0
    tracks_with_history: int = 0
    logs: int = 0
    study_days: int = 0
    grammar_notes: int = 0
    takers: int = 0


async def seed_primary_user(
    db,
    email: str,
    password: str,
    days_history: int,
    with_library: bool,
) -> tuple[UserModel, SeedSummary]:
    summary = SeedSummary()
    now = datetime.now(timezone.utc)

    group_id = (
        await db.execute(select(UserGroupModel.id).where(UserGroupModel.name == UserGroupEnum.USER))
    ).scalar_one()

    user = UserModel.create(email=email, raw_password=password, group_id=group_id)
    user.is_active = True
    user.profile = UserProfileModel(first_name="Тест", last_name="Тестовий")
    settings = _new_settings()
    user.settings = settings

    lists_by_name: dict[str, WordListModel] = {}
    for position, name in enumerate((*WORD_LISTS.values(), *THEME_LISTS.values())):
        word_list = WordListModel(name=name, position=position)
        user.word_lists.append(word_list)
        lists_by_name[name] = word_list
    summary.lists = len(lists_by_name)

    cards_by_list: dict[str, list[CardModel]] = {name: [] for name in lists_by_name}

    for seed in CARDS:
        card = _build_card(seed, now)
        user.cards.append(card)
        summary.cards += 1

        # ~15% карток лишаються навмисно без списку — так само, як буває в
        # реальному словнику, і саме цю групу перевіряє "Без списку".
        if random.random() >= 0.15:
            primary_list = WORD_LISTS[seed.list_group]
            card.list_links.append(CardListLinkModel(word_list=lists_by_name[primary_list]))
            cards_by_list[primary_list].append(card)

        if seed.theme:
            theme_list = THEME_LISTS[seed.theme]
            card.list_links.append(CardListLinkModel(word_list=lists_by_name[theme_list]))
            cards_by_list[theme_list].append(card)

        for track in card.review_tracks:
            if random.random() < 0.75:
                _simulate_history(track, user, settings, now, days_history)
                summary.tracks_with_history += 1
                summary.logs += len(track.logs)

    for i in range(days_history, -1, -1):
        day = (now - timedelta(days=i)).date()
        is_goal_met = i > 0 and random.random() < 0.7
        user.study_days.append(
            StudyDayModel(
                day=day,
                new_goal=settings.daily_new_goal,
                review_goal=settings.daily_review_goal,
                is_goal_met=is_goal_met,
            )
        )
        summary.study_days += 1

    for category_name, notes in GRAMMAR_NOTES.items():
        category = NoteCategoryModel(name=category_name, position=len(user.note_categories))
        user.note_categories.append(category)
        for position, (title, body) in enumerate(notes):
            note = GrammarNoteModel(title=title, body_markdown=body, position=position)
            category.notes.append(note)
            user.grammar_notes.append(note)
            summary.grammar_notes += 1

    if with_library:
        publish_list = THEME_LISTS["travel"]
        publish_cards = list(reversed(cards_by_list[publish_list]))  # новіші зверху, як у списку
        publication = PublicationModel(
            title=f"{publish_list} — стартовий набір",
            description="Тестова публікація для перевірки Бібліотеки.",
            is_listed=True,
            owner=user,
            word_list=lists_by_name[publish_list],
            cards=snapshot_rows(publish_cards),
        )
        db.add(publication)

        for i in range(TAKER_COUNT):
            taker = UserModel.create(
                email=f"{email.split('@')[0]}.taker{i + 1}@{email.split('@')[1]}",
                raw_password=TAKER_PASSWORD,
                group_id=group_id,
            )
            taker.is_active = True
            taker.settings = _new_settings()
            db.add(taker)
            db.add(PublicationTakeModel(publication=publication, user=taker))
            db.add(PublicationRatingModel(publication=publication, user=taker, stars=[5, 4, 5][i]))
            summary.takers += 1

    db.add(user)
    return user, summary


async def wipe_existing(db, emails: list[str]) -> None:
    await db.execute(delete(UserModel).where(UserModel.email.in_(emails)))
    await db.commit()


def taker_emails(email: str) -> list[str]:
    local, domain = email.split("@", 1)
    return [f"{local}.taker{i + 1}@{domain}" for i in range(TAKER_COUNT)]


async def run(args: argparse.Namespace) -> int:
    all_emails = [args.email] + ([] if args.skip_library else taker_emails(args.email))

    async with async_session_maker() as db:
        existing = (
            await db.execute(select(UserModel.email).where(UserModel.email.in_(all_emails)))
        ).scalars().all()

        if existing and not args.reset:
            print(
                "Уже є користувачі з такою поштою: " + ", ".join(existing) + ".\n"
                "Запусти з --reset, якщо хочеш перезаповнити дані.",
                file=sys.stderr,
            )
            return 1

        if existing:
            await wipe_existing(db, all_emails)

        user, summary = await seed_primary_user(
            db,
            email=args.email,
            password=args.password,
            days_history=args.days_history,
            with_library=not args.skip_library,
        )
        await db.commit()

    print("Готово.")
    print(f"  Акаунт: {args.email} / {args.password}")
    print(f"  Списків: {summary.lists}, карток: {summary.cards}")
    print(f"  Доріжок з історією: {summary.tracks_with_history}, записів повторень: {summary.logs}")
    print(f"  Днів навчання: {summary.study_days}, граматичних нотаток: {summary.grammar_notes}")
    if not args.skip_library:
        print(f"  Публікація в Бібліотеці + {summary.takers} читачів, які її взяли й оцінили")
        print(f"    (пароль читачів: {TAKER_PASSWORD})")
    return 0


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--email", default="test@example.com")
    parser.add_argument("--password", default="TestPass123!")
    parser.add_argument("--reset", action="store_true", help="Спершу видалити наявні тестові акаунти з такою поштою.")
    parser.add_argument("--days-history", type=int, default=21, help="Глибина історії повторень і днів навчання.")
    parser.add_argument("--skip-library", action="store_true", help="Не публікувати список і не заводити читачів.")
    args = parser.parse_args()

    exit_code = asyncio.run(run(args))
    sys.exit(exit_code)


if __name__ == "__main__":
    main()
