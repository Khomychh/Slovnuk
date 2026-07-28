"""
Доменні правила граматики з CONTEXT.md.

Ключова відмінність від словника: розділ — НЕ мітка. Нотатка лежить
щонайбільше в одному розділі, і саме на цьому місці легко за звичкою зробити
багатозвʼязок «як у списках».
"""

from httpx import AsyncClient
from sqlalchemy import select

from app.database.models import GrammarNoteModel

API = "/api/v1/grammar"


async def _note(client: AsyncClient, headers: dict, title: str, category=None) -> dict:
    response = await client.post(
        f"{API}/notes/",
        json={"title": title, "body_markdown": "текст", "category": category},
        headers=headers,
    )
    assert response.status_code == 201, response.text
    return response.json()


# --------------------------------------------------------------------------
# «Розділ заводиться на льоту, самою назвою»
# --------------------------------------------------------------------------


async def test_same_category_name_is_reused_not_duplicated(
    client: AsyncClient, auth_headers
):
    first = await _note(client, auth_headers, "Present Perfect", category="Часи")
    second = await _note(client, auth_headers, "Past Simple", category="Часи")

    assert first["category_id"] == second["category_id"]

    categories = (await client.get(f"{API}/categories/", headers=auth_headers)).json()
    assert len(categories["items"]) == 1
    assert categories["items"][0]["note_count"] == 2


async def test_category_names_are_per_user(
    client: AsyncClient, auth_headers, other_auth_headers
):
    mine = await _note(client, auth_headers, "Present Perfect", category="Часи")
    theirs = await _note(client, other_auth_headers, "Present Perfect", category="Часи")

    assert mine["category_id"] != theirs["category_id"]


# --------------------------------------------------------------------------
# «Нотатка лежить щонайбільше в одному розділі»
# --------------------------------------------------------------------------


async def test_changing_category_moves_the_note_rather_than_adding_a_label(
    client: AsyncClient, auth_headers
):
    note = await _note(client, auth_headers, "Present Perfect", category="Часи")

    response = await client.patch(
        f"{API}/notes/{note['id']}/", json={"category": "Артиклі"}, headers=auth_headers
    )
    assert response.status_code == 200, response.text
    assert response.json()["category_name"] == "Артиклі"

    categories = (await client.get(f"{API}/categories/", headers=auth_headers)).json()
    counts = {item["name"]: item["note_count"] for item in categories["items"]}
    # Старий розділ лишається жити, але вже порожній — нотатка в ньому не
    # «залишилась міткою».
    assert counts == {"Часи": 0, "Артиклі": 1}


# --------------------------------------------------------------------------
# «Без розділу»
# --------------------------------------------------------------------------


async def test_deleting_a_category_keeps_its_notes(client: AsyncClient, auth_headers, db_session):
    note = await _note(client, auth_headers, "Present Perfect", category="Часи")

    response = await client.delete(
        f"{API}/categories/{note['category_id']}/", headers=auth_headers
    )
    assert response.status_code == 204

    await db_session.commit()
    survivors = (await db_session.execute(select(GrammarNoteModel))).scalars().all()
    assert len(survivors) == 1, "видалення розділу знищило нотатки"

    response = await client.get(f"{API}/notes/{note['id']}/", headers=auth_headers)
    assert response.status_code == 200
    assert response.json()["category_id"] is None
    assert response.json()["category_name"] is None


async def test_notes_reach_uncategorized_by_both_routes(client: AsyncClient, auth_headers):
    """Нотатка потрапляє в «Без розділу» або одразу, або коли її розділ видалили."""
    await _note(client, auth_headers, "Артикль a/an")
    with_category = await _note(client, auth_headers, "Present Perfect", category="Часи")
    await client.delete(
        f"{API}/categories/{with_category['category_id']}/", headers=auth_headers
    )

    categories = (await client.get(f"{API}/categories/", headers=auth_headers)).json()
    assert categories["items"] == []
    assert categories["uncategorized"]["note_count"] == 2


async def test_uncategorized_filter(client: AsyncClient, auth_headers):
    await _note(client, auth_headers, "Артикль a/an")
    await _note(client, auth_headers, "Present Perfect", category="Часи")

    response = await client.get(f"{API}/notes/?uncategorized=true", headers=auth_headers)
    assert response.status_code == 200, response.text
    assert response.json()["total"] == 1
    assert response.json()["items"][0]["title"] == "Артикль a/an"


# --------------------------------------------------------------------------
# «Порожній розділ не зникає сам»
# --------------------------------------------------------------------------


async def test_empty_category_survives_until_deleted_explicitly(
    client: AsyncClient, auth_headers
):
    response = await client.post(
        f"{API}/categories/", json={"name": "Артиклі"}, headers=auth_headers
    )
    category_id = response.json()["id"]

    categories = (await client.get(f"{API}/categories/", headers=auth_headers)).json()
    assert [item["id"] for item in categories["items"]] == [category_id]

    await client.delete(f"{API}/categories/{category_id}/", headers=auth_headers)
    categories = (await client.get(f"{API}/categories/", headers=auth_headers)).json()
    assert categories["items"] == []


# --------------------------------------------------------------------------
# «Нотатки не беруть участі в повтореннях»
# --------------------------------------------------------------------------


async def test_notes_never_enter_the_study_queue(client: AsyncClient, auth_headers):
    """Граматика — довідник, а не картки."""
    await _note(client, auth_headers, "Present Perfect", category="Часи")

    queue = (await client.get("/api/v1/study/queue/", headers=auth_headers)).json()
    assert queue["items"] == []
    assert queue["due_count"] == 0
    assert queue["new_count"] == 0


# --------------------------------------------------------------------------
# Чуже
# --------------------------------------------------------------------------


async def test_another_users_note_is_invisible(
    client: AsyncClient, auth_headers, other_auth_headers
):
    note = await _note(client, auth_headers, "Present Perfect", category="Часи")

    response = await client.get(f"{API}/notes/{note['id']}/", headers=other_auth_headers)
    assert response.status_code == 404

    response = await client.patch(
        f"{API}/notes/{note['id']}/", json={"title": "Чуже"}, headers=other_auth_headers
    )
    assert response.status_code == 404

    response = await client.delete(
        f"{API}/notes/{note['id']}/", headers=other_auth_headers
    )
    assert response.status_code == 404


async def test_another_users_category_is_invisible(
    client: AsyncClient, auth_headers, other_auth_headers
):
    note = await _note(client, auth_headers, "Present Perfect", category="Часи")

    response = await client.delete(
        f"{API}/categories/{note['category_id']}/", headers=other_auth_headers
    )
    assert response.status_code == 404

    categories = (
        await client.get(f"{API}/categories/", headers=other_auth_headers)
    ).json()
    assert categories["items"] == []
