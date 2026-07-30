"""
Логіка Бібліотеки, яку можна перевірити без бази.

Тут два небезпечні переходи, і оба тихі, якщо помилитись.

**Список → знімок.** Втратити тут поле означає віддати людям каліку: вона
візьме список, а в ньому не буде транскрипцій — і дізнається про це через тиждень
навчання. Тому знімок збирається не руками по полях, а через ті самі схеми, якими
API вже віддає чужий список: забути поле можна в одному місці, а не в двох.

**Знімок → власна картка.** Дзеркальний бік. Помилка тут коштує ще дорожче, бо
результат потрапляє в чужий словник назавжди.

Обидва переходи наскрізь чисті: жодного запиту, жодної сесії. Круди й роути
приносять дані й забирають готові об'єкти — так само, як у services/sharing.py.
"""

from typing import Sequence

from app.database.models import (
    CardModel,
    PublicationCardModel,
    SenseExampleModel,
    WordFormModel,
    WordSenseModel,
    normalize_word,
)
from app.schemas.library import SnapshotContentSchema
from app.schemas.sharing import ImportMode
from app.services.sharing import ImportPlan, plan_import


# --------------------------------------------------------------------------
# Список → знімок
# --------------------------------------------------------------------------


def snapshot_content(card: CardModel) -> dict:
    """
    Вміст однієї картки у вигляді, який ляже в `publication_cards.content`.

    Через Pydantic, а не збиранням словників руками: SnapshotContentSchema —
    це той самий SharedSenseSchema / SharedFormSchema, яким API вже віддає чужу
    картку. Отже нове поле картки (скажімо, ще одна транскрипція) з'явиться в
    знімку саме тоді, коли з'явиться у відповіді, і забути його в одному з двох
    місць неможливо.

    `mode="json"` обов'язковий: без нього PartOfSpeechEnum поїхав би в JSONB
    об'єктом enum, а не рядком «v», і asyncpg упреться в нього при вставці.

    ВИКЛИКАЧ мусить принести картку з уже завантаженими `senses` (разом із
    `examples`) і `forms`. Тут вони читаються синхронно, і в async-сесії
    незавантажена колекція падає з MissingGreenlet — причому вже посеред
    публікації, коли рядок publications уже вставлено.
    """
    return SnapshotContentSchema(
        senses=card.senses, forms=card.forms
    ).model_dump(mode="json")


def snapshot_rows(cards: Sequence[CardModel]) -> list[PublicationCardModel]:
    """
    Знімок списку — рядки, готові до вставки.

    Порядок фіксується `position` у момент зняття і далі не залежить ні від чого:
    читач публікації мусить бачити стабільний порядок між сторінками, інакше
    друга сторінка перекривалася б із першою.

    Який саме порядок — вирішує ВИКЛИКАЧ, і він передає картки вже впорядкованими.
    На практиці це `sharing_crud.fetch_list_cards`, тобто **новіші зверху** — той
    самий порядок, у якому список бачить і власник у словнику, і отримувач шеру.
    Це свідомо: одна й та сама група слів не мусить показуватись у трьох різних
    порядках залежно від того, яким шляхом до неї дійшли.

    Наслідок, який варто знати: зразок слів на витрині — це остання четвірка, яку
    автор додав, а не «ядро» списку. Вибирати «представніші» слова ми не
    беремося: серед слів найкращих не буває, а випадкові змінювались би при
    кожному оновленні сторінки.

    `word_normalized` пишеться явно, а не через `@validates`, як у CardModel:
    PublicationCardModel не має того валідатора навмисно, бо знімок нічого не
    нормалізує від себе — він переносить те, що вже нормалізував словник.
    """
    return [
        PublicationCardModel(
            position=position,
            word=card.word,
            word_normalized=normalize_word(card.word),
            comment=card.comment,
            content=snapshot_content(card),
        )
        for position, card in enumerate(cards)
    ]


# --------------------------------------------------------------------------
# Знімок → власна картка
# --------------------------------------------------------------------------


def card_from_snapshot(row: PublicationCardModel, user_id: int) -> CardModel:
    """
    Власна картка за рядком знімка.

    Дзеркало `new_card` зі services/sharing.py, і розбіжності між ними свідомі
    лише в джерелі — CardModel там, JSON тут. Правила ті самі:

    * `forms_drill_enabled` лишається дефолтним True, а не береться з чужого:
      автор міг вимкнути тренування форм собі, і тягти це рішення в чужий
      словник немає підстав. У знімку його й немає — це налаштування навчання,
      а не вміст;
    * доріжки не створюються тут — ними керує роут через `ensure_tracks`, як і
      при звичайному створенні картки.

    Діти перестворюються, а не звіряються: id у знімку немає взагалі, і це
    навмисно (див. схеми шерингу).
    """
    content = SnapshotContentSchema.model_validate(row.content or {})

    card = CardModel(word=row.word, user_id=user_id)
    card.comment = row.comment

    for position, sense in enumerate(content.senses):
        copy = WordSenseModel(
            position=position,
            part_of_speech=sense.part_of_speech,
            translation=sense.translation,
            transcription=sense.transcription,
        )
        for example_position, example in enumerate(sense.examples):
            copy.examples.append(
                SenseExampleModel(
                    position=example_position,
                    text_en=example.text_en,
                    text_uk=example.text_uk,
                )
            )
        card.senses.append(copy)

    for position, form in enumerate(content.forms):
        card.forms.append(
            WordFormModel(
                position=position,
                label=form.label,
                value=form.value,
                transcription=form.transcription,
            )
        )

    return card


def plan_take(
    snapshot: Sequence[PublicationCardModel],
    existing: dict[str, CardModel],
) -> ImportPlan[PublicationCardModel]:
    """
    Що станеться при взятті: які слова додадуться, які пропустяться.

    Це `plan_import` у режимі SKIP, і іншого режиму тут не буває — тому окремої
    логіки немає, а є ім'я для домену. Дублювати звірку заборонено: саме там
    вирішується, чи чуже може зачепити твої картки.

    `overwrites` у результаті завжди порожній. Роут на нього не дивиться, але
    краще, щоб він був порожнім за побудовою, ніж щоб хтось колись поклав туди
    сенс.
    """
    return plan_import(snapshot, existing, ImportMode.SKIP)


# Поріг видимості рейтингу тут НЕ обчислюється, і це навмисно.
#
# Витрина сортує за рейтингом у базі, з LIMIT/OFFSET, — тож поріг мусить діяти
# всередині запиту, інакше «4.9 з однієї оцінки» ставало б першим попри нього.
# Отже правило живе єдиним SQL-виразом (`cruds/library._VISIBLE_RATING`), який іде
# і в SELECT, і в ORDER BY. Друга, пітонівська реалізація тут виглядала б
# доречною й була б мертвою: показане число приходить із бази.
#
# Спільне в них одне — саме число порогу, RATING_VISIBILITY_THRESHOLD у моделях.
