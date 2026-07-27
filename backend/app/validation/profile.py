import re
from datetime import date
from io import BytesIO

import phonenumbers
from PIL import Image
from fastapi import UploadFile
from pydantic_core import PydanticCustomError

from app.database.models.accounts import GenderEnum


def validate_name(name: str):
    if re.search(r'^[А-Яа-яЁёІіЇїЄєҐґ]*$', name) is None:
        raise PydanticCustomError(
            "name_invalid_chars",
            "{name} contains non-Ukrainian letters",
            {"name": name},
        )


def validate_image(avatar: UploadFile) -> None:
    supported_image_formats = ["JPG", "JPEG", "PNG"]
    max_file_size = 1 * 1024 * 1024

    contents = avatar.file.read()
    if len(contents) > max_file_size:
        raise PydanticCustomError("image_too_large", "Image size exceeds 1 MB")

    try:
        image = Image.open(BytesIO(contents))
        avatar.file.seek(0)
        image_format = image.format
        if image_format not in supported_image_formats:
            raise PydanticCustomError(
                "image_unsupported_format",
                "Unsupported image format: {image_format}. Use one of next: {supported_image_formats}",
                {"image_format": image_format, "supported_image_formats": supported_image_formats},
            )
    except IOError:
        raise PydanticCustomError("image_invalid", "Invalid image format")


def validate_gender(gender: str) -> None:
    if gender not in GenderEnum.__members__.values():
        raise PydanticCustomError(
            "gender_invalid",
            "Gender must be one of: {allowed}",
            {"allowed": ", ".join(g.value for g in GenderEnum)},
        )


def validate_birth_date(birth_date: date) -> None:
    if birth_date.year < 1900:
        raise PydanticCustomError(
            "birth_date_invalid_year", "Invalid birth date - year must be greater than 1900."
        )


def validate_phone_number(value: str | None) -> str | None:
    """
    Validates phone number in international format (must start with '+').
    Returns normalized number in E.164 format, e.g. +380501234567.
    """
    if value is None:
        return value

    value = value.strip()

    if not value.startswith("+"):
        raise PydanticCustomError(
            "phone_missing_country_code",
            "Phone number must be in international format, start with '+' "
            "and country code, for example +380501234567",
        )

    try:
        # default_region doesn't matter here since the number already contains country code,
        # but the argument is required for phonenumbers.parse
        parsed = phonenumbers.parse(value, None)
    except phonenumbers.NumberParseException:
        raise PydanticCustomError("phone_unparseable", "Failed to recognize phone number")

    if not phonenumbers.is_valid_number(parsed):
        raise PydanticCustomError(
            "phone_invalid", "Phone number is invalid for the specified country"
        )

    return phonenumbers.format_number(parsed, phonenumbers.PhoneNumberFormat.E164)
