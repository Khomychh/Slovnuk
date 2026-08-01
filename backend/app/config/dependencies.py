from fastapi import Depends

from app.config.settings import Settings
from app.integrations import AiClientInterface, AnthropicAiClient
from app.notifications import EmailSenderInterface, EmailSender
from app.security.interfaces import JWTAuthManagerInterface
from app.security.token_manager import JWTAuthManager
from app.storages import S3StorageInterface, S3StorageClient


def get_settings() -> Settings:
    return Settings()


def get_jwt_auth_manager(settings: Settings = Depends(get_settings)) -> JWTAuthManagerInterface:
    """
    Створює та повертає екземпляр менеджера JWT-автентифікації.

    Ця функція використовує надані налаштування застосунку для створення JWTAuthManager, який реалізує
    JWTAuthManagerInterface. Менеджер налаштовується секретними ключами для access та refresh токенів,
    а також алгоритмом підпису JWT, вказаним у налаштуваннях.

    Args:
        settings (Settings, optional): Екземпляр налаштувань застосунку.
        За замовчуванням - результат get_settings().

    Returns:
        JWTAuthManagerInterface: Екземпляр JWTAuthManager, налаштований
        відповідними секретними ключами та алгоритмом.
    """
    return JWTAuthManager(
        secret_key_access=settings.SECRET_KEY_ACCESS,
        secret_key_refresh=settings.SECRET_KEY_REFRESH,
        algorithm=settings.JWT_SIGNING_ALGORITHM
    )


def get_accounts_email_notificator(
    settings: Settings = Depends(get_settings)
) -> EmailSenderInterface:
    """
    Повертає екземпляр EmailSenderInterface, налаштований відповідно до налаштувань застосунку.

    Ця функція створює EmailSender на основі наданих налаштувань, які включають Resend API ключ, адресу
    відправника, а також директорію та назви файлів email-шаблонів. Це дозволяє застосунку надсилати
    різні email-сповіщення (наприклад, активацію, скидання пароля) за потреби.

    Args:
        settings (Settings, optional): Налаштування застосунку,
        надані через dependency injection з `get_settings`.

    Returns:
        EmailSenderInterface: Екземпляр EmailSender, налаштований відповідними email-параметрами.
    """
    return EmailSender(
        api_key=settings.RESEND_API_KEY,
        sender_email=settings.EMAIL_SENDER,
        template_dir=settings.PATH_TO_EMAIL_TEMPLATES_DIR,
        activation_email_template_name=settings.ACTIVATION_EMAIL_TEMPLATE_NAME,
        activation_complete_email_template_name=settings.ACTIVATION_COMPLETE_EMAIL_TEMPLATE_NAME,
        password_email_template_name=settings.PASSWORD_RESET_TEMPLATE_NAME,
        password_complete_email_template_name=settings.PASSWORD_RESET_COMPLETE_TEMPLATE_NAME
    )


def get_ai_client(
    settings: Settings = Depends(get_settings)
) -> AiClientInterface | None:
    """
    Повертає клієнта ШІ або None, якщо ключа немає.

    None — не помилка, а рубильник: без ключа фічі на цьому сервері немає
    взагалі, і роут віддає 503. Саме тому залежність повертає None, а не кидає
    виняток при старті — локальна розробка й тести піднімаються без ключа й без
    жодного звернення до Claude.

    Це рівень «чи є ШІ тут», окремий від «чи можна цій людині» (таблиця
    ai_access). Дві незалежні перевірки, два різні коди: 503 проти 403.

    Args:
        settings (Settings, optional): Налаштування застосунку,
        надані через dependency injection з `get_settings`.

    Returns:
        AiClientInterface | None: Клієнт Claude або None, якщо ключ не заданий.
    """
    if not settings.ANTHROPIC_API_KEY:
        return None
    return AnthropicAiClient(
        api_key=settings.ANTHROPIC_API_KEY,
        model=settings.AI_MODEL,
        timeout=settings.AI_TIMEOUT_SECONDS,
    )


def get_s3_storage_client(
    settings: Settings = Depends(get_settings)
) -> S3StorageInterface:
    """
    Повертає екземпляр S3StorageInterface, налаштований відповідно до налаштувань застосунку.

    Ця функція створює S3StorageClient на основі наданих налаштувань, які включають URL S3 endpoint,
    облікові дані доступу та назву бакета. Отриманий клієнт може використовуватися для взаємодії
    з S3-сумісним сховищем при завантаженні файлів та генерації URL.

    Args:
        settings (Settings, optional): Налаштування застосунку,
        надані через dependency injection з `get_settings`.

    Returns:
        S3StorageInterface: Екземпляр S3StorageClient, налаштований відповідними параметрами S3-сховища.
    """
    return S3StorageClient(
        endpoint_url=settings.S3_STORAGE_ENDPOINT,
        access_key=settings.MINIO_ROOT_USER,
        secret_key=settings.MINIO_ROOT_PASSWORD,
        public_bucket_name=settings.S3_PUBLIC_BUCKET_NAME,
        private_bucket_name=settings.S3_PRIVATE_BUCKET_NAME,
        public_endpoint_url=settings.S3_STORAGE_PUBLIC_ENDPOINT,
    )
