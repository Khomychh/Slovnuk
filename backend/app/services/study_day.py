"""
Доба користувача й підсумок дня навчання.

Чисті функції без БД: у який день користувача потрапив момент часу, які межі
в UTC має та доба і чи виконані цілі. Винесено окремо саме тому, що
StudyDayModel заморожує результат назавжди — помилка тут не самовиправляється,
і перерахувати заднім числом уже нічого не вийде.
"""

import logging
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from app.database.models import DEFAULT_TIMEZONE

logger = logging.getLogger(__name__)


def resolve_timezone(name: str | None) -> ZoneInfo:
    """
    Пояс користувача або дефолтний, якщо в налаштуваннях сміття.

    `user_settings.timezone` — вільний String(64), тож туди може потрапити
    будь-що. Падати з 500 на кожному натисканні оцінки через одруківку в
    налаштуваннях гірше, ніж порахувати день за київським поясом.
    """
    if not name:
        return ZoneInfo(DEFAULT_TIMEZONE)
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        logger.warning("Невідомий часовий пояс %r, беремо %s", name, DEFAULT_TIMEZONE)
        return ZoneInfo(DEFAULT_TIMEZONE)


def local_day(moment: datetime, tz: ZoneInfo) -> date:
    """
    Дата, до якої момент належить з погляду користувача.

    Повторення о 00:30 за Києвом — це 21:30 UTC попередньої доби, і день
    навчання має бути саме сьогоднішній, а не вчорашній.
    """
    return moment.astimezone(tz).date()


def local_day_bounds(day: date, tz: ZoneInfo) -> tuple[datetime, datetime]:
    """
    Півінтервал [початок, кінець) доби користувача, виражений в UTC.

    Кінець рахується як опівніч наступної дати в тому ж поясі, а не «плюс 24
    години»: у дні переходу на літній час доба триває 23 або 25 годин.
    """
    start_local = datetime.combine(day, time.min, tzinfo=tz)
    end_local = datetime.combine(day + timedelta(days=1), time.min, tzinfo=tz)
    return start_local.astimezone(timezone.utc), end_local.astimezone(timezone.utc)


def is_goal_met(
    *,
    new_added: int,
    reviews_done: int,
    new_goal: int,
    review_goal: int,
) -> bool:
    """
    Чи закритий день. Правило те саме, що в старому PWA (goalMetToday):
    виконаними мають бути ОБИДВІ цілі, ціль 0 вважається виконаною, але якщо
    обидві цілі нульові — день не зараховується взагалі.
    """
    if new_goal <= 0 and review_goal <= 0:
        return False
    ok_new = new_goal <= 0 or new_added >= new_goal
    ok_review = review_goal <= 0 or reviews_done >= review_goal
    return ok_new and ok_review
