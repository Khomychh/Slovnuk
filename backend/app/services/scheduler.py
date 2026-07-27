"""
Сервіс планувальника FSRS.

Чиста логіка: побудова fsrs.Scheduler із персональних параметрів користувача
і мапінг ReviewTrackModel <-> fsrs.Card. Жодної сесії БД тут немає — читання й
запис рядків (разом із блокуванням і транзакцією) робить роут.
"""

import logging
from datetime import datetime, timezone

from fsrs import Card, Rating, Scheduler, State

from app.database.models import ReviewStateEnum, ReviewTrackModel, UserSettingsModel

logger = logging.getLogger(__name__)

# fsrs.State не має власного "New" — NEW у нашій моделі мапиться в Learning
# зі step=0, так само як трактує це py-fsrs для щойно створеної Card.
_STATE_TO_FSRS = {
    ReviewStateEnum.NEW: State.Learning,
    ReviewStateEnum.LEARNING: State.Learning,
    ReviewStateEnum.REVIEW: State.Review,
    ReviewStateEnum.RELEARNING: State.Relearning,
}
_FSRS_TO_STATE = {
    State.Learning: ReviewStateEnum.LEARNING,
    State.Review: ReviewStateEnum.REVIEW,
    State.Relearning: ReviewStateEnum.RELEARNING,
}


def build_scheduler(settings: UserSettingsModel) -> Scheduler:
    """
    Кроки навчання — дефолтні бібліотечні (1 хв, 10 хв для нових,
    10 хв для забутих). Явно не передаємо, щоб не розходитись
    із бібліотекою при оновленні (ADR-0002).
    """
    common = dict(desired_retention=settings.desired_retention)
    if settings.fsrs_parameters:
        try:
            return Scheduler(parameters=settings.fsrs_parameters, **common)
        except ValueError:
            # Параметри застаріли після оновлення py-fsrs або вийшли за межі.
            # Тихо відкочуємось на дефолти, інакше ляже кожне натискання
            # оцінки, а не лише оптимізація. Деталі — ADR-0002.
            logger.warning(
                "fsrs_parameters відкинуто для user_id=%s, беремо дефолтні",
                settings.user_id,
            )
    return Scheduler(**common)


def track_to_card(track: ReviewTrackModel) -> Card:
    return Card(
        card_id=track.id,
        state=_STATE_TO_FSRS[track.state],
        step=track.step,
        stability=track.stability,
        difficulty=track.difficulty,
        due=track.due_at,
        last_review=track.last_reviewed_at,
    )


def apply_card_to_track(track: ReviewTrackModel, card: Card) -> None:
    """Записує результат review_card назад у рядок доріжки."""
    track.state = _FSRS_TO_STATE[card.state]
    track.step = card.step
    track.stability = card.stability
    track.difficulty = card.difficulty
    track.due_at = card.due
    track.last_reviewed_at = card.last_review


def review_track(
    track: ReviewTrackModel,
    settings: UserSettingsModel,
    rating: Rating,
    review_datetime: datetime | None = None,
    review_duration: int | None = None,
) -> ReviewStateEnum:
    """
    Оцінює доріжку й одразу застосовує результат до track (мутація на
    місці — track лишається persistent-об'єктом сесії виклику).

    Повертає стан доріжки ДО цієї відповіді — саме те, що йде в
    ReviewLogModel.state_before, бо його не можна відновити заднім числом.
    """
    if review_datetime is None:
        review_datetime = datetime.now(timezone.utc)

    state_before = track.state
    scheduler = build_scheduler(settings)
    card = track_to_card(track)
    card, _ = scheduler.review_card(
        card,
        rating,
        review_datetime=review_datetime,
        review_duration=review_duration,
    )
    apply_card_to_track(track, card)
    return state_before
