"""
Контракт граматики: 10 ендпоінтів, успішний шлях.

Тут же перевіряється пастка з `expire_on_commit=False`: `PATCH` із
`category: null` колись віддавав `category_id: null` разом зі СТАРИМ
`category_name` — відповідь, що суперечила сама собі. Побачити це можна лише
живою базою, тому перевірка стоїть саме тут, а не в тестах без БД.
"""

from httpx import AsyncClient

API = "/api/v1/grammar"


async def _create_note(client: AsyncClient, headers: dict, **overrides) -> dict:
    payload = {
        "title": "Present Perfect",
        "body_markdown": "**have/has** + V3",
        "category": "Часи",
    }
    payload.update(overrides)
    response = await client.post(f"{API}/notes/", json=payload, headers=headers)
    assert response.status_code == 201, response.text
    return response.json()


# --------------------------------------------------------------------------
# Нотатки
# --------------------------------------------------------------------------


async def test_create_note_creates_category_on_the_fly(client: AsyncClient, auth_headers):
    body = await _create_note(client, auth_headers)

    assert body["title"] == "Present Perfect"
    assert body["body_markdown"] == "**have/has** + V3"
    # Розділ заводиться самою назвою, окремим запитом його створювати не треба.
    assert body["category_id"] is not None
    assert body["category_name"] == "Часи"


async def test_create_note_without_category(client: AsyncClient, auth_headers):
    body = await _create_note(client, auth_headers, category=None)

    assert body["category_id"] is None
    assert body["category_name"] is None


async def test_get_notes_page(client: AsyncClient, auth_headers):
    await _create_note(client, auth_headers)

    response = await client.get(f"{API}/notes/", headers=auth_headers)
    assert response.status_code == 200, response.text

    body = response.json()
    assert body["total"] == 1
    assert body["page"] == 1
    assert body["items"][0]["title"] == "Present Perfect"


async def test_get_single_note(client: AsyncClient, auth_headers):
    created = await _create_note(client, auth_headers)

    response = await client.get(f"{API}/notes/{created['id']}/", headers=auth_headers)
    assert response.status_code == 200, response.text
    assert response.json()["id"] == created["id"]


async def test_patch_note(client: AsyncClient, auth_headers):
    created = await _create_note(client, auth_headers)

    response = await client.patch(
        f"{API}/notes/{created['id']}/",
        json={"title": "Present Perfect Continuous"},
        headers=auth_headers,
    )
    assert response.status_code == 200, response.text

    body = response.json()
    assert body["title"] == "Present Perfect Continuous"
    # Розділу в тілі не було — отже, лишається як був.
    assert body["category_name"] == "Часи"


async def test_patch_note_clearing_category_is_self_consistent(
    client: AsyncClient, auth_headers
):
    """
    `category: null` мусить прибрати і id, і назву.

    Саме тут ловився `expire_on_commit=False`: після коміту обʼєкт лишався в
    identity map із уже завантаженим relationship, повторний SELECT його не
    перезаписував, і у відповідь їхала пара `category_id: null` +
    `category_name: "Часи"`.
    """
    created = await _create_note(client, auth_headers)
    assert created["category_name"] == "Часи"

    response = await client.patch(
        f"{API}/notes/{created['id']}/",
        json={"category": None},
        headers=auth_headers,
    )
    assert response.status_code == 200, response.text

    body = response.json()
    assert body["category_id"] is None
    assert body["category_name"] is None, (
        "Відповідь суперечить сама собі: розділу немає, а назва лишилась. "
        "Перевір populate_existing у cruds.grammar.get_own_note."
    )


async def test_delete_note(client: AsyncClient, auth_headers):
    created = await _create_note(client, auth_headers)

    response = await client.delete(f"{API}/notes/{created['id']}/", headers=auth_headers)
    assert response.status_code == 204, response.text

    response = await client.get(f"{API}/notes/{created['id']}/", headers=auth_headers)
    assert response.status_code == 404


# --------------------------------------------------------------------------
# Розділи
# --------------------------------------------------------------------------


async def test_create_category(client: AsyncClient, auth_headers):
    response = await client.post(
        f"{API}/categories/", json={"name": "Артиклі"}, headers=auth_headers
    )
    assert response.status_code == 201, response.text

    body = response.json()
    assert body["name"] == "Артиклі"
    assert body["note_count"] == 0


async def test_get_categories_returns_uncategorized_bucket(
    client: AsyncClient, auth_headers
):
    await _create_note(client, auth_headers)
    await _create_note(client, auth_headers, title="Артикль a/an", category=None)

    response = await client.get(f"{API}/categories/", headers=auth_headers)
    assert response.status_code == 200, response.text

    body = response.json()
    assert len(body["items"]) == 1
    assert body["items"][0]["name"] == "Часи"
    assert body["items"][0]["note_count"] == 1
    # «Без розділу» — окрема група, а не розділ: id в неї немає.
    assert body["uncategorized"] == {"note_count": 1}


async def test_patch_category(client: AsyncClient, auth_headers):
    response = await client.post(
        f"{API}/categories/", json={"name": "Артиклі"}, headers=auth_headers
    )
    category_id = response.json()["id"]

    response = await client.patch(
        f"{API}/categories/{category_id}/",
        json={"name": "Означеність", "position": 2},
        headers=auth_headers,
    )
    assert response.status_code == 200, response.text
    assert response.json()["name"] == "Означеність"
    assert response.json()["position"] == 2


async def test_delete_category(client: AsyncClient, auth_headers):
    created = await _create_note(client, auth_headers)

    response = await client.delete(
        f"{API}/categories/{created['category_id']}/", headers=auth_headers
    )
    assert response.status_code == 204, response.text
