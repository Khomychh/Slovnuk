"""
Заповнення картки з ШІ.

Окремий модуль, а не гілка у vocabulary.py, і причина не в охайності: цей роут
не торкається словника взагалі (ADR-0027). Він не читає карток, не пише в них і
не знає, чи існує картка для цього слова. Поруч із десятьма роутами, які всі
працюють із базою словника, один такий читався б як виняток замість правила.

Рубильник ключа теж накриває модуль цілком, а не окремі роути в чужому.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.config.dependencies import get_ai_client
from app.cruds import ai as ai_crud
from app.database.database import get_db
from app.database.models import AiRequestOutcomeEnum, UserModel
from app.exceptions.ai import BaseAiError
from app.integrations import AiClientInterface
from app.schemas.ai import AiProposalRequestSchema, AiProposalSchema
from app.security.dependencies import get_current_authenticated_user
from app.services.ai import mark_ai_comment

router = APIRouter()


@router.post(
    "/proposals/",
    response_model=AiProposalSchema,
    summary="Propose card content for a word",
    description=(
        "Returns senses, forms and (rarely) a comment for the given word. "
        "Nothing is written to the vocabulary — the proposal is filled into the "
        "form and saved by the person."
    ),
    status_code=status.HTTP_200_OK,
    responses={
        403: {"description": "The user has no AI access."},
        409: {"description": "This word has already been filled once."},
        422: {"description": "Not an English word — nothing to propose."},
        502: {"description": "Claude failed or did not answer."},
        503: {"description": "No API key on this server: the feature is absent."},
    },
)
async def propose_card(
    payload: AiProposalRequestSchema,
    current_user: UserModel = Depends(get_current_authenticated_user),
    ai_client: AiClientInterface | None = Depends(get_ai_client),
    db: AsyncSession = Depends(get_db),
) -> AiProposalSchema:
    """
    Пропозиція для одного слова.

    Порядок перевірок не випадковий — від найдешевшої до найдорожчої, і жодна
    з них не витрачає грошей після того, як попередня відмовила:

    1. 503 — ключа на сервері немає, фічі тут не існує;
    2. 403 — привілею в цієї людини немає;
    3. 409 — це слово вже заповнювали;
    4. і лише тепер — звернення до Claude.

    Слово в базу не потрапляє нічим, окрім рядка журналу: у словнику після
    цього виклику не змінюється нічого.
    """
    if ai_client is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "code": "ai_not_configured",
                "message": "AI features are not configured on this server.",
            },
        )

    if not await ai_crud.has_ai_access(db, current_user.id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": "ai_access_denied", "message": "No AI access."},
        )

    if await ai_crud.word_already_filled(db, current_user.id, payload.word):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "ai_word_already_filled",
                "message": "This word has already been filled with AI once.",
            },
        )

    # Преференція завантажується перед викликом: клієнт має знати, якою системою
    # писати транскрипцію, ще до того, як складе промпт.
    variety = await ai_crud.get_transcription_variety(db, current_user.id)

    try:
        call = await ai_client.propose_card(payload.word, variety)
    except BaseAiError as error:
        # Технічна невдача: у журнал іде (вхідні токени оплачені), слово не
        # палить. Коміт обов'язковий — інакше слід зникне разом із відкотом.
        await ai_crud.record_request(
            db,
            user_id=current_user.id,
            word=payload.word,
            # Порожньою моделлю позначається «невідомо, хто відповідав»: при
            # обірваній мережі відповіді немає взагалі, і брати назву з
            # налаштувань означало б записати здогад як факт.
            model="",
            outcome=AiRequestOutcomeEnum.ERROR,
            error_code=error.code,
        )
        await db.commit()
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail={"code": error.code, "message": "AI request failed."},
        ) from error

    # Структурований вивід тримає форму, а не логіку: «рівно одне з двох» він не
    # гарантує, тож перевіряємо самі.
    #
    # Пропозиція без жодного значення сюди ж: формально вона валідна, але людині
    # не дає нічого, а слово палить назавжди. У справжнього англійського слова
    # значення є завжди, тож порожній `senses` — це зламана відповідь, а не
    # змістовна. Обидві ці невдачі слова не палять, як і будь-яка технічна.
    broken: str | None = None
    if (call.result.proposal is None) == (call.result.refusal is None):
        broken = "ai_ambiguous_result"
    elif call.result.proposal is not None and not call.result.proposal.senses:
        broken = "ai_empty_proposal"

    if broken:
        await ai_crud.record_request(
            db,
            user_id=current_user.id,
            word=payload.word,
            model=call.model,
            outcome=AiRequestOutcomeEnum.ERROR,
            input_tokens=call.input_tokens,
            output_tokens=call.output_tokens,
            error_code=broken,
        )
        await db.commit()
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail={"code": broken, "message": "AI request failed."},
        )

    refusal = call.result.refusal
    await ai_crud.record_request(
        db,
        user_id=current_user.id,
        word=payload.word,
        model=call.model,
        outcome=(
            AiRequestOutcomeEnum.REFUSAL if refusal else AiRequestOutcomeEnum.PROPOSAL
        ),
        input_tokens=call.input_tokens,
        output_tokens=call.output_tokens,
    )
    await db.commit()

    if refusal:
        # Відмова — повноцінна відповідь про це слово, і вона палить його так
        # само, як пропозиція: гроші витрачені, питання закрите. Виправлена
        # описка ключ міняє, тож нове право на звернення з'являється саме собою.
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={
                "code": "ai_not_a_word",
                "message": refusal.reason,
                "did_you_mean": refusal.did_you_mean,
            },
        )

    return mark_ai_comment(call.result.proposal)
