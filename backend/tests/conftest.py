"""
Стенд для наскрізних тестів API. Обґрунтування — ADR-0006.

Коротко: запити йдуть у застосунок через ASGITransport (без мережі й без
піднятого сервера), але база — справжній Postgres, окрема `slovnuk_test`.
Схему створює alembic, стан між тестами скидає TRUNCATE.
"""

import os

# ЦЕ МУСИТЬ БУТИ ДО БУДЬ-ЯКОГО import app.* — `app/database/database.py`
# створює engine на імпорті модуля, з `get_settings()`. Settings бере змінні
# оточення вище за .env, тож підміна тут перемикає базу всьому застосунку.
os.environ["POSTGRES_DB"] = os.environ.get("TEST_POSTGRES_DB", "slovnuk_test")

# Запобіжник: dev-база зветься `slovnuk`, і TRUNCATE по ній знищив би все
# без питань. Краще впасти на старті, ніж під час прибирання після тесту.
if not os.environ["POSTGRES_DB"].endswith("_test"):
    raise RuntimeError(
        f"Тести відмовляються працювати з базою {os.environ['POSTGRES_DB']!r}: "
        "назва мусить закінчуватись на '_test'."
    )

# Ключі підпису не мають дефолтів у Settings, тож без них не підніметься навіть
# тестовий застосунок. Значення тут навмисно очевидно несправжні: якщо вони
# колись спливуть у продакшені, це буде видно з першого погляду.
os.environ.setdefault("SECRET_KEY_ACCESS", "test-only-access-key")
os.environ.setdefault("SECRET_KEY_REFRESH", "test-only-refresh-key")

# Тільки IPv4, і це не косметика. У .env `POSTGRES_HOST=localhost`, а на Windows
# `localhost` резолвиться і в `127.0.0.1`, і в `::1`. Postgres же опублікований
# рівно на IPv4 (`docker-compose.yml`: "127.0.0.1:5432:5432"), тож коли резолвер
# віддає `::1`, з'єднання лишається в SynSent і висить, доки Windows не набридне
# повторювати SYN — хвилини, а не секунди.
#
# Ловиться це важко, бо воно НЕ детерміноване: `_clean_db` створює новий engine
# після кожного тесту, тобто резолвить `localhost` 192 рази за прогін, і досить
# одного невдалого. Симптом виглядає як «набір застиг посеред випадкового
# тесту», причому щоразу іншого.
os.environ.setdefault("POSTGRES_HOST", "127.0.0.1")

# Ключ Anthropic гаситься ЖОРСТКО, а не через setdefault: інакше набір читав би
# справжній ключ із кореневого .env, і тести «без ключа фічі немає» червоніли б
# рівно тоді, коли ШІ увімкнули по-справжньому. Ходити в мережу за гроші вони
# однаково не почали б — Claude підмінений FakeAiClient, — але поводились би
# по-різному на різних машинах.
os.environ["ANTHROPIC_API_KEY"] = ""

import subprocess  # noqa: E402
import sys  # noqa: E402
from functools import lru_cache  # noqa: E402
from pathlib import Path  # noqa: E402

import pytest  # noqa: E402
from httpx import ASGITransport, AsyncClient  # noqa: E402
from sqlalchemy import select, text  # noqa: E402
from sqlalchemy.ext.asyncio import (  # noqa: E402
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.pool import NullPool  # noqa: E402

import app.database.database as db_module  # noqa: E402
from app.config.dependencies import (  # noqa: E402
    get_accounts_email_notificator,
    get_ai_client,
    get_jwt_auth_manager,
    get_s3_storage_client,
    get_settings,
)
from app.database.models import (  # noqa: E402
    AiAccessModel,
    Base,
    PartOfSpeechEnum,
    TranscriptionVarietyEnum,
    UserGroupModel,
    UserModel,
)
from app.integrations.interfaces import AiCall, AiClientInterface  # noqa: E402
from app.schemas.ai import (  # noqa: E402
    AiExampleSchema,
    AiFormSchema,
    AiProposalSchema,
    AiRefusalSchema,
    AiResultSchema,
    AiSenseSchema,
)
from app.database.models.accounts import UserGroupEnum  # noqa: E402
from app.database.models.user_settings import UserSettingsModel  # noqa: E402
from app.main import app  # noqa: E402
from app.notifications.interfaces import EmailSenderInterface  # noqa: E402
from app.security.passwords import hash_password  # noqa: E402
from app.storages.interfaces import S3StorageInterface  # noqa: E402

BACKEND_DIR = Path(__file__).resolve().parent.parent

# `user_groups` сіє тільки міграція (79d2d50326fd_init.py, op.bulk_insert), а
# `alembic_version` взагалі не з metadata. Знести їх — це зламати реєстрацію
# після першого ж тесту, причому непрозоро: 500 «Default user group not found».
PRESERVED_TABLES = {"user_groups"}

TRUNCATE_SQL = "TRUNCATE {} RESTART IDENTITY CASCADE".format(
    ", ".join(
        f'"{table.name}"'
        for table in Base.metadata.sorted_tables
        if table.name not in PRESERVED_TABLES
    )
)

TEST_PASSWORD = "Qwerty!23456"


# --------------------------------------------------------------------------
# Схема і пул з'єднань
# --------------------------------------------------------------------------


@pytest.fixture(scope="session", autouse=True)
def _migrate() -> None:
    """
    Прогнати `alembic upgrade head` один раз на весь набір.

    Підпроцесом, а не через alembic API: `alembic/env.py:90` викликає
    `asyncio.run()`, і всередині вже запущеного циклу подій це падає.

    Чому не `Base.metadata.create_all`: групи користувачів існують лише
    завдяки `op.bulk_insert` у міграції, тож після create_all перша ж
    реєстрація впаде на `routes/accounts.py:110`.
    """
    result = subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=BACKEND_DIR,
        env=os.environ.copy(),
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(
            "alembic upgrade head впав. Чи піднято базу "
            f"(docker compose up -d postgres)?\n{result.stdout}\n{result.stderr}"
        )


def _make_engine():
    """
    Engine на NullPool: жодного з'єднання не переживає тест.

    asyncpg привʼязує з'єднання до циклу подій, у якому воно створене, а
    pytest-asyncio дає кожному тесту власний цикл (`asyncio_default_fixture_
    loop_scope = function`). Пул із попереднього тесту в наступному впав би з
    «attached to a different loop».

    Решта параметрів навмисно збігається з продовими — зокрема
    `expire_on_commit=False`, бо саме навколо нього тут двічі ловили баг
    (див. розділ «Пастки» в HANDOFF). Підмінюється тільки пул.
    """
    return create_async_engine(get_settings().DATABASE_URL, poolclass=NullPool)


# Застосунок ходить у базу через модульні глобалі `app.database.database`.
# `get_db` читає `async_session_maker` у момент виклику, тож підміна глобалі
# перенаправляє всі роути — інакше довелося б чіпати код застосунку.
db_module.engine = _make_engine()
db_module.async_session_maker = async_sessionmaker(
    bind=db_module.engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
)


@pytest.fixture(autouse=True)
async def _clean_db():
    """
    TRUNCATE після кожного тесту.

    Саме після, а не до: так база лишається наповненою, коли тест упав, і в
    неї можна зазирнути психологічно очима. Порядок таблиць не важливий —
    CASCADE.
    """
    yield
    engine = _make_engine()
    try:
        async with engine.begin() as connection:
            await connection.execute(text(TRUNCATE_SQL))
    finally:
        await engine.dispose()
    await db_module.engine.dispose()


@pytest.fixture
async def db_session() -> AsyncSession:
    """
    Сесія для підготовки даних і перевірки того, що в базі справді лежить.

    Це ОКРЕМА сесія від тієї, якою користується застосунок, — і так має бути:
    у проді кожен запит теж отримує свою. Тому підготовлені дані треба
    комітити, інакше застосунок їх не побачить.
    """
    async with db_module.async_session_maker() as session:
        yield session


# --------------------------------------------------------------------------
# Пошта
# --------------------------------------------------------------------------


class FakeEmailSender(EmailSenderInterface):
    """
    Замість Resend. `register` ставить лист у `background_tasks`, а Starlette
    під ASGITransport їх реально виконує — з живим RESEND_API_KEY із .env
    набір розсилав би справжні листи.

    Заразом дає змогу перевіряти, що лист пішов і з яким посиланням.
    """

    def __init__(self) -> None:
        self.sent: list[tuple[str, str, str]] = []

    async def send_activation_email(self, email: str, activation_link: str) -> None:
        self.sent.append(("activation", email, activation_link))

    async def send_activation_complete_email(self, email: str, login_link: str) -> None:
        self.sent.append(("activation_complete", email, login_link))

    async def send_password_reset_email(self, email: str, reset_link: str) -> None:
        self.sent.append(("password_reset", email, reset_link))

    async def send_password_reset_complete_email(self, email: str, login_link: str) -> None:
        self.sent.append(("password_reset_complete", email, login_link))


@pytest.fixture
def email_sender() -> FakeEmailSender:
    return FakeEmailSender()


# --------------------------------------------------------------------------
# Сховище
# --------------------------------------------------------------------------


class FakeS3Storage(S3StorageInterface):
    """
    Замість MinIO. Набору вистачає Postgres — тягнути ще й обʼєктне сховище
    заради чотирьох роутів профілю означало б, що тести не запускаються, коли
    підняте не все (ADR-0006).
    """

    def __init__(self) -> None:
        self.files: dict[str, bytes] = {}

    async def upload_file(self, file_name, file_data, content_type=None, private=True) -> None:
        self.files[file_name] = bytes(file_data)

    async def download_file(self, file_name, private=True) -> bytes:
        return self.files[file_name]

    async def delete_file(self, file_name, private=True) -> None:
        self.files.pop(file_name, None)

    async def get_file_url(self, file_name, private=True, expires_in=3600) -> str:
        return f"https://storage.test/{file_name}"


@pytest.fixture
def s3_storage() -> FakeS3Storage:
    return FakeS3Storage()


# --------------------------------------------------------------------------
# ШІ
# --------------------------------------------------------------------------


class FakeAiClient(AiClientInterface):
    """
    Замість Claude. Без нього набір або ходив би в мережу за гроші, або не
    перевіряв би нічого з того, що робить роут навколо виклику.

    За замовчуванням віддає пропозицію; `refuse_with` і `fail_with` перемикають
    на дві інші гілки. `calls` тримає аргументи — саме так перевіряється, що
    преференція транскрипції справді доїжджає до промпта.
    """

    def __init__(self) -> None:
        self.calls: list[tuple[str, TranscriptionVarietyEnum]] = []
        self.refuse_with: AiRefusalSchema | None = None
        self.fail_with: Exception | None = None
        self.proposal = AiProposalSchema(
            senses=[
                AiSenseSchema(
                    part_of_speech=PartOfSpeechEnum.VERB,
                    translation="бігти",
                    transcription="/rʌn/",
                    examples=[AiExampleSchema(text_en="I run.", text_uk="Я біжу.")],
                )
            ],
            forms=[AiFormSchema(label="Past", value="ran", transcription="/ræn/")],
            comment=None,
        )
        self.model = "fake-model"
        self.input_tokens = 600
        self.output_tokens = 800

    async def propose_card(
        self, word: str, transcription_variety: TranscriptionVarietyEnum
    ) -> AiCall:
        self.calls.append((word, transcription_variety))
        if self.fail_with is not None:
            raise self.fail_with
        result = (
            AiResultSchema(refusal=self.refuse_with)
            if self.refuse_with is not None
            else AiResultSchema(proposal=self.proposal)
        )
        return AiCall(
            result=result,
            model=self.model,
            input_tokens=self.input_tokens,
            output_tokens=self.output_tokens,
        )


@pytest.fixture
def ai_client() -> FakeAiClient:
    return FakeAiClient()


@pytest.fixture
def ai_enabled(client: AsyncClient, ai_client: FakeAiClient) -> FakeAiClient:
    """
    Увімкнути ШІ на цьому «сервері».

    Окремою фікстурою, а не в `client`: без неї `get_ai_client` віддає None (у
    тестах немає ключа), і решта набору бачить рівно те, що побачив би сервер
    без ключа. Тобто «фічі тут немає» — стан за замовчуванням, і його не треба
    імітувати окремо.

    Залежить від `client`, щоб підміна встала ПІСЛЯ того, як той виставить
    свої, і дожила до його ж `dependency_overrides.clear()`.
    """
    app.dependency_overrides[get_ai_client] = lambda: ai_client
    return ai_client


@pytest.fixture
def grant_ai_access(db_session: AsyncSession):
    """Видати доступ до ШІ — те саме, що робить scripts/ai_access.py grant."""

    async def _grant(user: UserModel) -> None:
        db_session.add(AiAccessModel(user_id=user.id))
        await db_session.commit()

    return _grant


# --------------------------------------------------------------------------
# Клієнт і авторизація
# --------------------------------------------------------------------------


@pytest.fixture
async def client(email_sender: FakeEmailSender, s3_storage: FakeS3Storage) -> AsyncClient:
    app.dependency_overrides[get_accounts_email_notificator] = lambda: email_sender
    app.dependency_overrides[get_s3_storage_client] = lambda: s3_storage
    try:
        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://test",
        ) as http_client:
            yield http_client
    finally:
        app.dependency_overrides.clear()


@lru_cache(maxsize=1)
def _test_password_hash() -> str:
    """
    Хеш рахується один раз на весь набір: bcrypt тут коштує сотні мілісекунд,
    а користувачів у наборі створюються сотні.
    """
    return hash_password(TEST_PASSWORD)


async def _create_user(session: AsyncSession, email: str, is_active: bool = True) -> UserModel:
    group = (
        await session.execute(
            select(UserGroupModel).where(UserGroupModel.name == UserGroupEnum.USER)
        )
    ).scalars().first()
    if group is None:
        raise RuntimeError(
            "У slovnuk_test немає групи USER. Схему створено не міграцією?"
        )

    user = UserModel(email=email, group_id=group.id, is_active=is_active)
    # Повз сеттер `password`: він хешує, а хеш у нас уже порахований.
    user._hashed_password = _test_password_hash()
    session.add(user)
    await session.flush()

    # register створює налаштування разом із користувачем, і решта коду
    # розраховує, що рядок є завжди.
    session.add(UserSettingsModel(user_id=user.id))
    await session.commit()
    await session.refresh(user)
    return user


@pytest.fixture
async def user(db_session: AsyncSession) -> UserModel:
    return await _create_user(db_session, "owner@example.com")


@pytest.fixture
async def other_user(db_session: AsyncSession) -> UserModel:
    """Другий користувач — для перевірок «чуже не видно»."""
    return await _create_user(db_session, "stranger@example.com")


def _auth_headers(user: UserModel) -> dict[str, str]:
    """
    Токен підписується тим самим `JWTAuthManager`, що й у проді, з тим самим
    payload (`{"user_id": ...}`, див. routes/accounts.py:371). Тобто перевірка
    токена в `security/dependencies.py` лишається справжньою — обходиться
    тільки bcrypt у логіні.
    """
    manager = get_jwt_auth_manager(get_settings())
    return {"Authorization": f"Bearer {manager.create_access_token({'user_id': user.id})}"}


@pytest.fixture
def auth_headers(user: UserModel) -> dict[str, str]:
    return _auth_headers(user)


@pytest.fixture
def other_auth_headers(other_user: UserModel) -> dict[str, str]:
    return _auth_headers(other_user)


@pytest.fixture
def make_user(db_session: AsyncSession):
    """
    Фабрика користувачів — для тестів, яким двох мало.

    Потрібна там, де правило вимірюється КІЛЬКІСТЮ людей, а не просто «свій і
    чужий»: поріг видимості рейтингу в Бібліотеці спрацьовує на третій оцінці, і
    перевірити його двома фікстурами неможливо.

    Віддає пару (користувач, заголовки) — окремо вони майже ніколи не потрібні.
    """
    created = 0

    async def _make(email: str | None = None) -> tuple[UserModel, dict[str, str]]:
        nonlocal created
        created += 1
        user = await _create_user(
            db_session, email or f"extra{created}@example.com"
        )
        return user, _auth_headers(user)

    return _make
