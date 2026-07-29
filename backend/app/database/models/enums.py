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


class ReviewRating(enum.IntEnum):
    """
    Оцінка відповіді. У базі зберігається як SmallInteger 1–4, а не як enum,
    бо саме такі числа очікують планувальники (SM-2, FSRS).
    """
    AGAIN = 1
    HARD = 2
    GOOD = 3
    EASY = 4
