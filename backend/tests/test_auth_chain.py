"""
Єдиний тест, що проходить ланцюг авторизації по-справжньому.

Решта набору бере токен із фікстури `auth_headers` — bcrypt коштує сотні
мілісекунд на операцію, і платити їх сто тридцять разів немає за що
(ADR-0006). Але сам ланцюг перевірити треба: саме він ламався від
`bcrypt>=5`, повністю й тихо, і саме його першим смикне фронтенд.
"""

from app.database.models import UserModel
from app.database.models.accounts import ActivationTokenModel
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

EMAIL = "newcomer@example.com"
PASSWORD = "Qwerty!23456"


async def test_register_activate_login_refresh_me(
    client: AsyncClient,
    db_session: AsyncSession,
    email_sender,
):
    # --- реєстрація -------------------------------------------------------
    response = await client.post(
        "/api/v1/accounts/register/",
        json={"email": EMAIL, "password": PASSWORD},
    )
    assert response.status_code == 201, response.text
    assert response.json()["email"] == EMAIL

    # лист пішов, і в ньому саме те посилання, яким скористається фронтенд
    assert len(email_sender.sent) == 1
    kind, recipient, link = email_sender.sent[0]
    assert kind == "activation"
    assert recipient == EMAIL
    assert f"email={EMAIL}" in link

    # користувач створений неактивним
    user = (
        (await db_session.execute(select(UserModel).where(UserModel.email == EMAIL)))
        .scalars()
        .first()
    )
    assert user is not None
    assert user.is_active is False

    # --- логін до активації забороняється ---------------------------------
    response = await client.post(
        "/api/v1/accounts/login/",
        json={"email": EMAIL, "password": PASSWORD},
    )
    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "account_not_activated"

    # --- активація --------------------------------------------------------
    token_record = (
        (
            await db_session.execute(
                select(ActivationTokenModel).where(
                    ActivationTokenModel.user_id == user.id
                )
            )
        )
        .scalars()
        .first()
    )
    assert token_record is not None

    response = await client.post(
        "/api/v1/accounts/activate/",
        json={"email": EMAIL, "token": token_record.token},
    )
    assert response.status_code == 200, response.text

    # --- логін ------------------------------------------------------------
    response = await client.post(
        "/api/v1/accounts/login/",
        json={"email": EMAIL, "password": PASSWORD},
    )
    # 201, а не 200: логін оголошений як HTTP_201_CREATED (accounts.py:275).
    # Захищати тут нема чого — просто зафіксовано те, що є, щоб фронтенд
    # звірявся з реальністю.
    assert response.status_code == 201, response.text
    tokens = response.json()
    assert tokens["token_type"] == "bearer"
    access_token, refresh_token = tokens["access_token"], tokens["refresh_token"]

    # --- /me/ з отриманим токеном -----------------------------------------
    response = await client.get(
        "/api/v1/accounts/me/",
        headers={"Authorization": f"Bearer {access_token}"},
    )
    assert response.status_code == 200, response.text
    assert response.json()["email"] == EMAIL

    # --- оновлення access-токена ------------------------------------------
    response = await client.post(
        "/api/v1/accounts/refresh/",
        json={"refresh_token": refresh_token},
    )
    assert response.status_code == 200, response.text
    refreshed = response.json()["access_token"]

    response = await client.get(
        "/api/v1/accounts/me/",
        headers={"Authorization": f"Bearer {refreshed}"},
    )
    assert response.status_code == 200, response.text


async def test_register_again_restarts_unactivated_account(
    client: AsyncClient,
    db_session: AsyncSession,
    email_sender,
):
    """
    Друга реєстрація тією ж поштою до активації дає новий токен і новий пароль
    (ADR-0034). Без цього людина, у якої лист протермінувався, лишалась
    замкненою назовсім: логін віддає 403, реєстрація — 409, а скидання пароля
    для неактивних мовчить.
    """
    email = "twice@example.com"

    response = await client.post(
        "/api/v1/accounts/register/",
        json={"email": email, "password": PASSWORD},
    )
    assert response.status_code == 201, response.text
    user_id = response.json()["id"]

    first_token_record = (
        (
            await db_session.execute(
                select(ActivationTokenModel).where(
                    ActivationTokenModel.user_id == user_id
                )
            )
        )
        .scalars()
        .first()
    )
    assert first_token_record is not None
    # Рядком, а не через обʼєкт: після `expire_all` його рядка в базі вже
    # немає, і звернення до поля пішло б у базу по видалене.
    first_token = first_token_record.token

    # реєструємось ще раз — уже з іншим паролем
    new_password = "Inshyi!45678"
    response = await client.post(
        "/api/v1/accounts/register/",
        json={"email": email, "password": new_password},
    )
    assert response.status_code == 201, response.text
    assert response.json()["id"] == user_id

    # токен рівно один і він новий, а лист пішов удруге
    db_session.expire_all()
    tokens = (
        (
            await db_session.execute(
                select(ActivationTokenModel).where(
                    ActivationTokenModel.user_id == user_id
                )
            )
        )
        .scalars()
        .all()
    )
    assert len(tokens) == 1
    assert tokens[0].token != first_token
    assert len(email_sender.sent) == 2

    # старе посилання більше не працює, нове — працює
    response = await client.post(
        "/api/v1/accounts/activate/",
        json={"email": email, "token": first_token},
    )
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "invalid_activation_token"

    response = await client.post(
        "/api/v1/accounts/activate/",
        json={"email": email, "token": tokens[0].token},
    )
    assert response.status_code == 200, response.text

    # діє новий пароль, а не той, з яким реєструвались уперше
    response = await client.post(
        "/api/v1/accounts/login/",
        json={"email": email, "password": PASSWORD},
    )
    assert response.status_code == 401

    response = await client.post(
        "/api/v1/accounts/login/",
        json={"email": email, "password": new_password},
    )
    assert response.status_code == 201, response.text


async def test_register_over_activated_account_is_rejected(client: AsyncClient, user):
    """Підтверджений акаунт перереєстрації не піддається — 409, як і раніше."""
    response = await client.post(
        "/api/v1/accounts/register/",
        json={"email": user.email, "password": "Inshyi!45678"},
    )
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "email_already_exists"

    # і пароль лишився старим
    response = await client.post(
        "/api/v1/accounts/login/",
        json={"email": user.email, "password": "Qwerty!23456"},
    )
    assert response.status_code == 201, response.text


async def test_login_with_wrong_password_is_rejected(client: AsyncClient, user):
    """`user` із фікстури вже активний і має відомий пароль."""
    response = await client.post(
        "/api/v1/accounts/login/",
        json={"email": user.email, "password": "WrongPassword!1"},
    )
    assert response.status_code == 401
    assert response.json()["detail"]["code"] == "invalid_credentials"


async def test_fixture_user_can_log_in(client: AsyncClient, user):
    """
    Доводить, що хеш із фікстури справжній: якщо `_test_password_hash`
    розійдеться з тим, що перевіряє прод, решта набору мовчки тестуватиме
    фальшивого користувача.
    """
    response = await client.post(
        "/api/v1/accounts/login/",
        json={"email": user.email, "password": "Qwerty!23456"},
    )
    assert response.status_code == 201, response.text
