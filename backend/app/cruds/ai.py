"""Запити до ai_access та ai_requests."""

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database.models import (
    AiAccessModel,
    AiRequestModel,
    AiRequestOutcomeEnum,
    TranscriptionVarietyEnum,
    UserSettingsModel,
    normalize_word,
)


# Звернення, які палять слово: модель дала повноцінну відповідь про цей текст —
# заповнила картку або сказала, що заповнювати нічого. ERROR сюди не входить:
# за таймаут людина не відповідає.
SPENDING_OUTCOMES = (AiRequestOutcomeEnum.PROPOSAL, AiRequestOutcomeEnum.REFUSAL)


async def has_ai_access(db: AsyncSession, user_id: int) -> bool:
    """Рядок є — доступ є. Іншого стану немає."""
    stmt = select(AiAccessModel.user_id).where(AiAccessModel.user_id == user_id)
    return (await db.execute(stmt)).scalar_one_or_none() is not None


async def get_transcription_variety(
    db: AsyncSession, user_id: int
) -> TranscriptionVarietyEnum:
    """
    Якою системою писати транскрипцію цій людині.

    Окремим запитом, а не через `current_user.settings`: залежність автентифікації
    вантажить лише group, тож звернення до settings було б лінивим — а лінивого
    завантаження в async-сесії не буває, воно падає з MissingGreenlet.
    """
    stmt = select(UserSettingsModel.transcription_variety).where(
        UserSettingsModel.user_id == user_id
    )
    return (await db.execute(stmt)).scalar_one()


async def word_already_filled(db: AsyncSession, user_id: int, word: str) -> bool:
    """
    Чи вже зверталися до ШІ по це слово.

    Ключ — normalize_word(), той самий, що тримає UNIQUE(user_id,
    word_normalized) на картках: «Run» і «run » — одне слово і тут, і там.
    Виправлена описка ключ міняє, тобто дає нове право на звернення.
    """
    stmt = (
        select(AiRequestModel.id)
        .where(
            AiRequestModel.user_id == user_id,
            AiRequestModel.word_normalized == normalize_word(word),
            AiRequestModel.outcome.in_(SPENDING_OUTCOMES),
        )
        .limit(1)
    )
    return (await db.execute(stmt)).scalar_one_or_none() is not None


async def record_request(
    db: AsyncSession,
    *,
    user_id: int,
    word: str,
    model: str,
    outcome: AiRequestOutcomeEnum,
    input_tokens: int | None = None,
    output_tokens: int | None = None,
    error_code: str | None = None,
) -> AiRequestModel:
    """
    Записати звернення. Викликається завжди — і на успіх, і на невдачу.

    Комітити тут не можна: рішення, коли фіксувати, належить роуту, і воно там
    одне на обидві гілки.
    """
    request = AiRequestModel(
        user_id=user_id,
        word=word,
        word_normalized=normalize_word(word),
        model=model,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        outcome=outcome,
        error_code=error_code,
    )
    db.add(request)
    await db.flush()
    return request


async def usage_by_user(db: AsyncSession, user_id: int) -> tuple[int, int]:
    """
    Скільки звернень усього і скільки слів заповнено. Для команди `list`.

    Два різні числа навмисно: перше — про витрати (невдачі теж коштували
    вхідних токенів), друге — про користь.
    """
    stmt = select(
        func.count(AiRequestModel.id),
        func.count(AiRequestModel.id).filter(
            AiRequestModel.outcome == AiRequestOutcomeEnum.PROPOSAL
        ),
    ).where(AiRequestModel.user_id == user_id)
    total, filled = (await db.execute(stmt)).one()
    return total, filled
