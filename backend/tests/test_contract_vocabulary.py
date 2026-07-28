"""
Контракт словника: 10 ендпоінтів, успішний шлях.

Тут не перевіряються доменні правила (це `test_domain_*`), а лише те, що роут
відповідає очікуваним кодом і у відповіді є поля, на які спиратиметься
фронтенд. Саме цей клас поломок — 500 на успішному шляху через розбіжність
схеми з моделлю — у проєкті вже траплявся (`track_id` проти `id`).
"""

from httpx import AsyncClient

API = "/api/v1/vocabulary"


async def _create_list(client: AsyncClient, headers: dict, name: str = "Загальний") -> dict:
    response = await client.post(f"{API}/lists/", json={"name": name}, headers=headers)
    assert response.status_code == 201, response.text
    return response.json()


async def _create_card(client: AsyncClient, headers: dict, **overrides) -> dict:
    payload = {
        "word": "run",
        "comment": "часто вживане",
        "list_ids": [],
        "senses": [
            {
                # У JSON їдуть ЗНАЧЕННЯ enum ("v"), хоча в базі лежать імена
                # членів ("VERB"). Розбіжність навмисна й описана в HANDOFF —
                # фронтенд бачить тільки перше.
                "part_of_speech": "v",
                "translation": "бігти",
                "transcription": "rʌn",
                "examples": [{"text_en": "I run every morning.", "text_uk": "Я бігаю щоранку."}],
            }
        ],
        "forms": [{"label": "Past", "value": "ran", "transcription": "ræn"}],
    }
    payload.update(overrides)
    response = await client.post(f"{API}/cards/", json=payload, headers=headers)
    assert response.status_code == 201, response.text
    return response.json()


# --------------------------------------------------------------------------
# Списки
# --------------------------------------------------------------------------


async def test_create_list(client: AsyncClient, auth_headers):
    body = await _create_list(client, auth_headers)

    assert body["name"] == "Загальний"
    assert body["card_count"] == 0
    assert body["due_count"] == 0
    assert body["share_token"] is None


async def test_get_lists_returns_unlisted_bucket(client: AsyncClient, auth_headers):
    await _create_list(client, auth_headers)

    response = await client.get(f"{API}/lists/", headers=auth_headers)
    assert response.status_code == 200, response.text

    body = response.json()
    assert len(body["items"]) == 1
    # «Без списку» їде завжди, навіть коли порожнє: фронтенд малює його поруч
    # зі списками як ще одну групу.
    assert body["unlisted"] == {"card_count": 0, "due_count": 0}


async def test_patch_list(client: AsyncClient, auth_headers):
    created = await _create_list(client, auth_headers)

    response = await client.patch(
        f"{API}/lists/{created['id']}/",
        json={"name": "Дієслова", "position": 3},
        headers=auth_headers,
    )
    assert response.status_code == 200, response.text
    assert response.json()["name"] == "Дієслова"
    assert response.json()["position"] == 3


async def test_delete_list(client: AsyncClient, auth_headers):
    created = await _create_list(client, auth_headers)

    response = await client.delete(f"{API}/lists/{created['id']}/", headers=auth_headers)
    assert response.status_code == 204, response.text

    response = await client.get(f"{API}/lists/", headers=auth_headers)
    assert response.json()["items"] == []


# --------------------------------------------------------------------------
# Картки
# --------------------------------------------------------------------------


async def test_create_card_returns_full_shape(client: AsyncClient, auth_headers):
    word_list = await _create_list(client, auth_headers)
    body = await _create_card(client, auth_headers, list_ids=[word_list["id"]])

    assert body["word"] == "run"
    assert body["comment"] == "часто вживане"
    assert body["forms_drill_enabled"] is True
    # `list_ids` збирається з relationship `list_links` через validation_alias —
    # рівно той механізм, на якому колись падав `track_id`.
    assert body["list_ids"] == [word_list["id"]]

    assert len(body["senses"]) == 1
    sense = body["senses"][0]
    assert sense["translation"] == "бігти"
    assert sense["part_of_speech"] == "v"
    assert len(sense["examples"]) == 1
    assert sense["examples"][0]["text_uk"] == "Я бігаю щоранку."

    assert len(body["forms"]) == 1
    assert body["forms"][0]["value"] == "ran"

    # Доріжки заводяться разом із карткою: обидві, бо форми є.
    kinds = {track["kind"] for track in body["tracks"]}
    assert kinds == {"translation", "forms"}
    assert all(track["state"] == "new" for track in body["tracks"])


async def test_get_cards_page(client: AsyncClient, auth_headers):
    await _create_card(client, auth_headers)

    response = await client.get(f"{API}/cards/", headers=auth_headers)
    assert response.status_code == 200, response.text

    body = response.json()
    assert body["total"] == 1
    assert body["page"] == 1
    assert len(body["items"]) == 1


async def test_get_single_card(client: AsyncClient, auth_headers):
    created = await _create_card(client, auth_headers)

    response = await client.get(f"{API}/cards/{created['id']}/", headers=auth_headers)
    assert response.status_code == 200, response.text
    assert response.json()["word"] == "run"


async def test_patch_card(client: AsyncClient, auth_headers):
    created = await _create_card(client, auth_headers)

    response = await client.patch(
        f"{API}/cards/{created['id']}/",
        json={"comment": "оновлено", "forms_drill_enabled": False},
        headers=auth_headers,
    )
    assert response.status_code == 200, response.text

    body = response.json()
    assert body["comment"] == "оновлено"
    assert body["forms_drill_enabled"] is False
    # Чого немає в тілі — не чіпаємо.
    assert body["word"] == "run"
    assert len(body["senses"]) == 1


async def test_delete_card(client: AsyncClient, auth_headers):
    created = await _create_card(client, auth_headers)

    response = await client.delete(f"{API}/cards/{created['id']}/", headers=auth_headers)
    assert response.status_code == 204, response.text

    response = await client.get(f"{API}/cards/{created['id']}/", headers=auth_headers)
    assert response.status_code == 404


# --------------------------------------------------------------------------
# Панель
# --------------------------------------------------------------------------


async def test_stats(client: AsyncClient, auth_headers):
    word_list = await _create_list(client, auth_headers)
    await _create_card(client, auth_headers, list_ids=[word_list["id"]])

    response = await client.get(f"{API}/stats/", headers=auth_headers)
    assert response.status_code == 200, response.text

    body = response.json()
    assert body["lists"] == 1
    assert body["cards"] == 1
    # Картка з формами дає дві доріжки, і обидві щойно створені, тобто
    # прострочені. Знаменники різні — це записано в схемі.
    assert body["due_tracks"] == 2
    assert body["learned"] == 0

    # Теплова смуга рахує тільки доріжку перекладу, тож її сума дорівнює
    # кількості карток, а не доріжок. Без цього підпис «608 слів» над смугою,
    # яка складається в 705, брехав би.
    bands = body["stability_bands"]
    assert sum(bands.values()) == body["cards"] == 1
    assert bands["new"] == 1, "щойно створена картка ще ніде не тримається"


# --------------------------------------------------------------------------
# Порядок і пошук
# --------------------------------------------------------------------------


async def test_sort_word_orders_alphabetically(client: AsyncClient, auth_headers):
    """
    Абетковий порядок потрібен саме тому, що дата не працює: імпорт (ADR-0004)
    ставить усім карткам однаковий created_at, і `sort=created` вироджується в
    порядок id.
    """
    for word in ("zebra", "apple", "mango"):
        await _create_card(client, auth_headers, word=word, senses=[], forms=[])

    response = await client.get(f"{API}/cards/?sort=word", headers=auth_headers)
    assert response.status_code == 200, response.text
    assert [item["word"] for item in response.json()["items"]] == [
        "apple",
        "mango",
        "zebra",
    ]

    # За замовчуванням порядок лишається старим — новіші зверху.
    response = await client.get(f"{API}/cards/", headers=auth_headers)
    assert [item["word"] for item in response.json()["items"]] == [
        "mango",
        "apple",
        "zebra",
    ]


async def test_unknown_sort_is_rejected(client: AsyncClient, auth_headers):
    """
    Невідоме значення — 422, а не тихе повернення до дефолту: інакше одруківка
    у фронтенді виглядала б як «сортування не працює».
    """
    response = await client.get(f"{API}/cards/?sort=stability", headers=auth_headers)
    assert response.status_code == 422


async def test_search_finds_card_by_form(client: AsyncClient, auth_headers):
    """
    143 зі 157 форм словника не є підрядком свого слова. Без пошуку по формах
    картку `go` не знайти за `went` — старий PWA це вмів, і втрата була б тихою.
    """
    await _create_card(
        client,
        auth_headers,
        word="go",
        senses=[{"translation": "йти"}],
        forms=[{"label": "Past", "value": "went"}],
    )

    response = await client.get(f"{API}/cards/?q=went", headers=auth_headers)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["total"] == 1
    assert body["items"][0]["word"] == "go"


async def test_gloss_is_rejected_now_that_the_field_is_gone(
    client: AsyncClient, auth_headers
):
    """
    «Уточнення» знесено разом із колонкою, а `extra="forbid"` перетворює його на
    422, а не на тихо проковтнуте поле. Тест тримає саме це: старий клієнт, що
    досі шле `gloss`, мусить дізнатися про це одразу.
    """
    response = await client.post(
        f"{API}/cards/",
        headers=auth_headers,
        json={"word": "run", "senses": [{"translation": "бігти", "gloss": "швидко"}]},
    )

    assert response.status_code == 422, response.text


async def test_search_still_matches_word_and_translation(
    client: AsyncClient, auth_headers
):
    """Розширення пошуку не мусить нічого зламати в тому, що вже працювало."""
    await _create_card(client, auth_headers, word="run", forms=[])

    for query in ("run", "бігти"):
        response = await client.get(f"{API}/cards/?q={query}", headers=auth_headers)
        assert response.json()["total"] == 1, query
