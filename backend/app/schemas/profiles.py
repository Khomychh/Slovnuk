from datetime import date

from fastapi import UploadFile, Form, File, HTTPException
from pydantic import BaseModel, field_validator, ValidationError
from pydantic_core import PydanticCustomError

from app.validation.profile import (
    validate_name,
    validate_image,
    validate_gender,
    validate_birth_date,
    validate_phone_number,
)


class ProfileCreateSchema(BaseModel):
    first_name: str
    last_name: str
    patronymic: str | None
    phone: str | None
    gender: str
    date_of_birth: date
    info: str
    avatar: UploadFile

    model_config = {"arbitrary_types_allowed": True}

    @field_validator("first_name", "last_name")
    @classmethod
    def validate_names(cls, value: str) -> str:
        validate_name(value)
        return value.lower().capitalize()

    @field_validator("gender")
    @classmethod
    def validate_gender_field(cls, value: str) -> str:
        validate_gender(value)
        return value

    @field_validator("date_of_birth")
    @classmethod
    def validate_date_of_birth(cls, value: date) -> date:
        validate_birth_date(value)
        return value

    @field_validator("info")
    @classmethod
    def validate_info(cls, value: str) -> str:
        if not value or not value.strip():
            raise PydanticCustomError(
                "info_empty", "Info field cannot be empty or contain only spaces."
            )
        return value

    @field_validator("avatar")
    @classmethod
    def validate_avatar(cls, value: UploadFile) -> UploadFile:
        validate_image(value)
        return value

    @field_validator("phone")
    @classmethod
    def validate_phone(cls, value: str) -> str:
        validate_phone_number(value)
        return value

    @classmethod
    def as_form(
        cls,
        first_name: str = Form(...),
        last_name: str = Form(...),
        patronymic: str | None = Form(None),
        phone: str | None = Form(None),
        gender: str = Form(...),
        date_of_birth: date = Form(...),
        info: str = Form(...),
        avatar: UploadFile = File(...),
    ) -> "ProfileCreateSchema":
        try:
            return cls(
                first_name=first_name,
                last_name=last_name,
                patronymic=patronymic,
                phone=phone,
                gender=gender,
                date_of_birth=date_of_birth,
                info=info,
                avatar=avatar,
            )
        except ValidationError as error:
            errors = [
                {
                    "loc": err["loc"],
                    "message": err["msg"],
                    "code": err["type"],
                }
                for err in error.errors()
            ]
            raise HTTPException(status_code=422, detail=errors)


class ProfileResponseSchema(BaseModel):
    id: int
    user_id: int
    first_name: str | None
    last_name: str | None
    patronymic: str | None
    phone: str | None
    gender: str | None
    date_of_birth: date | None
    info: str | None
    avatar: str | None

    model_config = {"from_attributes": True}


class ProfileUpdateSchema(BaseModel):
    first_name: str | None = None
    last_name: str | None = None
    patronymic: str | None = None
    phone: str | None = None
    gender: str | None = None
    date_of_birth: date | None = None
    info: str | None = None

    @field_validator("first_name", "last_name")
    @classmethod
    def validate_names(cls, value: str | None) -> str | None:
        if value is None:
            return value
        validate_name(value)
        return value.lower().capitalize()

    @field_validator("phone")
    @classmethod
    def validate_phone(cls, value: str | None) -> str | None:
        if value is None:
            return value
        validate_phone_number(value)
        return value

    @field_validator("gender")
    @classmethod
    def validate_gender_field(cls, value: str | None) -> str | None:
        if value is None:
            return value
        validate_gender(value)
        return value

    @field_validator("date_of_birth")
    @classmethod
    def validate_date_of_birth(cls, value: date | None) -> date | None:
        if value is None:
            return value
        validate_birth_date(value)
        return value

    @field_validator("info")
    @classmethod
    def validate_info(cls, value: str | None) -> str | None:
        if value is None:
            return value
        if not value.strip():
            raise PydanticCustomError(
                "info_empty", "Info field cannot be empty or contain only spaces."
            )
        return value


class AvatarUpdateSchema(BaseModel):
    avatar: UploadFile

    model_config = {"arbitrary_types_allowed": True}

    @field_validator("avatar")
    @classmethod
    def validate_avatar(cls, value: UploadFile) -> UploadFile:
        validate_image(value)
        return value

    @classmethod
    def as_form(cls, avatar: UploadFile = File(...)) -> "AvatarUpdateSchema":
        try:
            return cls(avatar=avatar)
        except ValidationError as error:
            errors = [
                {
                    "loc": err["loc"],
                    "message": err["msg"],
                    "code": err["type"],
                }
                for err in error.errors()
            ]
            raise HTTPException(status_code=422, detail=errors)
