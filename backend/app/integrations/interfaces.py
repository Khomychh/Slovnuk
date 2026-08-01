from abc import ABC, abstractmethod
from dataclasses import dataclass

from app.database.models import TranscriptionVarietyEnum
from app.schemas.ai import AiResultSchema


@dataclass(frozen=True)
class AiCall:
    """
    Один виклик ШІ: що відповіли й чого це коштувало.

    Токени повертає клієнт, а не рахує сервіс: скільки насправді пішло на вхід,
    знає тільки той, хто збирав запит (системний промпт, кешування). Модель теж
    приїжджає звідси, а не з налаштувань — у журнал має лягти те, що відповідало
    зараз, а не те, що вказано в .env на момент читання звіту.
    """

    result: AiResultSchema
    model: str
    input_tokens: int
    output_tokens: int


class AiClientInterface(ABC):
    """
    Те, що вміє ШІ в цьому застосунку. Рівно одна дія.

    Інтерфейс вузький навмисно: він існує, щоб тести проходили без мережі й без
    грошей (`FakeAiClient`), і щоб роут не знав, з ким саме розмовляє. Усе, що
    стосується конкретного постачальника — модель, промпт, формат схеми,
    класифікація помилок — лишається за цією межею.
    """

    @abstractmethod
    async def propose_card(
        self, word: str, transcription_variety: TranscriptionVarietyEnum
    ) -> AiCall:
        """
        Попросити пропозицію для слова.

        Args:
            word: слово, як його ввела людина. Клієнт його не міняє й не
                виправляє — максимум, модель скаже, на що воно схоже.
            transcription_variety: британська чи американська система запису.

        Returns:
            AiCall: розібрана відповідь плюс лічильники токенів. Відмова
            («це не слово») — теж успішний виклик і приїжджає в
            `result.refusal`, а не винятком.

        Raises:
            BaseAiError: технічна невдача — мережа, таймаут, 5xx, ліміт або
            відповідь, що не лягла в схему.
        """
        pass
