"""
Тести меж доби та правила закриття дня.

Саме тут найдорожча помилка в розділі навчання: StudyDayModel заморожує
is_goal_met назавжди, тож день, зарахований не в ту дату, таким і лишиться.
БД для цих перевірок не потрібна — логіка навмисно винесена чистими функціями.
"""

from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo

import pytest
from app.database.models import GoalModeEnum
from app.services.study_day import (
    is_goal_met,
    local_day,
    local_day_bounds,
    resolve_timezone,
)

KYIV = ZoneInfo("Europe/Kyiv")


def met_separate(*, new_added: int, reviews_done: int, new_goal: int, review_goal: int):
    """Цілі приходять зі знімка дня, тож сумарної в цьому дні просто немає."""
    return is_goal_met(
        new_added=new_added,
        reviews_done=reviews_done,
        goal_mode=GoalModeEnum.SEPARATE,
        new_goal=new_goal,
        review_goal=review_goal,
        combined_goal=None,
    )


def met_combined(*, new_added: int, reviews_done: int, combined_goal: int):
    return is_goal_met(
        new_added=new_added,
        reviews_done=reviews_done,
        goal_mode=GoalModeEnum.COMBINED,
        new_goal=None,
        review_goal=None,
        combined_goal=combined_goal,
    )


class TestLocalDay:
    def test_night_session_counts_as_the_new_day(self):
        """00:30 за Києвом — це 21:30 UTC учорашнього дня, але день сьогоднішній."""
        moment = datetime(2026, 7, 27, 21, 30, tzinfo=timezone.utc)
        assert local_day(moment, KYIV) == date(2026, 7, 28)

    def test_evening_session_stays_in_its_day(self):
        moment = datetime(2026, 7, 27, 18, 0, tzinfo=timezone.utc)
        assert local_day(moment, KYIV) == date(2026, 7, 27)

    def test_utc_would_have_answered_differently(self):
        """Свідчення того, що пояс тут не косметика."""
        moment = datetime(2026, 7, 27, 21, 30, tzinfo=timezone.utc)
        assert local_day(moment, ZoneInfo("UTC")) == date(2026, 7, 27)
        assert local_day(moment, KYIV) == date(2026, 7, 28)


class TestLocalDayBounds:
    def test_summer_day_starts_at_21_utc(self):
        start, end = local_day_bounds(date(2026, 7, 28), KYIV)
        assert start == datetime(2026, 7, 27, 21, 0, tzinfo=timezone.utc)
        assert end == datetime(2026, 7, 28, 21, 0, tzinfo=timezone.utc)

    def test_winter_day_starts_at_22_utc(self):
        start, end = local_day_bounds(date(2026, 1, 15), KYIV)
        assert start == datetime(2026, 1, 14, 22, 0, tzinfo=timezone.utc)
        assert end == datetime(2026, 1, 15, 22, 0, tzinfo=timezone.utc)

    def test_dst_forward_day_is_23_hours(self):
        """
        Перехід на літній час: доба коротша. Тому кінець рахується як опівніч
        наступної дати в поясі, а не «плюс 24 години».
        """
        start, end = local_day_bounds(date(2026, 3, 29), KYIV)
        assert (end - start).total_seconds() == 23 * 3600

    def test_dst_back_day_is_25_hours(self):
        start, end = local_day_bounds(date(2026, 10, 25), KYIV)
        assert (end - start).total_seconds() == 25 * 3600

    def test_bounds_are_half_open_and_adjacent(self):
        """Кінець доби дорівнює початку наступної — жодна відповідь не губиться."""
        _, end = local_day_bounds(date(2026, 7, 28), KYIV)
        next_start, _ = local_day_bounds(date(2026, 7, 29), KYIV)
        assert end == next_start


class TestResolveTimezone:
    def test_known_name(self):
        assert resolve_timezone("Asia/Tokyo") == ZoneInfo("Asia/Tokyo")

    @pytest.mark.parametrize("value", ["", None, "Middle/Earth", "не пояс"])
    def test_garbage_falls_back_instead_of_raising(self, value):
        """
        Колонка timezone — вільний String(64). Падати з 500 на кожному
        натисканні оцінки через одруківку не можна.
        """
        assert resolve_timezone(value) == ZoneInfo("Europe/Kyiv")


class TestIsGoalMetSeparate:
    def test_both_goals_required(self):
        assert not met_separate(new_added=0, reviews_done=30, new_goal=10, review_goal=30)
        assert not met_separate(new_added=10, reviews_done=5, new_goal=10, review_goal=30)
        assert met_separate(new_added=10, reviews_done=30, new_goal=10, review_goal=30)

    def test_exceeding_a_goal_still_counts(self):
        assert met_separate(new_added=99, reviews_done=99, new_goal=10, review_goal=30)

    def test_zero_goal_is_considered_satisfied(self):
        assert met_separate(new_added=0, reviews_done=30, new_goal=0, review_goal=30)

    def test_both_goals_zero_means_the_day_does_not_count(self):
        """Правило зі старого PWA: без жодної цілі день не зараховується."""
        assert not met_separate(new_added=99, reviews_done=99, new_goal=0, review_goal=0)


class TestIsGoalMetCombined:
    def test_split_between_the_two_counters_does_not_matter(self):
        """Сто повторень і сто доданих слів закривають ту саму ціль."""
        assert met_combined(new_added=0, reviews_done=100, combined_goal=100)
        assert met_combined(new_added=100, reviews_done=0, combined_goal=100)
        assert met_combined(new_added=45, reviews_done=55, combined_goal=100)

    def test_sum_below_the_goal_does_not_close_the_day(self):
        assert not met_combined(new_added=45, reviews_done=54, combined_goal=100)

    def test_word_added_and_studied_the_same_day_counts_twice(self):
        """
        ADR-0032, і це свідомо: додати слово й повторити слово — різні роботи.

        День із 30 прострочених доріжок плюс 10 доданих і одразу провчених слів
        дає new_added=10 і reviews_done=40, тобто 50 одиниць при сорока різних
        картках.
        """
        assert met_combined(new_added=10, reviews_done=40, combined_goal=50)

    def test_zero_goal_means_the_day_does_not_count(self):
        """Те саме правило, що й в окремому режимі: дня без цілі не існує."""
        assert not met_combined(new_added=999, reviews_done=999, combined_goal=0)
