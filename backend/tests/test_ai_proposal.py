"""
Заповнення картки з ШІ.

Перевіряються правила, а не виклики: що ШІ бачить, що після нього лишається в
базі, і хто за яких умов отримує відмову. Сам Claude підмінений (FakeAiClient) —
набір не ходить у мережу й не витрачає грошей.
"""

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database.models import (
    AiRequestModel,
    AiRequestOutcomeEnum,
    CardModel,
    TranscriptionVarietyEnum,
    UserModel,
    UserSettingsModel,
)
from app.exceptions.ai import AiUnavailableError
from app.schemas.ai import AiRefusalSchema
from tests.conftest import FakeAiClient

PROPOSALS_URL = "/api/v1/ai/proposals/"


async def _requests(db_session: AsyncSession, user: UserModel) -> list[AiRequestModel]:
    stmt = (
        select(AiRequestModel)
        .where(AiRequestModel.user_id == user.id)
        .order_by(AiRequestModel.id)
    )
    return list((await db_session.execute(stmt)).scalars().all())


# --------------------------------------------------------------------------
# Дві незалежні перевірки: чи є ШІ тут і чи можна цій людині
# --------------------------------------------------------------------------


async def test_no_key_on_server_means_no_feature(
    client: AsyncClient, auth_headers: dict[str, str], grant_ai_access, user: UserModel
):
    """
    503 навіть тому, кому доступ видано.

    Ключ керує наявністю фічі, а не правом на неї: без нього її немає ні в кого.
    Фікстури `ai_enabled` тут навмисно немає — це стан за замовчуванням.
    """
    await grant_ai_access(user)

    response = await client.post(
        PROPOSALS_URL, json={"word": "run"}, headers=auth_headers
    )

    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "ai_not_configured"


async def test_no_privilege_means_403(
    client: AsyncClient, auth_headers: dict[str, str], ai_enabled: FakeAiClient
):
    """Ключ є, привілею немає — і жодного звернення до Claude не сталося."""
    response = await client.post(
        PROPOSALS_URL, json={"word": "run"}, headers=auth_headers
    )

    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "ai_access_denied"
    assert ai_enabled.calls == []


async def test_denial_costs_nothing(
    client: AsyncClient,
    auth_headers: dict[str, str],
    ai_enabled: FakeAiClient,
    db_session: AsyncSession,
    user: UserModel,
):
    """Відмова через привілей у журнал не пишеться: грошей вона не витратила."""
    await client.post(PROPOSALS_URL, json={"word": "run"}, headers=auth_headers)

    assert await _requests(db_session, user) == []


# --------------------------------------------------------------------------
# Пропозиція
# --------------------------------------------------------------------------


async def test_proposal_returned_and_vocabulary_untouched(
    client: AsyncClient,
    auth_headers: dict[str, str],
    ai_enabled: FakeAiClient,
    grant_ai_access,
    db_session: AsyncSession,
    user: UserModel,
):
    """
    Головне правило: у словнику після виклику не змінилося нічого.

    Пропозиція живе рівно доти, доки людина не натисне «Зберегти» — і зберігає
    її звичайний POST /vocabulary/cards/, а не цей роут.
    """
    await grant_ai_access(user)

    response = await client.post(
        PROPOSALS_URL, json={"word": "run"}, headers=auth_headers
    )

    assert response.status_code == 200
    body = response.json()
    assert body["senses"][0]["translation"] == "бігти"
    assert body["forms"][0]["value"] == "ran"

    cards = (await db_session.execute(select(CardModel))).scalars().all()
    assert cards == []


async def test_ai_sees_only_the_word(
    client: AsyncClient,
    auth_headers: dict[str, str],
    ai_enabled: FakeAiClient,
    grant_ai_access,
    user: UserModel,
    db_session: AsyncSession,
):
    """
    ШІ не отримує нічого, крім слова й системи транскрипції.

    Наявна картка з тим самим словом на запит не впливає: пропозиція завжди з
    нуля, доповнювати ШІ не вміє й не має.
    """
    await grant_ai_access(user)
    db_session.add(CardModel(user_id=user.id, word="run", comment="моє"))
    await db_session.commit()

    await client.post(PROPOSALS_URL, json={"word": "run"}, headers=auth_headers)

    assert ai_enabled.calls == [("run", TranscriptionVarietyEnum.GB)]


async def test_transcription_preference_reaches_the_prompt(
    client: AsyncClient,
    auth_headers: dict[str, str],
    ai_enabled: FakeAiClient,
    grant_ai_access,
    user: UserModel,
    db_session: AsyncSession,
):
    """Американську вибрано — саме вона й доїжджає до промпта."""
    await grant_ai_access(user)
    settings = (
        await db_session.execute(
            select(UserSettingsModel).where(UserSettingsModel.user_id == user.id)
        )
    ).scalar_one()
    settings.transcription_variety = TranscriptionVarietyEnum.US
    await db_session.commit()

    await client.post(PROPOSALS_URL, json={"word": "dance"}, headers=auth_headers)

    assert ai_enabled.calls == [("dance", TranscriptionVarietyEnum.US)]


async def test_comment_is_signed_by_backend(
    client: AsyncClient,
    auth_headers: dict[str, str],
    ai_enabled: FakeAiClient,
    grant_ai_access,
    user: UserModel,
):
    """
    Коментар приїжджає вже підписаним.

    Префікс ставить бекенд, а не фронтенд: роут має віддавати рядок, готовий
    лягти в поле.
    """
    await grant_ai_access(user)
    ai_enabled.proposal = ai_enabled.proposal.model_copy(
        update={"comment": "magazine — це журнал, а не магазин."}
    )

    response = await client.post(
        PROPOSALS_URL, json={"word": "magazine"}, headers=auth_headers
    )

    assert response.json()["comment"] == "ШІ: magazine — це журнал, а не магазин."


async def test_absent_comment_stays_absent(
    client: AsyncClient,
    auth_headers: dict[str, str],
    ai_enabled: FakeAiClient,
    grant_ai_access,
    user: UserModel,
):
    """Пастки немає — коментаря немає. Порожній префікс не вигадується."""
    await grant_ai_access(user)

    response = await client.post(
        PROPOSALS_URL, json={"word": "run"}, headers=auth_headers
    )

    assert response.json()["comment"] is None


# --------------------------------------------------------------------------
# Журнал
# --------------------------------------------------------------------------


async def test_success_is_recorded_with_tokens(
    client: AsyncClient,
    auth_headers: dict[str, str],
    ai_enabled: FakeAiClient,
    grant_ai_access,
    db_session: AsyncSession,
    user: UserModel,
):
    """Журнал тримає все, з чого потім рахують рахунок."""
    await grant_ai_access(user)

    await client.post(PROPOSALS_URL, json={"word": "Run "}, headers=auth_headers)

    (record,) = await _requests(db_session, user)
    assert record.outcome == AiRequestOutcomeEnum.PROPOSAL
    # Слово як ввели, і ключ, за яким воно вважається тим самим.
    assert record.word == "Run "
    assert record.word_normalized == "run"
    assert record.model == "fake-model"
    assert (record.input_tokens, record.output_tokens) == (600, 800)
    assert record.error_code is None


# --------------------------------------------------------------------------
# Одне звернення на слово
# --------------------------------------------------------------------------


async def test_second_call_for_same_word_is_refused(
    client: AsyncClient,
    auth_headers: dict[str, str],
    ai_enabled: FakeAiClient,
    grant_ai_access,
    user: UserModel,
):
    """Регістр і пробіли ключа не міняють: «Run » — те саме слово, що «run»."""
    await grant_ai_access(user)
    await client.post(PROPOSALS_URL, json={"word": "run"}, headers=auth_headers)

    response = await client.post(
        PROPOSALS_URL, json={"word": "  Run"}, headers=auth_headers
    )

    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "ai_word_already_filled"
    # До Claude справа не дійшла — обмеження перевіряється раніше.
    assert len(ai_enabled.calls) == 1


async def test_limit_is_per_person(
    client: AsyncClient,
    auth_headers: dict[str, str],
    other_auth_headers: dict[str, str],
    ai_enabled: FakeAiClient,
    grant_ai_access,
    user: UserModel,
    other_user: UserModel,
):
    """Чуже звернення чужого слова не палить."""
    await grant_ai_access(user)
    await grant_ai_access(other_user)
    await client.post(PROPOSALS_URL, json={"word": "run"}, headers=auth_headers)

    response = await client.post(
        PROPOSALS_URL, json={"word": "run"}, headers=other_auth_headers
    )

    assert response.status_code == 200


# --------------------------------------------------------------------------
# Не слово
# --------------------------------------------------------------------------


async def test_refusal_returns_422_with_suggestion(
    client: AsyncClient,
    auth_headers: dict[str, str],
    ai_enabled: FakeAiClient,
    grant_ai_access,
    user: UserModel,
):
    """
    Об'єднання розкривається в код HTTP: клієнту не треба розбирати, яка гілка
    прийшла при 200.
    """
    await grant_ai_access(user)
    ai_enabled.refuse_with = AiRefusalSchema(
        reason="Схоже на описку.", did_you_mean="receive"
    )

    response = await client.post(
        PROPOSALS_URL, json={"word": "recieve"}, headers=auth_headers
    )

    assert response.status_code == 422
    detail = response.json()["detail"]
    assert detail["code"] == "ai_not_a_word"
    assert detail["did_you_mean"] == "receive"


async def test_refusal_burns_the_word(
    client: AsyncClient,
    auth_headers: dict[str, str],
    ai_enabled: FakeAiClient,
    grant_ai_access,
    db_session: AsyncSession,
    user: UserModel,
):
    """Гроші витрачені, відповідь про цей текст остаточна — другої спроби немає."""
    await grant_ai_access(user)
    ai_enabled.refuse_with = AiRefusalSchema(reason="Не слово.", did_you_mean=None)
    await client.post(PROPOSALS_URL, json={"word": "asdfgh"}, headers=auth_headers)

    response = await client.post(
        PROPOSALS_URL, json={"word": "asdfgh"}, headers=auth_headers
    )

    assert response.status_code == 409
    (record,) = await _requests(db_session, user)
    assert record.outcome == AiRequestOutcomeEnum.REFUSAL


async def test_corrected_typo_is_a_different_word(
    client: AsyncClient,
    auth_headers: dict[str, str],
    ai_enabled: FakeAiClient,
    grant_ai_access,
    user: UserModel,
):
    """
    Через це обмеження «раз на слово» не карає за описку: виправлений текст має
    інший ключ, тобто нове право на звернення.
    """
    await grant_ai_access(user)
    ai_enabled.refuse_with = AiRefusalSchema(
        reason="Схоже на описку.", did_you_mean="receive"
    )
    await client.post(PROPOSALS_URL, json={"word": "recieve"}, headers=auth_headers)

    ai_enabled.refuse_with = None
    response = await client.post(
        PROPOSALS_URL, json={"word": "receive"}, headers=auth_headers
    )

    assert response.status_code == 200


# --------------------------------------------------------------------------
# Технічна невдача
# --------------------------------------------------------------------------


async def test_empty_proposal_is_broken_not_an_answer(
    client: AsyncClient,
    auth_headers: dict[str, str],
    ai_enabled: FakeAiClient,
    grant_ai_access,
    db_session: AsyncSession,
    user: UserModel,
):
    """
    Пропозиція без жодного значення формально валідна, але людині не дає нічого.
    Палити нею слово було б найгіршим із можливих наслідків.
    """
    await grant_ai_access(user)
    ai_enabled.proposal = ai_enabled.proposal.model_copy(
        update={"senses": [], "forms": [], "comment": None}
    )

    response = await client.post(
        PROPOSALS_URL, json={"word": "run"}, headers=auth_headers
    )

    assert response.status_code == 502
    assert response.json()["detail"]["code"] == "ai_empty_proposal"
    (record,) = await _requests(db_session, user)
    assert record.outcome == AiRequestOutcomeEnum.ERROR
    # Токени за неї витрачені й записані — на відміну від обірваної мережі.
    assert record.input_tokens == 600


async def test_failure_is_recorded_but_does_not_burn_the_word(
    client: AsyncClient,
    auth_headers: dict[str, str],
    ai_enabled: FakeAiClient,
    grant_ai_access,
    db_session: AsyncSession,
    user: UserModel,
):
    """
    Найважливіше правило журналу: невдача коштувала вхідних токенів, тож слід
    лишається, — але людина не винна, що Claude лежав, і слово вільне.
    """
    await grant_ai_access(user)
    ai_enabled.fail_with = AiUnavailableError("boom", code="ai_connection")

    failed = await client.post(
        PROPOSALS_URL, json={"word": "resilient"}, headers=auth_headers
    )
    assert failed.status_code == 502
    assert failed.json()["detail"]["code"] == "ai_connection"

    (record,) = await _requests(db_session, user)
    assert record.outcome == AiRequestOutcomeEnum.ERROR
    assert record.error_code == "ai_connection"

    ai_enabled.fail_with = None
    retried = await client.post(
        PROPOSALS_URL, json={"word": "resilient"}, headers=auth_headers
    )
    assert retried.status_code == 200


# --------------------------------------------------------------------------
# Видимість кнопки
# --------------------------------------------------------------------------


@pytest.mark.parametrize("granted", [False, True])
async def test_me_reports_ai_disabled_without_key(
    client: AsyncClient, auth_headers: dict[str, str], grant_ai_access, user, granted
):
    """Без ключа кнопки немає ні в кого — навіть у того, кому доступ видано."""
    if granted:
        await grant_ai_access(user)

    response = await client.get("/api/v1/accounts/me/", headers=auth_headers)

    assert response.json()["ai_enabled"] is False


async def test_me_reports_ai_enabled_only_with_both(
    client: AsyncClient,
    auth_headers: dict[str, str],
    ai_enabled: FakeAiClient,
    grant_ai_access,
    user: UserModel,
):
    """Ключ є, привілею ще немає → False; видали привілей → True."""
    before = await client.get("/api/v1/accounts/me/", headers=auth_headers)
    assert before.json()["ai_enabled"] is False

    await grant_ai_access(user)

    after = await client.get("/api/v1/accounts/me/", headers=auth_headers)
    assert after.json()["ai_enabled"] is True
