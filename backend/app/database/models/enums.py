import enum


class GenderEnum(str, enum.Enum):
    MAN = "man"
    WOMAN = "woman"


class ThemeEnum(str, enum.Enum):
    LIGHT = "light"
    DARK = "dark"
    SYSTEM = "system"


class StudyDirectionEnum(str, enum.Enum):
    """
    Напрямок показу картки під час навчання.

    Це лише преференція інтерфейсу — на графік повторень не впливає.
    Обидва напрямки рухають одну й ту саму доріжку ReviewKindEnum.TRANSLATION.
    """
    EN_UK = "en_uk"
    UK_EN = "uk_en"
    MIXED = "mixed"


class TtsAccentEnum(str, enum.Enum):
    """
    Акцент голосу для текстового синтезу.
    """
    AUTO = "auto"
    US = "us"
    GB = "gb"


class TranscriptionVarietyEnum(str, enum.Enum):
    """
    Якою системою записувати транскрипцію в нових картках.

    Це НЕ TtsAccentEnum, попри схожі значення, і плутати їх не можна:

    * TtsAccentEnum — про голос ПРИСТРОЮ. Звук ніде не зберігається, зміна діє
      миттєво й на все, і AUTO («хай пристрій вирішує») там осмислене.
    * Тут — про ТЕКСТ, який ляже в word_senses.transcription і житиме роками.
      Зміна не діє заднім числом: старі картки лишаються як були. AUTO тут
      неможливе — файл мусить мати одну систему запису.

    Тому в інтерфейсі це поле зветься просто «Транскрипція», а слово «акцент»
    лишається за голосом.
    """
    GB = "gb"
    US = "us"


class AiRequestOutcomeEnum(str, enum.Enum):
    """
    Чим скінчилося звернення до ШІ.

    PROPOSAL і REFUSAL — обидва повноцінні відповіді моделі про це слово, і
    обидва палять слово: гроші витрачені, питання закрите. ERROR — технічна
    невдача (мережа, 5xx, таймаут); вона теж потрапляє в журнал, бо вхідні
    токени вже оплачені, але слово не палить: людина не винна, що Claude лежав.
    """
    PROPOSAL = "proposal"
    REFUSAL = "refusal"
    ERROR = "error"


class PartOfSpeechEnum(str, enum.Enum):
    NOUN = "n"
    VERB = "v"
    ADJECTIVE = "adj"
    ADVERB = "adv"
    PREPOSITION = "prep"
    PHRASE = "phr"
    OTHER = "other"


class ReviewKindEnum(str, enum.Enum):
    """
    Що саме тренується.

    TRANSLATION — слово ↔ переклад.
    FORMS — неправильні форми слова (went / gone), окремий графік.
    """
    TRANSLATION = "translation"
    FORMS = "forms"


class ReviewStateEnum(str, enum.Enum):
    """Стан доріжки. NEW означає «жодного повтору ще не було»."""
    NEW = "new"
    LEARNING = "learning"
    REVIEW = "review"
    RELEARNING = "relearning"


class PublicationReportReasonEnum(str, enum.Enum):
    """
    Причина скарги на публікацію.

    Набір закритий навмисно: вільний текст у публічному місці сам стає тим, що
    треба модерувати, а розбирати п'ять причин можна запитом, не читаючи прозу.

    OTHER — не «інше, розкажіть яке», а «щось не так, розберіться». Поля для
    розповіді немає й не планується.
    """
    OBSCENE = "obscene"
    SPAM = "spam"
    WRONG = "wrong"
    OTHER = "other"


class ReviewRating(enum.IntEnum):
    """
    Оцінка відповіді. У базі зберігається як SmallInteger 1–4, а не як enum,
    бо саме такі числа очікують планувальники (SM-2, FSRS).
    """
    AGAIN = 1
    HARD = 2
    GOOD = 3
    EASY = 4
