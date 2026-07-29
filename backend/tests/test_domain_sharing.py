"""
Доменні правила шерингу — ADR-0005 і розділ «Спільне користування» в CONTEXT.

Головне правило контрінтуїтивне: імпортований список **неповний за
визначенням**. Наявне слово пропускається цілком і в новий список не
потрапляє. Якщо ця поведінка колись «полагодиться» назад, ці тести мають
почервоніти першими.
"""

from httpx import AsyncClient
from sqlalchemy import select, update

from app.database.models import ReviewKindEnum, ReviewTrackModel
from app.database.models.sharing import ListShareModel

VOCAB = "/api/v1/vocabulary"
SHARES = "/api/v1/shares"


async def _owner_list(client: AsyncClient, headers: dict, words: list[str]) -> int:
    response = await client.post(
        f"{VOCAB}/lists/", json={"name": "Дієслова"}, headers=headers
    )
    list_id = response.json()["id"]

    for word in words:
        response = await client.post(
            f"{VOCAB}/cards/",
            json={
                "word": word,
                "list_ids": [list_id],
                "senses": [{"translation": f"переклад автора для {word}"}],
                "forms": [{"label": "Past", "value": f"{word}-past"}],
            },
            headers=headers,
        )
        assert response.status_code == 201, response.text
    return list_id


async def _share(client: AsyncClient, headers: dict, list_id: int) -> str:
    response = await client.post(f"{VOCAB}/lists/{list_id}/share/", headers=headers)
    assert response.status_code == 200, response.text
    return response.json()["token"]


# --------------------------------------------------------------------------
# «Пропуск наявних»
# --------------------------------------------------------------------------


async def test_import_skips_words_the_recipient_already_has(
    client: AsyncClient, auth_headers, other_auth_headers
):
    """
    Із трьох слів автора одне в отримувача вже є — додасться два, і список
    вийде неповним. Це не баг імпорту.
    """
    list_id = await _owner_list(client, auth_headers, ["run", "go", "take"])
    token = await _share(client, auth_headers, list_id)

    await client.post(
        f"{VOCAB}/cards/",
        json={"word": "go", "senses": [{"translation": "мій власний переклад"}]},
        headers=other_auth_headers,
    )

    response = await client.post(
        f"{SHARES}/{token}/import/",
        json={"name": "Від автора", "mode": "skip"},
        headers=other_auth_headers,
    )
    assert response.status_code == 201, response.text

    body = response.json()
    assert body["created"] == 2
    assert body["skipped"] == 1
    assert body["overwritten"] == 0


async def test_skipped_word_does_not_enter_the_new_list(
    client: AsyncClient, auth_headers, other_auth_headers
):
    """
    Найважливіший наслідок ADR-0005: чужий список не має права переставляти
    твої картки по групах.
    """
    list_id = await _owner_list(client, auth_headers, ["run", "go"])
    token = await _share(client, auth_headers, list_id)

    await client.post(
        f"{VOCAB}/cards/",
        json={"word": "go", "senses": [{"translation": "мій власний переклад"}]},
        headers=other_auth_headers,
    )

    result = (
        await client.post(
            f"{SHARES}/{token}/import/",
            json={"name": "Від автора", "mode": "skip"},
            headers=other_auth_headers,
        )
    ).json()

    cards = (await client.get(f"{VOCAB}/cards/", headers=other_auth_headers)).json()
    mine = next(card for card in cards["items"] if card["word"] == "go")
    assert mine["list_ids"] == [], "пропущена картка все одно отримала мітку списку"

    imported = next(card for card in cards["items"] if card["word"] == "run")
    assert imported["list_ids"] == [result["list_id"]]


async def test_skip_never_touches_my_own_translation(
    client: AsyncClient, auth_headers, other_auth_headers
):
    list_id = await _owner_list(client, auth_headers, ["go"])
    token = await _share(client, auth_headers, list_id)

    await client.post(
        f"{VOCAB}/cards/",
        json={"word": "go", "senses": [{"translation": "мій власний переклад"}]},
        headers=other_auth_headers,
    )

    await client.post(
        f"{SHARES}/{token}/import/",
        json={"name": "Від автора", "mode": "skip"},
        headers=other_auth_headers,
    )

    cards = (await client.get(f"{VOCAB}/cards/", headers=other_auth_headers)).json()
    mine = next(card for card in cards["items"] if card["word"] == "go")
    assert mine["senses"][0]["translation"] == "мій власний переклад"


async def test_preview_tells_the_truth_before_the_button(
    client: AsyncClient, auth_headers, other_auth_headers
):
    """
    Екран мусить показувати `new_cards`, а не `total_cards`, інакше імпорт
    виглядатиме зламаним.
    """
    list_id = await _owner_list(client, auth_headers, ["run", "go", "take"])
    token = await _share(client, auth_headers, list_id)

    await client.post(
        f"{VOCAB}/cards/",
        json={"word": "go", "senses": [{"translation": "своє"}]},
        headers=other_auth_headers,
    )

    preview = (await client.get(f"{SHARES}/{token}/", headers=other_auth_headers)).json()
    assert preview["total_cards"] == 3
    assert preview["new_cards"] == 2

    cards = (
        await client.get(f"{SHARES}/{token}/cards/", headers=other_auth_headers)
    ).json()
    flags = {card["word"]: card["already_have"] for card in cards["items"]}
    assert flags == {"run": False, "go": True, "take": False}


async def test_repeated_skip_import_creates_no_list_at_all(
    client: AsyncClient, auth_headers, other_auth_headers
):
    """
    Порожній результат — не помилка, а «нічого нового не знайшлось». Порожня
    іменована мітка була б сміттям, яке користувач прибирає руками.
    """
    list_id = await _owner_list(client, auth_headers, ["run"])
    token = await _share(client, auth_headers, list_id)

    first = (
        await client.post(
            f"{SHARES}/{token}/import/",
            json={"name": "Перший", "mode": "skip"},
            headers=other_auth_headers,
        )
    ).json()
    assert first["created"] == 1

    second = (
        await client.post(
            f"{SHARES}/{token}/import/",
            json={"name": "Другий", "mode": "skip"},
            headers=other_auth_headers,
        )
    ).json()
    assert second["created"] == 0
    assert second["skipped"] == 1
    assert second["list_id"] is None, "створився порожній список"


# --------------------------------------------------------------------------
# «Перезапис при імпорті»
# --------------------------------------------------------------------------


async def test_overwrite_replaces_content_but_not_progress(
    client: AsyncClient, auth_headers, other_auth_headers, db_session
):
    """
    Доріжки живуть на картці, а не на її тексті: місяць повторень не коштує
    нічого, навіть коли переклад повністю переписано.
    """
    list_id = await _owner_list(client, auth_headers, ["go"])
    token = await _share(client, auth_headers, list_id)

    mine = (
        await client.post(
            f"{VOCAB}/cards/",
            json={"word": "go", "senses": [{"translation": "мій власний переклад"}]},
            headers=other_auth_headers,
        )
    ).json()

    await db_session.execute(
        update(ReviewTrackModel)
        .where(ReviewTrackModel.card_id == mine["id"])
        .values(stability=12.5)
    )
    await db_session.commit()

    response = await client.post(
        f"{SHARES}/{token}/import/",
        json={"name": "Від автора", "mode": "overwrite"},
        headers=other_auth_headers,
    )
    assert response.status_code == 201, response.text
    assert response.json()["overwritten"] == 1

    card = (
        await client.get(f"{VOCAB}/cards/{mine['id']}/", headers=other_auth_headers)
    ).json()
    assert card["senses"][0]["translation"] == "переклад автора для go"
    assert card["list_ids"] == [response.json()["list_id"]]

    await db_session.commit()
    stability = (
        await db_session.execute(
            select(ReviewTrackModel.stability).where(
                ReviewTrackModel.card_id == mine["id"],
                ReviewTrackModel.kind == ReviewKindEnum.TRANSLATION,
            )
        )
    ).scalar_one()
    assert stability == 12.5, "перезапис вмісту скинув прогрес"


async def test_imported_cards_start_with_a_clean_schedule(
    client: AsyncClient, auth_headers, other_auth_headers
):
    """Шер — копія, а не підписка: у отримувача власні картки і власний прогрес."""
    list_id = await _owner_list(client, auth_headers, ["run"])
    token = await _share(client, auth_headers, list_id)

    await client.post(
        f"{SHARES}/{token}/import/",
        json={"name": "Від автора"},
        headers=other_auth_headers,
    )

    cards = (await client.get(f"{VOCAB}/cards/", headers=other_auth_headers)).json()
    assert all(
        track["state"] == "new" for card in cards["items"] for track in card["tracks"]
    )


async def test_later_changes_by_the_owner_do_not_reach_the_recipient(
    client: AsyncClient, auth_headers, other_auth_headers
):
    list_id = await _owner_list(client, auth_headers, ["run"])
    token = await _share(client, auth_headers, list_id)

    await client.post(
        f"{SHARES}/{token}/import/",
        json={"name": "Від автора"},
        headers=other_auth_headers,
    )

    owner_cards = (await client.get(f"{VOCAB}/cards/", headers=auth_headers)).json()
    owner_card_id = owner_cards["items"][0]["id"]
    await client.patch(
        f"{VOCAB}/cards/{owner_card_id}/",
        json={"senses": [{"translation": "автор передумав"}]},
        headers=auth_headers,
    )

    cards = (await client.get(f"{VOCAB}/cards/", headers=other_auth_headers)).json()
    assert cards["items"][0]["senses"][0]["translation"] == "переклад автора для run"


# --------------------------------------------------------------------------
# Життя посилання
# --------------------------------------------------------------------------


async def test_re_enabling_a_share_mints_a_new_token(client: AsyncClient, auth_headers):
    """«Вимкнене вже не воскресає — увімкнути знову означає нове посилання»."""
    list_id = await _owner_list(client, auth_headers, ["run"])
    first = await _share(client, auth_headers, list_id)

    await client.delete(f"{VOCAB}/lists/{list_id}/share/", headers=auth_headers)
    second = await _share(client, auth_headers, list_id)

    assert second != first


async def test_deleting_the_list_kills_the_share(
    client: AsyncClient, auth_headers, other_auth_headers, db_session
):
    list_id = await _owner_list(client, auth_headers, ["run"])
    token = await _share(client, auth_headers, list_id)

    await client.delete(f"{VOCAB}/lists/{list_id}/", headers=auth_headers)

    await db_session.commit()
    shares = (await db_session.execute(select(ListShareModel))).scalars().all()
    assert shares == [], "шер пережив свій список"

    response = await client.get(f"{SHARES}/{token}/", headers=other_auth_headers)
    assert response.status_code == 404


async def test_only_the_owner_can_share_a_list(
    client: AsyncClient, auth_headers, other_auth_headers
):
    list_id = await _owner_list(client, auth_headers, ["run"])

    response = await client.post(
        f"{VOCAB}/lists/{list_id}/share/", headers=other_auth_headers
    )
    assert response.status_code == 404, response.text


async def test_importing_your_own_share_is_rejected_or_empty(
    client: AsyncClient, auth_headers
):
    """
    Власник переходить за власним посиланням — усі слова в нього вже є, тож у
    режимі skip не додається нічого.
    """
    list_id = await _owner_list(client, auth_headers, ["run"])
    token = await _share(client, auth_headers, list_id)

    response = await client.post(
        f"{SHARES}/{token}/import/",
        json={"name": "Сам собі", "mode": "skip"},
        headers=auth_headers,
    )
    assert response.status_code in (201, 400, 409), response.text
    if response.status_code == 201:
        assert response.json()["created"] == 0
        assert response.json()["list_id"] is None
