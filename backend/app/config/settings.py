from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


BASE_DIR = Path(__file__).resolve().parent.parent.parent
REPO_ROOT = BASE_DIR.parent
EMAIL_TEMPLATES_DIR = BASE_DIR / "app" / "notifications" / "templates"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=REPO_ROOT / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    DEBUG: bool = False

    SECRET_KEY_ACCESS: str
    SECRET_KEY_REFRESH: str
    JWT_SIGNING_ALGORITHM: str = "HS256"
    LOGIN_TIME_DAYS: int = 7

    POSTGRES_HOST: str = "localhost"
    POSTGRES_PORT: int
    POSTGRES_USER: str
    POSTGRES_PASSWORD: str
    POSTGRES_DB: str

    @property
    def DATABASE_URL(self) -> str:
        return (
            f"postgresql+asyncpg://{self.POSTGRES_USER}:{self.POSTGRES_PASSWORD}"
            f"@{self.POSTGRES_HOST}:{self.POSTGRES_PORT}/{self.POSTGRES_DB}"
        )

    # MinIO
    MINIO_ROOT_USER: str
    MINIO_ROOT_PASSWORD: str
    S3_PUBLIC_BUCKET_NAME: str
    S3_PRIVATE_BUCKET_NAME: str
    S3_STORAGE_ENDPOINT: str
    S3_STORAGE_PUBLIC_ENDPOINT: str


    # Email
    RESEND_API_KEY: str = ""
    EMAIL_SENDER: str = "no-reply@example.com"
    PATH_TO_EMAIL_TEMPLATES_DIR: str = str(EMAIL_TEMPLATES_DIR)
    ACTIVATION_EMAIL_TEMPLATE_NAME: str = "activation_request.html"
    ACTIVATION_COMPLETE_EMAIL_TEMPLATE_NAME: str = "activation_complete.html"
    PASSWORD_RESET_TEMPLATE_NAME: str = "password_reset_request.html"
    PASSWORD_RESET_COMPLETE_TEMPLATE_NAME: str = "password_reset_complete.html"

    # Заповнення картки з ШІ.
    #
    # Порожній ключ — це рубильник, а не помилка конфігурації: без нього фічі на
    # цьому сервері немає взагалі, роут віддає 503, і жоден користувач її не
    # бачить, навіть той, кому видано доступ. Саме тому дефолт "" — локальна
    # розробка й тести піднімаються без ключа й без жодного звернення до Claude.
    #
    # Ключ керує НАЯВНІСТЮ фічі, а таблиця ai_access — ПРАВОМ на неї. Дві
    # незалежні перевірки, два різні коди: 503 проти 403.
    ANTHROPIC_API_KEY: str = ""
    # Модель у налаштуваннях, а не константою в коді: міняється в .env без
    # правки коду. Дефолт — рекомендація Anthropic для нових інтеграцій; чи
    # вистачить дешевшої, видно тільки на живих словах і живому рахунку.
    AI_MODEL: str = "claude-opus-5"
    AI_TIMEOUT_SECONDS: float = 60.0

    # Frontend
    FRONTEND_BASE_URL: str = "http://localhost:5173"
    CORS_ORIGINS: list[str] = ["http://localhost:5173"]
