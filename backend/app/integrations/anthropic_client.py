"""
Клієнт Claude: єдине місце в застосунку, яке знає про Anthropic.

Модуль зветься `anthropic_client`, а не `anthropic`: файл із таким іменем
всередині пакета затінив би сам пакет `anthropic` при `import anthropic`
нижче — і зламався б не тут, а десь у SDK.
"""

import json
from typing import Any

import anthropic
from pydantic import ValidationError

from app.database.models import TranscriptionVarietyEnum
from app.exceptions.ai import (
    AiInvalidResponseError,
    AiRateLimitedError,
    AiUnavailableError,
)
from app.integrations.interfaces import AiCall, AiClientInterface
from app.integrations.prompts import build_system_prompt
from app.schemas.ai import AiResultSchema


# Стеля рахує думання РАЗОМ із відповіддю, а думання тут адаптивне — тобто його
# обсяг наперед не відомий. Сама пропозиція на три значення з прикладами — це
# приблизно 800 токенів, але виміряти по ній стелю означало б обрізати відповідь
# рівно на тих словах, над якими модель думала довше (`ai_truncated`).
#
# Платимо ми за фактичні токени, а не за стелю, тож запас нічого не коштує.
# Стрімінг при цьому все одно не потрібен: 16k — межа, нижче якої відповідь
# гарантовано встигає до таймауту HTTP.
MAX_TOKENS = 16000

# Що знімається зі схеми перед відправкою і чому:
#
# * maxLength/minLength/maxItems/minItems — структурований вивід їх не приймає.
#   Валідація по них однаково відбувається на нашому боці, коли відповідь лягає
#   в модель, а самі межі продубльовані в промпті словами.
# * default — нижче всі поля стають обов'язковими, і дефолт поруч із цим лише
#   збивав би з пантелику того, хто читає схему.
# * title/description — Pydantic кладе туди імена полів і ДОКСТРІНГИ НАШИХ
#   МОДЕЛЕЙ. Це внутрішня документація українською, написана для того, хто читає
#   код, а не для моделі. Лишити її означало б, що правила для Claude живуть у
#   двох місцях одразу, і правка докстрінга тихо міняє поведінку моделі. Правила
#   живуть у промпті; схема несе форму.
_UNSUPPORTED_KEYWORDS = frozenset(
    {
        "maxLength",
        "minLength",
        "maxItems",
        "minItems",
        "default",
        "title",
        "description",
    }
)

# Ключі всередині цих вузлів — імена полів і моделей, а не ключові слова схеми.
# Фільтрувати їх нарівні з рештою означало б тихо викинути поле, яке колись
# назвуть `default` або `minItems`.
_NAME_KEYED_NODES = frozenset({"properties", "$defs", "definitions"})


def _prepare_schema(node: Any) -> Any:
    """
    Привести схему Pydantic до того, що приймає структурований вивід.

    Дві речі: зняти непідтримувані обмеження і зробити ВСІ властивості
    обов'язковими. Друге виглядає дивно поруч із полями, що мають дефолти, але
    це різні речі: у схемі «обов'язкове» означає «ключ мусить бути в JSON», а
    нульове значення там дозволене. Тобто модель зобов'язана сказати `null`
    замість промовчати — і ми ніколи не отримаємо відповідь, у якій незрозуміло,
    чи поле пропущене свідомо, чи забуте.
    """
    if isinstance(node, list):
        return [_prepare_schema(item) for item in node]
    if not isinstance(node, dict):
        return node

    cleaned: dict[str, Any] = {}
    for key, value in node.items():
        if key in _UNSUPPORTED_KEYWORDS:
            continue
        if key in _NAME_KEYED_NODES and isinstance(value, dict):
            cleaned[key] = {name: _prepare_schema(item) for name, item in value.items()}
        else:
            cleaned[key] = _prepare_schema(value)

    if cleaned.get("type") == "object" and "properties" in cleaned:
        cleaned["required"] = list(cleaned["properties"].keys())
        cleaned["additionalProperties"] = False
    return cleaned


RESULT_JSON_SCHEMA = _prepare_schema(AiResultSchema.model_json_schema())


class AnthropicAiClient(AiClientInterface):
    """
    Реалізація поверх Anthropic Messages API.

    `thinking` не передається зовсім, і це не пропуск: на Opus 5 відсутність
    параметра означає адаптивне думання, тобто модель сама вирішує, скільки
    думати над кожним словом. Вимикати його `{"type": "disabled"}` спокусливо
    заради економії, але документація Anthropic описує при цьому конкретний
    збій — модель починає вкладати службову розмітку в саму відповідь. Зі
    структурованим виводом вона не зламала б JSON, а осіла б усередині рядка,
    тобто в перекладі або прикладі, який людина потім читає.

    Стриманість дає `effort`, а не вимкнене думання: на цій моделі низькі рівні
    працюють несподівано добре, а заповнення картки — витяг знання за жорсткою
    схемою, а не багатокрокове міркування. `medium` лишає запас на єдине місце,
    де судження справді потрібне: які значення справді вживані й чи є в слові
    пастка для українця.
    """

    def __init__(self, api_key: str, model: str, timeout: float) -> None:
        self._model = model
        self._client = anthropic.AsyncAnthropic(api_key=api_key, timeout=timeout)

    async def propose_card(
        self, word: str, transcription_variety: TranscriptionVarietyEnum
    ) -> AiCall:
        try:
            response = await self._client.messages.create(
                model=self._model,
                max_tokens=MAX_TOKENS,
                system=build_system_prompt(transcription_variety),
                output_config={
                    "effort": "medium",
                    "format": {"type": "json_schema", "schema": RESULT_JSON_SCHEMA},
                },
                messages=[{"role": "user", "content": word}],
            )
        except anthropic.RateLimitError as error:
            raise AiRateLimitedError(str(error)) from error
        except anthropic.APIStatusError as error:
            # Сюди ж падає 401 і 400: з погляду користувача це однаково
            # «сервіс не працює», а розрізняє їх код у журналі.
            raise AiUnavailableError(
                str(error), code=f"ai_http_{error.status_code}"
            ) from error
        except anthropic.APIConnectionError as error:
            # APITimeoutError — його підклас, тож таймаут ловиться тут же.
            raise AiUnavailableError(str(error), code="ai_connection") from error

        if response.stop_reason == "refusal":
            # Не та відмова, що в AiResultSchema.refusal: тут спрацювали
            # запобіжники самої моделі, і вмісту в відповіді немає взагалі.
            raise AiInvalidResponseError(
                "Model declined the request.", code="ai_model_refusal"
            )
        if response.stop_reason == "max_tokens":
            raise AiInvalidResponseError(
                "Response was cut off.", code="ai_truncated"
            )

        text = next((block.text for block in response.content if block.type == "text"), None)
        if not text:
            raise AiInvalidResponseError("Empty response.", code="ai_empty")

        try:
            result = AiResultSchema.model_validate(json.loads(text))
        except (json.JSONDecodeError, ValidationError) as error:
            raise AiInvalidResponseError(str(error), code="ai_schema_mismatch") from error

        return AiCall(
            result=result,
            # Модель беремо з відповіді, а не з налаштувань: у журнал має лягти
            # те, що справді відповідало.
            model=response.model,
            input_tokens=response.usage.input_tokens,
            output_tokens=response.usage.output_tokens,
        )
