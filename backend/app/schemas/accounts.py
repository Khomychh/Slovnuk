import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, field_validator

from app.database import validators as accounts_validators
from app.database.models import UserGroupEnum


class UserRegistrationRequestSchema(BaseModel):
    email: EmailStr
    password: str

    @field_validator("email")
    @classmethod
    def validate_email(cls, value):
        return value.lower()

    @field_validator("password")
    @classmethod
    def validate_password(cls, value: str) -> str:
        return accounts_validators.validate_password_strength(value)


class UserRegistrationResponseSchema(BaseModel):
    id: int
    email: EmailStr

    model_config = ConfigDict(from_attributes=True)


class UserActivationRequestSchema(BaseModel):
    email: EmailStr
    token: str


class UserLoginRequestSchema(BaseModel):
    email: EmailStr
    password: str


class UserLoginResponseSchema(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class PasswordResetRequestSchema(BaseModel):
    email: EmailStr


class PasswordResetCompleteRequestSchema(BaseModel):
    email: EmailStr
    token: str
    password: str

    @field_validator("password")
    @classmethod
    def validate_password(cls, value: str) -> str:
        return accounts_validators.validate_password_strength(value)


class MessageResponseSchema(BaseModel):
    message: str


class TokenRefreshRequestSchema(BaseModel):
    refresh_token: str


class TokenRefreshResponseSchema(BaseModel):
    access_token: str


class CurrentUserResponseSchema(BaseModel):
    id: int
    email: EmailStr
    is_active: bool
    role: UserGroupEnum
    # Чи малювати кнопку заповнення з ШІ. Одне поле на дві незалежні перевірки:
    # і привілей у людини є, і ключ на сервері є. Фронтенду розрізняти їх не
    # треба — в обох випадках кнопки просто немає; розрізняє їх сам роут
    # (403 проти 503).
    ai_enabled: bool = False
    first_name: str | None = None
    last_name: str | None = None
    patronymic: str | None = None
    phone: str | None = None
    gender: str | None = None
    date_of_birth: datetime.date | None = None
    info: str | None = None
    avatar: str | None = None

    model_config = ConfigDict(from_attributes=True)


class ChangePasswordRequestSchema(BaseModel):
    current_password: str
    new_password: str

    @field_validator("new_password")
    @classmethod
    def validate_new_password(cls, value: str) -> str:
        return accounts_validators.validate_password_strength(value)
