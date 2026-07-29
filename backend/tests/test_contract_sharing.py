"""
Контракт шерингу: 5 ендпоінтів, успішний шлях.

Шер живе у двох адресних просторах: `/vocabulary/lists/{id}/share/` для
власника і `/shares/{token}/` для отримувача. Тому тут два користувачі —
`auth_headers` (власник) і `other_auth_headers` (отримувач).
"""

from httpx import AsyncClient

VOCAB = "/api/v1/vocabulary"
SHARES = "/api/v1/shares"


async def _list_with_card(client: AsyncClient, headers: dict, word: str = "run") -> tuple[int, int]:
    response = await client.post(f"{VOCAB}/lists/", json={"name": "Дієслова"}, headers=headers)
    assert response.status_code == 201, response.text
    list_id = response.json()["id"]

    response = await client.post(
        f"{VOCAB}/cards/",
        json={
            "word": word,
            "list_ids": [list_id],
            "senses": [{"part_of_speech": "v", "translation": "бігти"}],
        },
        headers=headers,
    )
    assert response.status_code == 201, response.text
    return list_id, response.json()["id"]


async def _share(client: AsyncClient, headers: dict, list_id: int) -> str:
    response = await client.post(f"{VOCAB}/lists/{list_id}/share/", headers=headers)
    assert response.status_code == 200, response.text
    return response.json()["token"]


# --------------------------------------------------------------------------
# Власник
# --------------------------------------------------------------------------


async def test_create_share(client: AsyncClient, auth_headers):
    list_id, _ = await _list_with_card(client, auth_headers)

    response = await client.post(f"{VOCAB}/lists/{list_id}/share/", headers=auth_headers)
    assert response.status_code == 200, response.text

    body = response.json()
    assert body["token"]
    assert body["created_at"]


async def test_create_share_is_idempotent(client: AsyncClient, auth_headers):
    """Інакше кожне натискання «Поділитись» плодило б токени-близнюки."""
    list_id, _ = await _list_with_card(client, auth_headers)

    first = await _share(client, auth_headers, list_id)
    second = await _share(client, auth_headers, list_id)

    assert first == second


async def test_share_token_appears_in_lists(client: AsyncClient, auth_headers):
    """Акордеон малює іконку «поділено» без окремого запиту на кожен список."""
    list_id, _ = await _list_with_card(client, auth_headers)
    token = await _share(client, auth_headers, list_id)

    response = await client.get(f"{VOCAB}/lists/", headers=auth_headers)
    assert response.status_code == 200, response.text
    assert response.json()["items"][0]["share_token"] == token


async def test_delete_share(client: AsyncClient, auth_headers):
    list_id, _ = await _list_with_card(client, auth_headers)
    await _share(client, auth_headers, list_id)

    response = await client.delete(f"{VOCAB}/lists/{list_id}/share/", headers=auth_headers)
    assert response.status_code == 204, response.text

    response = await client.get(f"{VOCAB}/lists/", headers=auth_headers)
    assert response.json()["items"][0]["share_token"] is None


# --------------------------------------------------------------------------
# Отримувач
# --------------------------------------------------------------------------


async def test_preview_share(client: AsyncClient, auth_headers, other_auth_headers):
    list_id, _ = await _list_with_card(client, auth_headers)
    token = await _share(client, auth_headers, list_id)

    response = await client.get(f"{SHARES}/{token}/", headers=other_auth_headers)
    assert response.status_code == 200, response.text

    body = response.json()
    assert body["list_name"] == "Дієслова"
    assert body["total_cards"] == 1
    # Скільки СПРАВДІ додасться — саме це число описує наслідок кнопки.
    assert body["new_cards"] == 1
    assert body["suggested_name"]


async def test_shared_cards_page(client: AsyncClient, auth_headers, other_auth_headers):
    list_id, _ = await _list_with_card(client, auth_headers)
    token = await _share(client, auth_headers, list_id)

    response = await client.get(f"{SHARES}/{token}/cards/", headers=other_auth_headers)
    assert response.status_code == 200, response.text

    body = response.json()
    assert body["total"] == 1

    card = body["items"][0]
    assert card["word"] == "run"
    assert card["already_have"] is False
    # id чужих сутностей назовні не віддаються взагалі.
    assert "id" not in card


async def test_import_share(client: AsyncClient, auth_headers, other_auth_headers):
    list_id, _ = await _list_with_card(client, auth_headers)
    token = await _share(client, auth_headers, list_id)

    response = await client.post(
        f"{SHARES}/{token}/import/",
        json={"name": "Від Івана", "mode": "skip"},
        headers=other_auth_headers,
    )
    assert response.status_code == 201, response.text

    body = response.json()
    assert body["list_id"] is not None
    assert body["name"] == "Від Івана"
    assert body["created"] == 1
    assert body["overwritten"] == 0
    assert body["skipped"] == 0

    # Картка справді зʼявилась у отримувача, з власним чистим графіком.
    response = await client.get(f"{VOCAB}/cards/", headers=other_auth_headers)
    items = response.json()["items"]
    assert len(items) == 1
    assert items[0]["word"] == "run"
    assert all(track["state"] == "new" for track in items[0]["tracks"])


async def test_disabled_share_answers_410(client: AsyncClient, auth_headers, other_auth_headers):
    """
    Вимкнене посилання гаситься, а не видаляється: старе посилання мусить
    казати «власник вимкнув доступ», а не «такого не було».
    """
    list_id, _ = await _list_with_card(client, auth_headers)
    token = await _share(client, auth_headers, list_id)
    await client.delete(f"{VOCAB}/lists/{list_id}/share/", headers=auth_headers)

    response = await client.get(f"{SHARES}/{token}/", headers=other_auth_headers)
    assert response.status_code == 410, response.text


async def test_unknown_token_answers_404(client: AsyncClient, other_auth_headers):
    response = await client.get(f"{SHARES}/nosuchtoken/", headers=other_auth_headers)
    assert response.status_code == 404, response.text
