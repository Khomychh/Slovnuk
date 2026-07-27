import re

import email_validator


def validate_password_strength(password: str) -> str:
    if len(password) < 8:
        raise ValueError("Пароль має містити щонайменше 8 символів.")
    if not re.search(r'[A-Z]', password):
        raise ValueError("Пароль має містити щонайменше одну велику літеру.")
    if not re.search(r'[a-z]', password):
        raise ValueError("Пароль має містити щонайменше одну малу літеру.")
    if not re.search(r'\d', password):
        raise ValueError("Пароль має містити щонайменше одну цифру.")
    if not re.search(r'[@$!%*?&#]', password):
        raise ValueError("Пароль має містити щонайменше один спеціальний символ: @, $, !, %, *, ?, #, &.")
    return password


def validate_email(user_email: str) -> str:
    try:
        email_info = email_validator.validate_email(user_email, check_deliverability=False)
        email = email_info.normalized
    except email_validator.EmailNotValidError as error:
        raise ValueError(str(error))
    else:
        return email
