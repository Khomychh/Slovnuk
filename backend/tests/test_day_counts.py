"""
Звірка двох реалізацій «доби користувача».

Їх справді дві, і це усвідомлений компроміс. /today/ рахує одну добу через
чисті Python-функції (local_day_bounds), а календар групує всю історію одним
GROUP BY на боці Postgres — інакше «за весь час» коштувало б два запити на
кожен день історії. Обидві спираються на базу поясів IANA, але це РІЗНІ бази:
у Python вона з пакета tzdata, у Postgres — своя, вбудована.

Розійтися вони можуть тихо: користувач побачить в /today/ одне число, а в
календарі за той самий день інше. Тому тут вони пришпилені одна до одної на
найгіршому дні — переході на літній/зимовий час, коли доба триває 23 або 25
годин.

Потрібна жива база (docker compose up -d postgres). Без неї тест пропускається,
а не падає: решта набору навмисно працює без БД.
"""

from datetime import date, datetime, timedelta, timezone

import pytest
from sqlalchemy import func, literal, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.config.dependencies import get_settings
from app.services.study_day import local_day, local_day_bounds, resolve_timezone

# Київ переходить на літній час в останню неділю березня (доба 23 години) і на
# зимовий — в останню неділю жовтня (доба 25 годин).
DST_DAYS = [date(2026, 3, 29), date(2026, 10, 25)]
ORDINARY_DAYS = [date(2026, 1, 15), date(2026, 7, 16)]

TIMEZONES = ["Europe/Kyiv", "UTC", "America/New_York", "Asia/Tokyo"]


@pytest.fixture
async def session():
    engine = create_async_engine(get_settings().DATABASE_URL)
    try:
        async with engine.connect() as connection:
            await connection.execute(select(literal(1)))
    except Exception as exc:  # noqa: BLE001 — причина не важлива, важливий факт
        await engine.dispose()
        pytest.skip(f"Немає доступу до бази: {exc}")

    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as opened:
        yield opened
    await engine.dispose()


async def _postgres_local_day(session, moment: datetime, tz_name: str) -> date:
    """Те саме перетворення, що робить cruds.study._local_date."""
    stmt = select(func.date(func.timezone(tz_name, literal(moment))))
    return (await session.execute(stmt)).scalar_one()


@pytest.mark.parametrize("tz_name", TIMEZONES)
@pytest.mark.parametrize("day", DST_DAYS + ORDINARY_DAYS)
async def test_postgres_and_python_agree_on_day_bounds(session, tz_name, day):
    """
    Момент рівно на початку доби належить їй, момент за мить до кінця — теж, а
    сам кінець — уже наступній. Саме на цих трьох точках і розходяться межі.
    """
    tz = resolve_timezone(tz_name)
    start, end = local_day_bounds(day, tz)

    assert await _postgres_local_day(session, start, tz_name) == day
    assert await _postgres_local_day(session, end - timedelta(seconds=1), tz_name) == day
    assert await _postgres_local_day(session, end, tz_name) == day + timedelta(days=1)


@pytest.mark.parametrize("tz_name", TIMEZONES)
@pytest.mark.parametrize("day", DST_DAYS)
async def test_dst_day_is_not_24_hours(session, tz_name, day):
    """
    Захист від «полагодження» local_day_bounds на start + 24 години.

    Для Києва ці дні тривають 23 і 25 годин. Для UTC і Токіо переходу немає й
    доба рівно 24 — перевіряємо лише, що Python і Postgres згодні між собою.
    """
    tz = resolve_timezone(tz_name)
    start, end = local_day_bounds(day, tz)

    assert await _postgres_local_day(session, start, tz_name) == day
    assert await _postgres_local_day(session, end, tz_name) == day + timedelta(days=1)

    if tz_name == "Europe/Kyiv":
        assert end - start != timedelta(hours=24)


@pytest.mark.parametrize("tz_name", TIMEZONES)
async def test_midnight_crossing_belongs_to_the_local_day(session, tz_name):
    """
    Повторення о 00:30 за Києвом — це 21:30 UTC попередньої доби, і день
    навчання має бути сьогоднішній. Класична помилка «рахуємо за UTC».
    """
    tz = resolve_timezone(tz_name)
    moment = datetime(2026, 7, 16, 21, 30, tzinfo=timezone.utc)

    assert await _postgres_local_day(session, moment, tz_name) == local_day(moment, tz)
