"""
Доменні правила словника з CONTEXT.md.

Тут перевіряється не «роут відповів», а «застосунок поводиться так, як
записано в глосарії». Кожен тест названо правилом, яке він тримає.
"""

from httpx import AsyncClient
from sqlalchemy import delete, select, update

from app.database.models import ReviewKindEnum, ReviewStateEnum, ReviewTrackModel

VOCAB = "/api/v1/vocabulary"
STUDY = "/api/v1/study"


async def _new_list(client: AsyncClient, headers: dict, name: str) -> int:
    response = await client.post(f"{VOCAB}/lists/", json={"name": name}, headers=headers)
    assert response.status_code == 201, response.text
    return response.json()["id"]


async def _new_card(client: AsyncClient, headers: dict, word: str, **extra) -> dict:
    payload = {"word": word, "senses": [{"translation": "переклад"}]}
    payload.update(extra)
    response = await client.post(f"{VOCAB}/cards/", json=payload, headers=headers)
    assert response.status_code == 201, response.text
    return response.json()


# --------------------------------------------------------------------------
# «Список — це мітка, а не папка»
# --------------------------------------------------------------------------


async def test_deleting_a_list_never_deletes_cards(client: AsyncClient, auth_headers):
    list_id = await _new_list(client, auth_headers, "Дієслова")
    card = await _new_card(client, auth_headers, "run", list_ids=[list_id])

    response = await client.delete(f"{VOCAB}/lists/{list_id}/", headers=auth_headers)
    assert response.status_code == 204

    response = await client.get(f"{VOCAB}/cards/{card['id']}/", headers=auth_headers)
    assert response.status_code == 200, "видалення списку знищило картку"
    assert response.json()["list_ids"] == []


async def test_card_without_a_list_lands_in_unlisted(client: AsyncClient, auth_headers):
    """
    «Без списку» — не список, а відсутність міток. Картка потрапляє туди сама,
    коли втрачає останню мітку.
    """
    list_id = await _new_list(client, auth_headers, "Дієслова")
    await _new_card(client, auth_headers, "run", list_ids=[list_id])

    await client.delete(f"{VOCAB}/lists/{list_id}/", headers=auth_headers)

    response = await client.get(f"{VOCAB}/lists/", headers=auth_headers)
    body = response.json()
    assert body["items"] == []
    assert body["unlisted"]["card_count"] == 1


async def test_card_can_live_in_several_lists_at_once(client: AsyncClient, auth_headers):
    first = await _new_list(client, auth_headers, "Дієслова")
    second = await _new_list(client, auth_headers, "Складні")

    card = await _new_card(client, auth_headers, "run", list_ids=[first, second])
    assert sorted(card["list_ids"]) == sorted([first, second])

    # І в лічильниках обох списків це одна й та сама картка, а не дві.
    response = await client.get(f"{VOCAB}/lists/", headers=auth_headers)
    counts = {item["id"]: item["card_count"] for item in response.json()["items"]}
    assert counts == {first: 1, second: 1}


async def test_removing_from_one_list_keeps_the_other(client: AsyncClient, auth_headers):
    first = await _new_list(client, auth_headers, "Дієслова")
    second = await _new_list(client, auth_headers, "Складні")
    card = await _new_card(client, auth_headers, "run", list_ids=[first, second])

    response = await client.patch(
        f"{VOCAB}/cards/{card['id']}/", json={"list_ids": [second]}, headers=auth_headers
    )
    assert response.status_code == 200, response.text
    assert response.json()["list_ids"] == [second]


# --------------------------------------------------------------------------
# «Картка унікальна в межах користувача»
# --------------------------------------------------------------------------


async def test_duplicate_word_is_rejected(client: AsyncClient, auth_headers):
    await _new_card(client, auth_headers, "run")

    response = await client.post(
        f"{VOCAB}/cards/",
        json={"word": "run", "senses": [{"translation": "інший"}]},
        headers=auth_headers,
    )
    assert response.status_code == 409, response.text


async def test_duplicate_is_detected_after_normalisation(client: AsyncClient, auth_headers):
    """
    `word_normalized` — обрізані пробіли плюс нижній регістр. «Run» і «  run »
    це одне слово, інакше словник тихо роздвоївся б, а з ним і прогрес.
    """
    await _new_card(client, auth_headers, "run")

    response = await client.post(
        f"{VOCAB}/cards/",
        json={"word": "  RuN  ", "senses": [{"translation": "інший"}]},
        headers=auth_headers,
    )
    assert response.status_code == 409, response.text


async def test_same_word_for_two_users_is_fine(
    client: AsyncClient, auth_headers, other_auth_headers
):
    """Унікальність — у межах користувача. Спільного каталогу слів немає."""
    await _new_card(client, auth_headers, "run")

    response = await client.post(
        f"{VOCAB}/cards/",
        json={"word": "run", "senses": [{"translation": "свій переклад"}]},
        headers=other_auth_headers,
    )
    assert response.status_code == 201, response.text


# --------------------------------------------------------------------------
# «Доріжка форм не видаляється ніколи»
# --------------------------------------------------------------------------


async def test_disabling_forms_drill_keeps_the_track_and_its_progress(
    client: AsyncClient, auth_headers, db_session
):
    """
    «Вимкнув на місяць» не має скидати прогрес — доріжка живе на картці, а не
    на прапорці.
    """
    card = await _new_card(
        client, auth_headers, "go", forms=[{"label": "Past", "value": "went"}]
    )
    queue = (await client.get(f"{STUDY}/queue/", headers=auth_headers)).json()
    forms_track = next(item for item in queue["items"] if item["kind"] == "forms")

    await client.post(
        f"{STUDY}/tracks/{forms_track['track_id']}/review/",
        json={"rating": 3},
        headers=auth_headers,
    )

    stability_before = (
        await db_session.execute(
            select(ReviewTrackModel.stability).where(
                ReviewTrackModel.id == forms_track["track_id"]
            )
        )
    ).scalar_one()
    assert stability_before is not None

    response = await client.patch(
        f"{VOCAB}/cards/{card['id']}/",
        json={"forms_drill_enabled": False},
        headers=auth_headers,
    )
    assert response.status_code == 200, response.text

    await db_session.commit()  # побачити те, що записав інший сеанс
    stability_after = (
        await db_session.execute(
            select(ReviewTrackModel.stability).where(
                ReviewTrackModel.id == forms_track["track_id"]
            )
        )
    ).scalar_one()
    assert stability_after == stability_before, "вимкнення тренування форм скинуло прогрес"


async def test_disabled_forms_track_disappears_from_the_queue(
    client: AsyncClient, auth_headers
):
    """Доріжка лишається в базі, але черга її не показує."""
    card = await _new_card(
        client, auth_headers, "go", forms=[{"label": "Past", "value": "went"}]
    )
    await client.patch(
        f"{VOCAB}/cards/{card['id']}/",
        json={"forms_drill_enabled": False},
        headers=auth_headers,
    )

    queue = (await client.get(f"{STUDY}/queue/", headers=auth_headers)).json()
    assert {item["kind"] for item in queue["items"]} == {"translation"}


async def test_card_without_forms_has_only_the_translation_track(
    client: AsyncClient, auth_headers, db_session
):
    """Доріжка форм заводиться разом із першою формою, а не наперед."""
    card = await _new_card(client, auth_headers, "run")

    tracks = (
        await db_session.execute(
            select(ReviewTrackModel.kind).where(ReviewTrackModel.card_id == card["id"])
        )
    ).scalars().all()
    assert set(tracks) == {ReviewKindEnum.TRANSLATION}


async def test_removing_all_forms_keeps_the_forms_track(
    client: AsyncClient, auth_headers, db_session
):
    """
    Головне про `ensure_tracks`: зайвих доріжок вона не прибирає.

    Видалення доріжки знищило б `review_logs` каскадом — сировину для підбору
    персональних параметрів, — і форма, повернута через місяць, починала б з
    нуля. Тому доріжка лишається, а з черги зникає сама.
    """
    card = await _new_card(
        client, auth_headers, "go", forms=[{"label": "Past", "value": "went"}]
    )

    response = await client.patch(
        f"{VOCAB}/cards/{card['id']}/", json={"forms": []}, headers=auth_headers
    )
    assert response.status_code == 200, response.text
    assert response.json()["forms"] == []

    await db_session.commit()
    tracks = (
        await db_session.execute(
            select(ReviewTrackModel.kind).where(ReviewTrackModel.card_id == card["id"])
        )
    ).scalars().all()
    assert ReviewKindEnum.FORMS in set(tracks), "доріжка форм зникла разом із формами"

    # А з черги — так, зникає.
    queue = (await client.get(f"{STUDY}/queue/", headers=auth_headers)).json()
    assert {item["kind"] for item in queue["items"]} == {"translation"}


# --------------------------------------------------------------------------
# «Температура» — порядок за стабільністю (ADR-0017)
# --------------------------------------------------------------------------


async def _set_translation_stability(
    db_session, card_id: int, stability: float
) -> None:
    await db_session.execute(
        update(ReviewTrackModel)
        .where(
            ReviewTrackModel.card_id == card_id,
            ReviewTrackModel.kind == ReviewKindEnum.TRANSLATION,
        )
        .values(stability=stability, state=ReviewStateEnum.REVIEW)
    )
    await db_session.commit()


async def test_stability_sort_puts_new_words_first_then_coldest(
    client: AsyncClient, auth_headers, db_session
):
    """
    Порядок `stability` — від холодного кінця рампи до теплого, нові попереду.

    Нове слово стоїть першим не тому, що воно «найслабше»: стабільності в нього
    ще немає взагалі. Підмінити її нулем означало б стверджувати «тримається
    менше дня» про слово, якого ніхто не питав.
    """
    warm = await _new_card(client, auth_headers, "warm")
    cold = await _new_card(client, auth_headers, "cold")
    fresh = await _new_card(client, auth_headers, "fresh")

    await _set_translation_stability(db_session, warm["id"], 200.0)
    await _set_translation_stability(db_session, cold["id"], 0.5)

    response = await client.get(f"{VOCAB}/cards/?sort=stability", headers=auth_headers)
    assert response.status_code == 200, response.text
    assert [item["word"] for item in response.json()["items"]] == [
        "fresh",
        "cold",
        "warm",
    ]


async def test_stability_sort_ignores_the_forms_track(
    client: AsyncClient, auth_headers, db_session
):
    """
    Сортує доріжка ПЕРЕКЛАДУ, і це не деталь реалізації.

    Цим порядком їде список, кожен рядок якого пофарбовано `cardTemperature` —
    а вона бере переклад. Візьми тут форми, і список поїхав би не за тим
    кольором, який сам показує; до того ж картка без форм опинилась би в
    привілейованому становищі проти картки з формами.
    """
    plain = await _new_card(client, auth_headers, "plain")
    with_forms = await _new_card(
        client, auth_headers, "go", forms=[{"label": "Past", "value": "went"}]
    )

    # Переклад холодний, форми — найтепліші, які взагалі бувають.
    await _set_translation_stability(db_session, with_forms["id"], 0.5)
    await _set_translation_stability(db_session, plain["id"], 100.0)
    await db_session.execute(
        update(ReviewTrackModel)
        .where(
            ReviewTrackModel.card_id == with_forms["id"],
            ReviewTrackModel.kind == ReviewKindEnum.FORMS,
        )
        .values(stability=999.0, state=ReviewStateEnum.REVIEW)
    )
    await db_session.commit()

    response = await client.get(f"{VOCAB}/cards/?sort=stability", headers=auth_headers)
    assert [item["word"] for item in response.json()["items"]] == ["go", "plain"], (
        "картку посортувало теплою доріжкою форм замість холодного перекладу"
    )


async def test_stability_sort_treats_a_trackless_card_as_new(
    client: AsyncClient, auth_headers, db_session
):
    """
    Картка без доріжки перекладу — теж «ще не міряно», тобто в голову списку.

    Це той самий стан, що NEW, і рампа фарбує її так само (`cardTemperature`
    віддає `--a0` при порожньому `tracks`). Якби NULL сортувався останнім,
    список показував би індиго внизу, а не вгорі.
    """
    measured = await _new_card(client, auth_headers, "measured")
    trackless = await _new_card(client, auth_headers, "trackless")

    await _set_translation_stability(db_session, measured["id"], 3.0)
    await db_session.execute(
        delete(ReviewTrackModel).where(ReviewTrackModel.card_id == trackless["id"])
    )
    await db_session.commit()

    response = await client.get(f"{VOCAB}/cards/?sort=stability", headers=auth_headers)
    assert [item["word"] for item in response.json()["items"]] == [
        "trackless",
        "measured",
    ]


# --------------------------------------------------------------------------
# «Картки приватні»
# --------------------------------------------------------------------------


async def test_another_users_card_is_invisible(
    client: AsyncClient, auth_headers, other_auth_headers
):
    card = await _new_card(client, auth_headers, "run")

    response = await client.get(f"{VOCAB}/cards/{card['id']}/", headers=other_auth_headers)
    assert response.status_code == 404, response.text


async def test_another_users_card_cannot_be_edited_or_deleted(
    client: AsyncClient, auth_headers, other_auth_headers
):
    card = await _new_card(client, auth_headers, "run")

    response = await client.patch(
        f"{VOCAB}/cards/{card['id']}/", json={"comment": "чуже"}, headers=other_auth_headers
    )
    assert response.status_code == 404, response.text

    response = await client.delete(f"{VOCAB}/cards/{card['id']}/", headers=other_auth_headers)
    assert response.status_code == 404, response.text


async def test_another_users_list_cannot_be_used(
    client: AsyncClient, auth_headers, other_auth_headers
):
    """Створити картку в чужому списку не можна — інакше мітки текли б між словниками."""
    list_id = await _new_list(client, auth_headers, "Дієслова")

    response = await client.post(
        f"{VOCAB}/cards/",
        json={"word": "run", "list_ids": [list_id]},
        headers=other_auth_headers,
    )
    assert response.status_code in (400, 404, 422), response.text
