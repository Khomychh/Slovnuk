"""
Підбір персональних параметрів планувальника з історії повторень.

Оптимізатор — не сервіс, а разова дія: порахував, записав 21 число, вимкнувся.
Тому він живе тут, а не в API, і запускається руками з машини розробника
(ADR-0002). Застосунок про нього не знає нічого — лише читає готові числа з
`user_settings.fsrs_parameters`.

Запуск — з хоста, як ai_access.py (див. README, розділ 4). Спершу треба
доставити важкі залежності в той самий venv бекенда:

    pip install -r requirements-optimizer.txt      # torch, ~2.5 ГБ, надовго

    cd backend
    python -m scripts.optimize_parameters --email me@x.com            # тільки звіт
    python -m scripts.optimize_parameters --email me@x.com --write    # і записати

**Без `--write` не пишеться нічого.** Оптимізатор при нестачі даних не кидає
помилку, а мовчки повертає дефолти (`fsrs/optimizer.py:249-251`), тож
автоматичний запис перетворив би `fsrs_parameters` з чесного індикатора
(«NULL = ще не підбирали») на пастку: у колонці лежали б загальні числа під
виглядом персональних.

З тієї ж причини `--write` **відмовляється** писати результат, який дорівнює
`DEFAULT_PARAMETERS`. Обхідного прапорця немає навмисно: можливість записати
дефолти — це та сама пастка, просто у два кроки.

Чому скрипт не рахує сам, скільки повторень «зараховано»: поріг у 512 живе
всередині бібліотеки й рахує не всі відповіді, а лише ті, де від попереднього
показу тієї самої доріжки минула хоча б доба (`fsrs/optimizer.py:200-206`) —
перший показ картки не зараховується ніколи. Дублювати цей критерій означало б
тримати другу правду, яка розійдеться з бібліотекою при першому ж оновленні.
Тому перевірка «чи вистачило даних» одна — звірка результату з дефолтами.

Обидві доріжки, перекладу і форм, ідуть у **спільний** набір: карткою для
оптимізатора є доріжка, а розділяти ваги, поки на форми припадає шоста частина
записів, — значить лишити форми на загальних дефолтах іще на рік (ADR-0002).
"""

import argparse
import asyncio
import sys
from importlib.metadata import PackageNotFoundError, version as package_version

from fsrs import Rating, ReviewLog, Scheduler
from fsrs.scheduler import DEFAULT_PARAMETERS
from sqlalchemy import select

from app.database.database import async_session_maker
from app.database.models import (
    ReviewLogModel,
    UserModel,
    UserSettingsModel,
)


# Поріг `compute_optimal_retention`: 512 сирих записів і жодного без тривалості
# (`fsrs/optimizer.py:631-643`). Сам виклик поки не робиться — він повертає одне
# з шести фіксованих значень, тобто грубу сітку проти повзунка в налаштуваннях.
# Але дані під нього збираються з першого дня, бо заднім числом їх не буде, і
# звіт має відповідати на питання «чи вже є з чим приходити».
RETENTION_MIN_LOGS = 512


async def _load_logs(session, user_id: int) -> list[ReviewLogModel]:
    stmt = (
        select(ReviewLogModel)
        .where(ReviewLogModel.user_id == user_id)
        .order_by(ReviewLogModel.reviewed_at)
    )
    return list((await session.execute(stmt)).scalars())


def _to_fsrs(rows: list[ReviewLogModel]) -> list[ReviewLog]:
    """
    Одна відповідь — один ReviewLog. Карткою для оптимізатора є **доріжка**:
    він групує записи за card_id і програє історію кожної групи з чистого
    fsrs.Card, тож track_id тут і є той card_id.

    Записи без тривалості не відкидаються: підбору ваг вона не потрібна взагалі
    (`review_duration=None` іде в модель як є), а потрібна вона лише
    пам'ятливості, яку тут не рахуємо.
    """
    return [
        ReviewLog(
            card_id=row.track_id,
            rating=Rating(row.rating),
            review_datetime=row.reviewed_at,
            review_duration=row.review_duration,
        )
        for row in rows
    ]


def _fsrs_major() -> int | None:
    """
    Мажорна версія алгоритму — 6 для py-fsrs 6.x. Не константа в коді: вона має
    значення рівно тоді, коли бібліотеку оновили, і захардкоджене число саме в
    цей момент розійшлося б із дійсністю. Кількість ваг сюди не пишеться — її
    видно з довжини списку.
    """
    try:
        return int(package_version("fsrs").split(".")[0])
    except (PackageNotFoundError, ValueError):
        return None


def _report_data(rows: list[ReviewLogModel]) -> None:
    tracks = {row.track_id for row in rows}
    untimed = sum(1 for row in rows if row.review_duration is None)

    print("Дані")
    print(f"  записів повторень:    {len(rows)}")
    print(f"  доріжок з історією:   {len(tracks)}")
    print(
        f"  період:               "
        f"{rows[0].reviewed_at:%Y-%m-%d} … {rows[-1].reviewed_at:%Y-%m-%d}"
    )
    print(f"  з них без тривалості: {untimed}")

    # Готовність до пам'ятливості — окремим рядком, бо вимоги в неї інші й
    # суворіші: не «досить довгих інтервалів», а «жодного пропуску секундоміра».
    if len(rows) < RETENTION_MIN_LOGS:
        retention_ready = f"ще ні (треба {RETENTION_MIN_LOGS} записів)"
    elif untimed:
        retention_ready = f"ще ні ({untimed} записів без тривалості)"
    else:
        retention_ready = "так"
    print(f"  вистачає на підбір пам'ятливості: {retention_ready}")
    print()


def _report_parameters(current: list[float] | None, new: list[float]) -> None:
    """
    Порівняння порядкове, тож воно має сенс лише при однаковій довжині. У FSRS-5
    ваг було 19, у FSRS-6 стало 21 — і збережений набір із минулої мажорної
    версії зіставляти з новим не можна взагалі: під тим самим номером у них
    різні величини. У такому разі показуємо різницю з дефолтами й кажемо про це
    вголос, бо саме це й є привід для перезапуску підбору.
    """
    if current and len(current) != len(new):
        print(
            f"Збережено {len(current)} ваг, підібрано {len(new)} — набір із іншої\n"
            f"версії алгоритму, порівнювати їх поштучно немає сенсу. Нижче — різниця\n"
            f"з дефолтними."
        )
        current = None

    baseline = current if current else list(DEFAULT_PARAMETERS)
    label = "збережені" if current else "дефолтні"

    print(f"Ваги ({label} → підібрані)")
    for i, (was, now) in enumerate(zip(baseline, new)):
        delta = now - was
        mark = " " if abs(delta) < 1e-9 else "*"
        print(f"  {i:>2}  {was:>9.4f}  →  {now:>9.4f}   {delta:>+9.4f} {mark}")
    print()


async def run(email: str, write: bool) -> int:
    # Імпорт саме тут, а не вгорі файлу: `from fsrs import Optimizer` тягне
    # torch, і без нього скрипт має падати з людською порадою, а не з
    # ModuleNotFoundError посеред стеку.
    try:
        from fsrs import Optimizer
    except ImportError:
        print(
            "Немає залежностей оптимізатора. Постав їх у venv бекенда:\n"
            "    pip install -r requirements-optimizer.txt",
            file=sys.stderr,
        )
        return 1

    async with async_session_maker() as session:
        user_id = (
            await session.execute(
                select(UserModel.id).where(UserModel.email == email.strip().lower())
            )
        ).scalar_one_or_none()
        if user_id is None:
            print(f"Користувача {email} немає.", file=sys.stderr)
            return 1

        settings = (
            await session.execute(
                select(UserSettingsModel).where(UserSettingsModel.user_id == user_id)
            )
        ).scalar_one_or_none()
        if settings is None:
            print(f"У {email} немає налаштувань — акаунт зламаний.", file=sys.stderr)
            return 1

        rows = await _load_logs(session, user_id)
        if not rows:
            print(f"У {email} ще немає жодного повторення.")
            return 0

        print(f"{email}\n")
        _report_data(rows)

        # Довга частина: на кількох тисячах записів це хвилини. verbose=True
        # малює прогрес — скрипт запускається руками, і мовчазні п'ять хвилин
        # виглядали б як зависання.
        optimized = Optimizer(_to_fsrs(rows)).compute_optimal_parameters(verbose=True)
        print()

        _report_parameters(settings.fsrs_parameters, optimized)

        if optimized == list(DEFAULT_PARAMETERS):
            print(
                "Даних не вистачило: оптимізатор повернув дефолти без змін.\n"
                "Це не помилка — просто ще рано. Порогом є 512 повторень, у яких\n"
                "від попереднього показу тієї самої доріжки минула хоча б доба."
            )
            if write:
                print(
                    "\nЗаписувати нічого: дефолти в колонці виглядали б як персональні "
                    "числа, а NULL чесно каже «ще не підбирали».",
                    file=sys.stderr,
                )
                return 1
            return 0

        if not write:
            print("Щоб записати ці числа, запусти ще раз із --write.")
            return 0

        # Останній запобіжник перед записом. Застосунок при негодящих числах не
        # падає, а тихо відкочується на дефолти й пише в лог (ADR-0002) — тобто
        # навчання просто стало б трохи гіршим, і ніхто б цього не помітив.
        # Тут та сама валідація коштує мілісекунду й каже вголос.
        try:
            Scheduler(parameters=optimized)
        except ValueError as error:
            print(
                f"Підібрані числа не приймає сам планувальник: {error}\n"
                "Не записую — застосунок мовчки відкотився б на дефолти.",
                file=sys.stderr,
            )
            return 1

        settings.fsrs_parameters = optimized
        settings.fsrs_parameters_version = _fsrs_major()
        await session.commit()
        print(
            f"Записано: {len(optimized)} ваг, версія алгоритму "
            f"{settings.fsrs_parameters_version}.\n"
            "Діють із наступної відповіді; уже заплановані інтервали не перераховуються."
        )
        return 0


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--email", required=True, help="Кому підбираємо параметри.")
    parser.add_argument(
        "--write",
        action="store_true",
        help="Записати підібрані ваги в user_settings. Без прапорця — лише звіт.",
    )
    args = parser.parse_args()
    sys.exit(asyncio.run(run(args.email, args.write)))


if __name__ == "__main__":
    main()
