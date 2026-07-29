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
    get_jwt_auth_manager,
    get_s3_storage_client,
    get_settings,
)
from app.database.models import Base, UserGroupModel, UserModel  # noqa: E402
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
