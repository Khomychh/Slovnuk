"""
Контракт навчання: 6 ендпоінтів, успішний шлях.

`track_id` у відповідях черги та оцінки збирається через
`Field(validation_alias="id")`. Без нього `model_validate(track)` падає з
«Field required», тобто роут віддає 500 саме тоді, коли все інше спрацювало.
Схему, яку жодного разу не проганяли крізь реальні дані, це ловить тільки
такий тест.
"""

from httpx import AsyncClient

API = "/api/v1/study"
VOCAB = "/api/v1/vocabulary"


async def _create_card(client: AsyncClient, headers: dict, word: str = "run", **extra) -> dict:
    payload = {
        "word": word,
        "senses": [{"part_of_speech": "v", "translation": "бігти"}],
        "forms": [{"label": "Past", "value": "ran"}],
    }
    payload.update(extra)
    response = await client.post(f"{VOCAB}/cards/", json=payload, headers=headers)
    assert response.status_code == 201, response.text
    return response.json()


# --------------------------------------------------------------------------
# Черга
# --------------------------------------------------------------------------


async def test_queue_is_empty_for_new_user(client: AsyncClient, auth_headers):
    response = await client.get(f"{API}/queue/", headers=auth_headers)
    assert response.status_code == 200, response.text

    body = response.json()
    assert body == {"due_count": 0, "new_count": 0, "items": []}


async def test_queue_returns_both_tracks_of_a_card(client: AsyncClient, auth_headers):
    card = await _create_card(client, auth_headers)

    response = await client.get(f"{API}/queue/", headers=auth_headers)
    assert response.status_code == 200, response.text

    body = response.json()
    # Картка з формами дає дві доріжки — і саме тому «слів» і «на повторення»
    # це різні числа.
    assert body["new_count"] == 2
    assert len(body["items"]) == 2

    item = body["items"][0]
    assert item["track_id"] > 0, "track_id не заповнився з колонки id"
    assert item["state"] == "new"
    assert item["card"]["id"] == card["id"]
    assert item["card"]["word"] == "run"
    # Форми їдуть завжди, навіть коли показується доріжка перекладу.
    assert item["card"]["forms"][0]["value"] == "ran"


async def test_queue_carries_interval_preview(client: AsyncClient, auth_headers):
    """
    Прогноз їде разом із карткою, бо офлайн-відповідь не отримує від сервера
    нічого, а підпис «наступного разу — за N» показати треба (ADR-0009).
    """
    await _create_card(client, auth_headers)

    body = (await client.get(f"{API}/queue/", headers=auth_headers)).json()
    preview = body["items"][0]["preview"]

    assert set(preview) == {"again", "hard", "good", "easy"}
    # Кроки навчання: нове слово повертається через хвилини, тому одиниця —
    # секунда. У днях перші три оцінки дали б нуль.
    assert preview["again"] < preview["hard"] < preview["good"] < preview["easy"]
    assert preview["again"] < 3600, "«Не згадав» на новому слові — це хвилини"
    assert preview["easy"] > 86400, "«Легко» на новому слові — це дні"


async def test_queue_preview_does_not_schedule_anything(
    client: AsyncClient, auth_headers
):
    """
    Прогноз рахує чотири варіанти, але доріжку лишає незайманою: два запити
    черги поспіль мають дати те саме, і слово має лишитись новим.
    """
    await _create_card(client, auth_headers)

    first = (await client.get(f"{API}/queue/", headers=auth_headers)).json()
    second = (await client.get(f"{API}/queue/", headers=auth_headers)).json()

    assert second["new_count"] == first["new_count"] == 2
    by_track = {item["track_id"]: item for item in second["items"]}
    for item in first["items"]:
        same = by_track[item["track_id"]]
        assert same["state"] == item["state"] == "new"
        assert same["preview"] == item["preview"]


async def test_queue_respects_limit(client: AsyncClient, auth_headers):
    await _create_card(client, auth_headers, word="run")
    await _create_card(client, auth_headers, word="go")

    response = await client.get(f"{API}/queue/?limit=1", headers=auth_headers)
    assert response.status_code == 200, response.text

    body = response.json()
    assert len(body["items"]) == 1
    # Лічильники стосуються всієї вибірки, а не порції: екран показує все,
    # що чекає, навіть коли items обрізані лімітом.
    assert body["new_count"] == 4


async def test_queue_limit_zero_counts_only(client: AsyncClient, auth_headers):
    """
    limit=0 — самі лічильники, без карток.

    Так фронтенд питає «скільки їх тепер», поки людина переводить вибір груп:
    кнопка «Вчити» стоїть просто над панеллю вибору й мусить говорити про той
    вибір, який зараз на екрані. Тягти на кожен дотик 50 карток із прогнозами
    інтервалів заради двох чисел було б марно.
    """
    await _create_card(client, auth_headers, word="run")
    await _create_card(client, auth_headers, word="go")

    response = await client.get(f"{API}/queue/?limit=0", headers=auth_headers)
    assert response.status_code == 200, response.text

    body = response.json()
    assert body["items"] == []
    assert body["new_count"] == 4


# --------------------------------------------------------------------------
# Оцінка
# --------------------------------------------------------------------------


async def test_review_track(client: AsyncClient, auth_headers):
    await _create_card(client, auth_headers)
    queue = (await client.get(f"{API}/queue/", headers=auth_headers)).json()
    track_id = queue["items"][0]["track_id"]

    response = await client.post(
        f"{API}/tracks/{track_id}/review/",
        json={"rating": 3, "review_duration": 4200},
        headers=auth_headers,
    )
    assert response.status_code == 200, response.text

    body = response.json()
    assert body["track_id"] == track_id
    assert body["state"] != "new", "після відповіді доріжка не може лишатись NEW"
    assert body["stability"] is not None
    assert body["difficulty"] is not None


async def test_review_without_duration_is_accepted(client: AsyncClient, auth_headers):
    """
    `review_duration` міряє фронтенд, і колонка приймає NULL — бекенд без неї
    ламатись не повинен.
    """
    await _create_card(client, auth_headers)
    queue = (await client.get(f"{API}/queue/", headers=auth_headers)).json()
    track_id = queue["items"][0]["track_id"]

    response = await client.post(
        f"{API}/tracks/{track_id}/review/",
        json={"rating": 3},
        headers=auth_headers,
    )
    assert response.status_code == 200, response.text


# --------------------------------------------------------------------------
# День і календар
# --------------------------------------------------------------------------


async def test_today(client: AsyncClient, auth_headers):
    response = await client.get(f"{API}/today/", headers=auth_headers)
    assert response.status_code == 200, response.text

    body = response.json()
    assert body["new_added"] == 0
    assert body["reviews_done"] == 0
    assert body["new_goal"] >= 0
    assert body["review_goal"] >= 0
    assert body["is_goal_met"] is False


async def test_today_counts_created_card_and_review(client: AsyncClient, auth_headers):
    await _create_card(client, auth_headers)
    queue = (await client.get(f"{API}/queue/", headers=auth_headers)).json()
    await client.post(
        f"{API}/tracks/{queue['items'][0]['track_id']}/review/",
        json={"rating": 3},
        headers=auth_headers,
    )

    response = await client.get(f"{API}/today/", headers=auth_headers)
    assert response.status_code == 200, response.text

    body = response.json()
    assert body["new_added"] == 1
    assert body["reviews_done"] == 1


async def test_days_calendar(client: AsyncClient, auth_headers):
    await _create_card(client, auth_headers)
    queue = (await client.get(f"{API}/queue/", headers=auth_headers)).json()
    await client.post(
        f"{API}/tracks/{queue['items'][0]['track_id']}/review/",
        json={"rating": 3},
        headers=auth_headers,
    )

    response = await client.get(f"{API}/days/", headers=auth_headers)
    assert response.status_code == 200, response.text

    items = response.json()["items"]
    assert len(items) == 1
    day = items[0]
    assert day["new_count"] == 1
    assert day["review_count"] == 1


async def test_days_calendar_is_empty_without_activity(client: AsyncClient, auth_headers):
    """Рядок зʼявляється лише за дні, що мають знімок цілей."""
    response = await client.get(f"{API}/days/", headers=auth_headers)
    assert response.status_code == 200, response.text
    assert response.json()["items"] == []


# --------------------------------------------------------------------------
# Налаштування
# --------------------------------------------------------------------------


async def test_get_settings(client: AsyncClient, auth_headers):
    response = await client.get(f"{API}/settings/", headers=auth_headers)
    assert response.status_code == 200, response.text

    body = response.json()
    assert body["daily_review_goal"] == 30
    assert 0.7 <= body["desired_retention"] <= 0.99
    # Самі ваги назовні не віддаються — лише прапорець «підібрано чи ні».
    assert "fsrs_parameters" not in body
    assert body["has_personal_parameters"] is False


async def test_patch_settings(client: AsyncClient, auth_headers):
    response = await client.patch(
        f"{API}/settings/",
        json={"theme": "dark", "daily_new_goal": 7, "timezone": "Europe/Kyiv"},
        headers=auth_headers,
    )
    assert response.status_code == 200, response.text

    body = response.json()
    assert body["theme"] == "dark"
    assert body["daily_new_goal"] == 7
    assert body["timezone"] == "Europe/Kyiv"


async def test_patch_settings_rejects_bad_timezone(client: AsyncClient, auth_headers):
    """
    `func.timezone(tz, ts)` падає на сміттєвій назві поясу — тобто 500 на
    одруківці. Межу тримає схема, і знімати її звідти не можна.
    """
    response = await client.patch(
        f"{API}/settings/", json={"timezone": "Europe/Kyyiv"}, headers=auth_headers
    )
    assert response.status_code == 422


async def test_patch_settings_rejects_fsrs_parameters(client: AsyncClient, auth_headers):
    """Ваги пише лише скрипт оптимізатора; через API — 422, а не тихе ігнорування."""
    response = await client.patch(
        f"{API}/settings/", json={"fsrs_parameters": [0.1] * 21}, headers=auth_headers
    )
    assert response.status_code == 422


async def test_patch_settings_rejects_retention_out_of_range(
    client: AsyncClient, auth_headers
):
    """`Scheduler` не валідує desired_retention сам — 5.0 тихо зіпсував би все."""
    response = await client.patch(
        f"{API}/settings/", json={"desired_retention": 5.0}, headers=auth_headers
    )
    assert response.status_code == 422


# --------------------------------------------------------------------------
# Список за замовчуванням
# --------------------------------------------------------------------------


async def _create_list(client: AsyncClient, headers: dict, name: str) -> dict:
    response = await client.post(f"{VOCAB}/lists/", json={"name": name}, headers=headers)
    assert response.status_code == 201, response.text
    return response.json()


async def test_default_list_starts_unset(client: AsyncClient, auth_headers):
    """Не позначено жодного — нормальний стан, а не «не налаштовано»."""
    response = await client.get(f"{API}/settings/", headers=auth_headers)
    assert response.status_code == 200, response.text
    assert response.json()["default_list_id"] is None


async def test_set_and_clear_default_list(client: AsyncClient, auth_headers):
    word_list = await _create_list(client, auth_headers, "Загальний")

    response = await client.patch(
        f"{API}/settings/",
        json={"default_list_id": word_list["id"]},
        headers=auth_headers,
    )
    assert response.status_code == 200, response.text
    assert response.json()["default_list_id"] == word_list["id"]

    # Явний null знімає позначку. Це єдине поле, де null означає дію, а не
    # «не передали», і саме тому воно перевіряється окремо.
    response = await client.patch(
        f"{API}/settings/", json={"default_list_id": None}, headers=auth_headers
    )
    assert response.status_code == 200, response.text
    assert response.json()["default_list_id"] is None


async def test_default_list_must_be_own(
    client: AsyncClient, auth_headers, other_auth_headers
):
    """
    Чужий список — 422, а не тихе збереження: користувач побачив би
    «збережено», а нові картки йшли б у список, якого він не бачить.
    """
    stranger_list = await _create_list(client, other_auth_headers, "Чужий")

    response = await client.patch(
        f"{API}/settings/",
        json={"default_list_id": stranger_list["id"]},
        headers=auth_headers,
    )
    assert response.status_code == 422, response.text
    assert response.json()["detail"]["code"] == "unknown_list_ids"


async def test_deleting_list_clears_default(client: AsyncClient, auth_headers):
    """
    ON DELETE SET NULL. Інакше видалення списку або падало б, або лишало
    позначку, що вказує в нікуди, — і нові картки тихо йшли б у порожнечу.
    """
    word_list = await _create_list(client, auth_headers, "Тимчасовий")
    await client.patch(
        f"{API}/settings/",
        json={"default_list_id": word_list["id"]},
        headers=auth_headers,
    )

    response = await client.delete(
        f"{VOCAB}/lists/{word_list['id']}/", headers=auth_headers
    )
    assert response.status_code == 204, response.text

    response = await client.get(f"{API}/settings/", headers=auth_headers)
    assert response.json()["default_list_id"] is None


async def test_explicit_null_on_not_null_field_is_ignored(
    client: AsyncClient, auth_headers
):
    """
    Раніше {"theme": null} доходив до setattr і давав 500 на IntegrityError.
    Тепер null ігнорується для всіх колонок, крім default_list_id.
    """
    response = await client.patch(
        f"{API}/settings/", json={"theme": None}, headers=auth_headers
    )
    assert response.status_code == 200, response.text
    assert response.json()["theme"] is not None
