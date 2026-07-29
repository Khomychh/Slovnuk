"""
Контракт профілю: 4 ендпоінти, успішний шлях.

Сховище підмінене фейком (`FakeS3Storage` у conftest): набору вистачає
Postgres, MinIO піднімати не треба. Перевіряється, що роут дійшов до кінця і
поклав файл, а не те, як саме працює boto3.

Імена тут навмисно кириличні, а телефон у E.164 — `validate_name` приймає
лише українські літери, а `validate_phone_number` вимагає код країни.
"""

from io import BytesIO

from httpx import AsyncClient
from PIL import Image

API = "/api/v1/profiles"


def _png(color: str = "red") -> bytes:
    buffer = BytesIO()
    Image.new("RGB", (8, 8), color).save(buffer, format="PNG")
    return buffer.getvalue()


def _avatar_file(name: str = "avatar.png"):
    return {"avatar": (name, _png(), "image/png")}


def _profile_form() -> dict:
    return {
        "first_name": "Іван",
        "last_name": "Хомич",
        "patronymic": "Петрович",
        "phone": "+380501234567",
        "gender": "man",
        "date_of_birth": "1995-04-12",
        "info": "Вивчаю англійську",
    }


async def test_create_profile(client: AsyncClient, auth_headers, user, s3_storage):
    response = await client.post(
        f"{API}/{user.id}/",
        data=_profile_form(),
        files=_avatar_file(),
        headers=auth_headers,
    )
    assert response.status_code == 201, response.text

    body = response.json()
    assert body["user_id"] == user.id
    assert body["first_name"] == "Іван"
    assert body["gender"] == "man"
    assert body["avatar"]

    # Файл справді доїхав до сховища, а не загубився дорогою.
    assert len(s3_storage.files) == 1


async def test_update_profile(client: AsyncClient, auth_headers, user):
    """
    PATCH приймає звичайний JSON і робить upsert — профілю могло ще не бути.
    """
    response = await client.patch(
        f"{API}/{user.id}/",
        json={"first_name": "Іван", "info": "Оновлено"},
        headers=auth_headers,
    )
    assert response.status_code == 200, response.text

    body = response.json()
    assert body["first_name"] == "Іван"
    assert body["info"] == "Оновлено"


async def test_update_avatar(client: AsyncClient, auth_headers, user, s3_storage):
    response = await client.patch(
        f"{API}/{user.id}/avatar/",
        files=_avatar_file(),
        headers=auth_headers,
    )
    assert response.status_code == 200, response.text
    assert response.json()["avatar"]
    assert len(s3_storage.files) == 1


async def test_delete_avatar(client: AsyncClient, auth_headers, user, s3_storage):
    await client.patch(f"{API}/{user.id}/avatar/", files=_avatar_file(), headers=auth_headers)
    assert len(s3_storage.files) == 1

    response = await client.delete(f"{API}/{user.id}/avatar/", headers=auth_headers)
    assert response.status_code == 200, response.text
    assert response.json()["avatar"] is None
    assert s3_storage.files == {}


async def test_cannot_touch_another_users_profile(
    client: AsyncClient, auth_headers, other_user
):
    response = await client.patch(
        f"{API}/{other_user.id}/",
        json={"first_name": "Іван"},
        headers=auth_headers,
    )
    assert response.status_code == 403, response.text
