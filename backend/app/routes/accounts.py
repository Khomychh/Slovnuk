import logging
from datetime import datetime, timezone
from typing import cast

from fastapi import APIRouter, BackgroundTasks, Depends, status, HTTPException
from fastapi.concurrency import run_in_threadpool
from sqlalchemy import select, delete
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app.config.dependencies import (
    get_accounts_email_notificator,
    get_settings,
    get_jwt_auth_manager,
    get_s3_storage_client,
)
from app.config.settings import Settings
from app.database.database import get_db
from app.database.models import (
    UserModel,
    UserGroupModel,
    UserGroupEnum,
    ActivationTokenModel,
    PasswordResetTokenModel,
    RefreshTokenModel,
    UserSettingsModel,
)
from app.exceptions import BaseEmailError, BaseSecurityError
from app.notifications import EmailSenderInterface
from app.schemas.accounts import (
    UserRegistrationRequestSchema,
    UserRegistrationResponseSchema,
    MessageResponseSchema,
    UserActivationRequestSchema,
    PasswordResetRequestSchema,
    PasswordResetCompleteRequestSchema,
    UserLoginResponseSchema,
    UserLoginRequestSchema,
    TokenRefreshRequestSchema,
    TokenRefreshResponseSchema,
    CurrentUserResponseSchema,
    ChangePasswordRequestSchema,
)
from app.security.dependencies import (
    get_current_user_with_profile,
    get_current_authenticated_user
)
from app.security.interfaces import JWTAuthManagerInterface
from app.storages import S3StorageInterface

router = APIRouter()
logger = logging.getLogger(__name__)


async def _send_email_safely(send_email, *args, **kwargs) -> None:
    """
    Обгортка над BackgroundTasks.add_task для листів.

    BackgroundTasks виконуються ПІСЛЯ того, як відповідь клієнту вже пішла:
    показати виняток звідти клієнту нічим, і він летить прямо в ASGI-сервер.
    EmailSender.send_*_email навмисно кидає BaseEmailError (відхилений домен,
    вичерпаний ліміт Resend) — це очікуваний збій стороннього сервісу, а не
    помилка програми, тож тут він лише лягає в лог. Раніше він там і не ловився,
    і саме так один невдалий лист клав увесь бекенд для всіх користувачів.
    """
    try:
        await send_email(*args, **kwargs)
    except BaseEmailError as error:
        logger.error("Не вдалося надіслати лист: %s", error)


@router.post(
    "/register/",
    response_model=UserRegistrationResponseSchema,
    summary="User Registration",
    description="Register a new user with an email and password.",
    status_code=status.HTTP_201_CREATED,
    responses={
        409: {
            "description": "Conflict - User with this email already exists.",
            "content": {
                "application/json": {
                    "example": {
                        "detail": {
                            "code": "email_already_exists",
                            "message": "A user with this email test@example.com already exists.",
                        }
                    }
                }
            },
        },
        500: {
            "description": "Internal Server Error - An error occurred during user creation.",
            "content": {
                "application/json": {
                    "example": {
                        "detail": {
                            "code": "internal_error",
                            "message": "An error occurred during user creation.",
                        }
                    }
                }
            },
        },
    },
)
async def register_user(
    user_data: UserRegistrationRequestSchema,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
    email_sender: EmailSenderInterface = Depends(get_accounts_email_notificator),
) -> UserRegistrationResponseSchema:
    # Cпершу перевіримо, чи існує користувач з таким email
    stmt = select(UserModel).where(UserModel.email == user_data.email)
    result = await db.execute(stmt)
    existing_user = result.scalars().first()
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "email_already_exists",
                "message": f"A user with this email {user_data.email} already exists.",
            },
        )

    # Перевіримо, чи існує група користувачів.
    # А групи мають створюватися через alembic під час створення бази даних
    stmt = select(UserGroupModel).where(UserGroupModel.name == UserGroupEnum.USER)
    result = await db.execute(stmt)
    user_group = result.scalars().first()
    if not user_group:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "code": "internal_error",
                "message": "Default user group not found.",
            },
        )

    # створюємо нового користувача
    try:
        new_user = UserModel.create(
            email=str(user_data.email),
            raw_password=user_data.password,
            group_id=user_group.id,
        )
        db.add(new_user)
        await db.flush()

        # робимо токен активації
        # у моделі TokeBaseModel є поле із default=generate_secure_token()
        activation_token = ActivationTokenModel(user_id=new_user.id)
        db.add(activation_token)

        # налаштування завжди створюються разом із користувачем — дефолти
        # з UserSettingsModel, планувальник і рештка коду більше не мають
        # думати про відсутній рядок
        db.add(UserSettingsModel(user_id=new_user.id))

        await db.commit()
        await db.refresh(new_user)
    except SQLAlchemyError as e:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "code": "internal_error",
                "message": "An error occurred during user creation.",
            },
        ) from e
    else:
        # якщо помилок немає, то відправляємо лист на електронну пошту
        activation_link = (
            f"{settings.FRONTEND_BASE_URL}/accounts/activate"
            f"?email={new_user.email}&token={activation_token.token}"
        )
        background_tasks.add_task(
            _send_email_safely,
            email_sender.send_activation_email,
            email=str(new_user.email),
            activation_link=activation_link,
        )
        return UserRegistrationResponseSchema.model_validate(new_user)


@router.post(
    "/activate/",
    response_model=MessageResponseSchema,
    summary="Activate User Account",
    description="Activate a user's account using their email and activation token.",
    status_code=status.HTTP_200_OK,
    responses={
        400: {
            "description": "Bad Request - The activation token is invalid or expired, "
            "or the user account is already active.",
            "content": {
                "application/json": {
                    "examples": {
                        "invalid_token": {
                            "summary": "Invalid Token",
                            "value": {
                                "detail": {
                                    "code": "invalid_activation_token",
                                    "message": "Invalid or expired activation token.",
                                }
                            },
                        },
                        "already_active": {
                            "summary": "Account Already Active",
                            "value": {
                                "detail": {
                                    "code": "account_already_active",
                                    "message": "User account is already active.",
                                }
                            },
                        },
                    }
                }
            },
        },
    },
)
async def activate_account(
    activation_data: UserActivationRequestSchema,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
    email_sender: EmailSenderInterface = Depends(get_accounts_email_notificator),
) -> MessageResponseSchema:
    # cпершу шукаємо в базі даних токен активації
    stmt = (
        select(ActivationTokenModel)
        .options(joinedload(ActivationTokenModel.user))
        .join(UserModel)
        .where(
            UserModel.email == activation_data.email,
            ActivationTokenModel.token == activation_data.token,
        )
    )
    result = await db.execute(stmt)
    token_record = result.scalars().first()

    # якщо токен не знайдено або він уже закінчився, повертаємо помилку
    now_utc = datetime.now(timezone.utc)
    if (
        not token_record
        or cast(datetime, token_record.expires_at).replace(tzinfo=timezone.utc)
        < now_utc
    ):
        if token_record:
            # якщо токен є, але закінчився, видаляємо його
            await db.delete(token_record)
            await db.commit()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": "invalid_activation_token",
                "message": "Invalid or expired activation token.",
            },
        )

    # перевіряємо чи ще не активований аккаунт
    user = token_record.user
    if user.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": "account_already_active",
                "message": "User account is already active.",
            },
        )

    # якщо акаунт не активований, активуємо його й видаляємо токен
    user.is_active = True
    await db.delete(token_record)
    await db.commit()

    # відправляємо лист про активацію
    login_link = f"{settings.FRONTEND_BASE_URL}/accounts/login"
    background_tasks.add_task(
        _send_email_safely,
        email_sender.send_activation_complete_email,
        email=str(user.email),
        login_link=login_link,
    )

    return MessageResponseSchema(message="User account activated successfully.")


@router.post(
    "/login/",
    response_model=UserLoginResponseSchema,
    summary="User Login",
    description="Authenticate a user and return access and refresh tokens.",
    status_code=status.HTTP_201_CREATED,
    responses={
        401: {
            "description": "Unauthorized - Invalid email or password.",
            "content": {
                "application/json": {
                    "example": {
                        "detail": {
                            "code": "invalid_credentials",
                            "message": "Invalid email or password.",
                        }
                    }
                }
            },
        },
        403: {
            "description": "Forbidden - User account is not activated.",
            "content": {
                "application/json": {
                    "example": {
                        "detail": {
                            "code": "account_not_activated",
                            "message": "User account is not activated.",
                        }
                    }
                }
            },
        },
        500: {
            "description": "Internal Server Error - An error occurred while processing the request.",
            "content": {
                "application/json": {
                    "example": {
                        "detail": {
                            "code": "internal_error",
                            "message": "An error occurred while processing the request.",
                        }
                    }
                }
            },
        },
    },
)
async def login_user(
    login_data: UserLoginRequestSchema,
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
    jwt_manager: JWTAuthManagerInterface = Depends(get_jwt_auth_manager),
) -> UserLoginResponseSchema:
    # шукаємо користувача за email
    stmt = select(UserModel).filter_by(email=login_data.email)
    result = await db.execute(stmt)
    user = result.scalars().first()

    # перевіряємо чи є користувач і чи вірний пароль.
    # bcrypt із rounds=14 коштує ~790 мс, і синхронний виклик тут морозив би
    # весь API — uvicorn крутить один цикл подій. `or` так само коротко
    # замикається: без користувача хеш не рахується взагалі.
    if not user or not await run_in_threadpool(
        user.verify_password, login_data.password
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={
                "code": "invalid_credentials",
                "message": "Invalid email or password.",
            },
        )

    # перевіряємо чи активований користувач
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "account_not_activated",
                "message": "User account is not activated.",
            },
        )

    # створюємо refresh токен та додамо його до бази даних
    jwt_refresh_token = jwt_manager.create_refresh_token({"user_id": user.id})
    try:
        refresh_token = RefreshTokenModel.create(
            user_id=user.id,
            days_valid=settings.LOGIN_TIME_DAYS,
            token=jwt_refresh_token,
        )
        db.add(refresh_token)
        await db.flush()
        await db.commit()
    except SQLAlchemyError:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "code": "internal_error",
                "message": "An error occurred while processing the request.",
            },
        )

    # створюємо access токен та віддаємо обидва токени
    jwt_access_token = jwt_manager.create_access_token({"user_id": user.id})
    return UserLoginResponseSchema(
        access_token=jwt_access_token,
        refresh_token=jwt_refresh_token,
    )


@router.post(
    "/password-reset/request/",
    response_model=MessageResponseSchema,
    summary="Request Password Reset Token",
    description=(
        "Allows a user to request a password reset token. If the user exists and is active, "
        "a new token will be generated and any existing tokens will be invalidated."
    ),
    status_code=status.HTTP_200_OK,
)
async def request_password_reset_token(
    data: PasswordResetRequestSchema,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
    email_sender: EmailSenderInterface = Depends(get_accounts_email_notificator),
) -> MessageResponseSchema:
    # шукаємо користувача по емейлу
    stmt = select(UserModel).filter_by(email=data.email)
    result = await db.execute(stmt)
    user = result.scalars().first()

    # якщо користувач не знайдений або він не активний,
    # відповідаємо так, щоб не було витоку інформації про існування користувача
    if not user or not user.is_active:
        return MessageResponseSchema(
            message="If you are registered, you will receive an email with instructions."
        )

    # видаляємо всі токени скидання паролю для цього користувача
    await db.execute(
        delete(PasswordResetTokenModel).where(
            PasswordResetTokenModel.user_id == user.id
        )
    )

    # скидаємо новий токен скидання паролю
    reset_token = PasswordResetTokenModel(user_id=cast(int, user.id))
    db.add(reset_token)
    await db.commit()

    # відправляємо пошту з інструкціями для скидання паролю
    reset_link = (
        f"{settings.FRONTEND_BASE_URL}/accounts/reset-password/complete"
        f"?email={user.email}&token={reset_token.token}"
    )
    background_tasks.add_task(
        _send_email_safely,
        email_sender.send_password_reset_email,
        email=str(user.email),
        reset_link=reset_link,
    )

    return MessageResponseSchema(
        message="If you are registered, you will receive an email with instructions."
    )


@router.post(
    "/reset-password/complete/",
    response_model=MessageResponseSchema,
    summary="Reset User Password",
    description="Reset a user's password if a valid token is provided.",
    status_code=status.HTTP_200_OK,
    responses={
        400: {
            "description": (
                "Bad Request - The provided email or token is invalid, "
                "the token has expired, or the user account is not active."
            ),
            "content": {
                "application/json": {
                    "examples": {
                        "invalid_email_or_token": {
                            "summary": "Invalid Email or Token",
                            "value": {
                                "detail": {
                                    "code": "invalid_reset_token",
                                    "message": "Invalid email or token.",
                                }
                            },
                        },
                        "expired_token": {
                            "summary": "Expired Token",
                            "value": {
                                "detail": {
                                    "code": "invalid_reset_token",
                                    "message": "Invalid email or token.",
                                }
                            },
                        },
                    }
                }
            },
        },
        500: {
            "description": "Internal Server Error - An error occurred while resetting the password.",
            "content": {
                "application/json": {
                    "example": {
                        "detail": {
                            "code": "internal_error",
                            "message": "An error occurred while resetting the password.",
                        }
                    }
                }
            },
        },
    },
)
async def reset_password(
    data: PasswordResetCompleteRequestSchema,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
    email_sender: EmailSenderInterface = Depends(get_accounts_email_notificator),
) -> MessageResponseSchema:
    # спершу перевіряємо, чи існує користувач з таким email і чи активний
    stmt = select(UserModel).filter_by(email=data.email)
    result = await db.execute(stmt)
    user = result.scalars().first()
    if not user or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": "invalid_reset_token",
                "message": "Invalid email or token.",
            },
        )

    # потім перевіряємо чи існує токен скидання паролю для користувача
    stmt = select(PasswordResetTokenModel).filter_by(user_id=user.id)
    result = await db.execute(stmt)
    token_record = result.scalars().first()

    # перевіряємо, чи токени збігаються, якщо ні — видаляємо токен
    if not token_record or token_record.token != data.token:
        if token_record:
            await db.delete(token_record)
            await db.commit()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": "invalid_reset_token",
                "message": "Invalid email or token.",
            },
        )

    # перевіряємо, чи токен не застарів, якщо так — видаляємо токен
    expires_at = cast(datetime, token_record.expires_at).replace(tzinfo=timezone.utc)
    if expires_at < datetime.now(timezone.utc):
        await db.delete(token_record)
        await db.commit()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": "invalid_reset_token",
                "message": "Invalid email or token.",
            },
        )

    # якщо все добре - змінюємо пароль
    try:
        user.password = data.password
        await db.delete(token_record)
        await db.commit()
    except SQLAlchemyError:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "code": "internal_error",
                "message": "An error occurred while resetting the password.",
            },
        )

    login_link = f"{settings.FRONTEND_BASE_URL}/accounts/login/"
    background_tasks.add_task(
        _send_email_safely,
        email_sender.send_password_reset_complete_email,
        email=str(user.email),
        login_link=login_link,
    )

    return MessageResponseSchema(message="Password reset successfully.")


@router.post(
    "/refresh/",
    response_model=TokenRefreshResponseSchema,
    summary="Refresh Access Token",
    description="Refresh the access token using a valid refresh token.",
    status_code=status.HTTP_200_OK,
    responses={
        400: {
            "description": "Bad Request - The provided refresh token is invalid or expired.",
            "content": {
                "application/json": {
                    "example": {
                        "detail": {
                            "code": "invalid_refresh_token",
                            "message": "Token has expired.",
                        }
                    }
                }
            },
        },
        401: {
            "description": "Unauthorized - Refresh token not found.",
            "content": {
                "application/json": {
                    "example": {
                        "detail": {
                            "code": "refresh_token_not_found",
                            "message": "Refresh token not found.",
                        }
                    }
                }
            },
        },
        404: {
            "description": "Not Found - The user associated with the token does not exist.",
            "content": {
                "application/json": {
                    "example": {
                        "detail": {
                            "code": "user_not_found",
                            "message": "User not found.",
                        }
                    }
                }
            },
        },
    },
)
async def refresh_access_token(
    token_data: TokenRefreshRequestSchema,
    db: AsyncSession = Depends(get_db),
    jwt_manager: JWTAuthManagerInterface = Depends(get_jwt_auth_manager),
) -> TokenRefreshResponseSchema:
    # пробуємо розшифрувати refresh токен
    # заодно перевіряємо його валідність
    try:
        decoded_token = jwt_manager.decode_refresh_token(token_data.refresh_token)
        user_id = decoded_token.get("user_id")
    except BaseSecurityError as error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "invalid_refresh_token", "message": str(error)},
        )

    # потім перевіряємо чи існує refresh токен в базі даних
    stmt = select(RefreshTokenModel).filter_by(token=token_data.refresh_token)
    result = await db.execute(stmt)
    refresh_token_record = result.scalars().first()
    if not refresh_token_record:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={
                "code": "refresh_token_not_found",
                "message": "Refresh token not found.",
            },
        )

    # потім перевіряємо чи існує користувач в базі даних
    stmt = select(UserModel).filter_by(id=user_id)
    result = await db.execute(stmt)
    user = result.scalars().first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "user_not_found", "message": "User not found."},
        )

    # cтворємо новий access токен
    new_access_token = jwt_manager.create_access_token({"user_id": user_id})

    return TokenRefreshResponseSchema(access_token=new_access_token)


@router.get(
    "/me/",
    response_model=CurrentUserResponseSchema,
    summary="Get Current User",
    description="Return the profile of the currently authenticated user.",
    status_code=status.HTTP_200_OK,
)
async def get_current_user(
    user: UserModel = Depends(get_current_user_with_profile),
    s3_client: S3StorageInterface = Depends(get_s3_storage_client),
) -> CurrentUserResponseSchema:
    profile = user.profile

    avatar_url = (
        await s3_client.get_file_url(profile.avatar, private=False)
        if profile and profile.avatar
        else None
    )

    return CurrentUserResponseSchema(
        id=user.id,
        email=user.email,
        is_active=user.is_active,
        role=user.group.name,
        first_name=profile.first_name if profile else None,
        last_name=profile.last_name if profile else None,
        patronymic=profile.patronymic if profile else None,
        phone=profile.phone if profile else None,
        gender=profile.gender if profile else None,
        date_of_birth=profile.date_of_birth if profile else None,
        info=profile.info if profile else None,
        avatar=avatar_url,
    )


@router.post(
    "/change-password/",
    response_model=MessageResponseSchema,
    summary="Change Password",
    description="Change the authenticated user's password.",
    status_code=status.HTTP_200_OK,
    responses={
        401: {
            "description": "Unauthorized - The current password is incorrect.",
            "content": {
                "application/json": {
                    "example": {
                        "detail": {
                            "code": "current_password_incorrect",
                            "message": "Current password is incorrect.",
                        }
                    }
                }
            },
        },
    },
)
async def change_password(
    data: ChangePasswordRequestSchema,
    user: UserModel = Depends(get_current_authenticated_user),
    db: AsyncSession = Depends(get_db),
) -> MessageResponseSchema:
    if not await run_in_threadpool(user.verify_password, data.current_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={
                "code": "current_password_incorrect",
                "message": "Current password is incorrect.",
            },
        )

    user.password = data.new_password
    await db.commit()

    return MessageResponseSchema(message="Password changed successfully.")
