"""
Доменні правила Бібліотеки — ADR-0019, ADR-0020 і розділ «Бібліотека» в CONTEXT.

Найважливіші правила тут контрінтуїтивні, і саме тому вони накриті:

* публікація — ЗНІМОК: нове слово в опублікованому списку публічним не стає;
* зняття й повернення — той самий рядок разом із рейтингом (правило шеру тут
  ІНВЕРТУЄТЬСЯ);
* оцінює лише той, хто взяв, і право лишається після видалення взятого списку;
* рейтинг не показується, доки оцінок менше трьох — і в сортуванні теж.

Якщо щось із цього колись «полагодиться» назад, ці тести мусять почервоніти
першими.
"""

from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database.models import PublicationModel, UserProfileModel

VOCAB = "/api/v1/vocabulary"
LIBRARY = "/api/v1/library"


# --------------------------------------------------------------------------
# Ліси
# --------------------------------------------------------------------------


async def _name_the_author(
    db_session: AsyncSession, user, first: str = "Іван", last: str = "Хомич"
) -> None:
    """
    Ім'я й прізвище — умова публікації, і фікстура користувача їх не заповнює.

    Це не обхід перевірки, а її дзеркало: у справжньому застосунку людина
    заповнює профіль перед першою публікацією.
    """
    profile = (
        await db_session.execute(
            select(UserProfileModel).where(UserProfileModel.user_id == user.id)
        )
    ).scalars().first()

    if profile is None:
        profile = UserProfileModel(user_id=user.id)
        db_session.add(profile)

    profile.first_name = first
    profile.last_name = last
    await db_session.commit()


async def _list_with_words(
    client: AsyncClient, headers: dict, words: list[str], name: str = "Дієслова"
) -> int:
    response = await client.post(f"{VOCAB}/lists/", json={"name": name}, headers=headers)
    assert response.status_code == 201, response.text
    list_id = response.json()["id"]

    for word in words:
        created = await client.post(
            f"{VOCAB}/cards/",
            json={
                "word": word,
                "list_ids": [list_id],
                "senses": [
                    {
                        "translation": f"переклад для {word}",
                        "transcription": f"[{word}]",
                        "examples": [{"text_en": f"I {word}.", "text_uk": f"Я {word}."}],
                    }
                ],
                "forms": [{"label": "Past", "value": f"{word}-ed"}],
            },
            headers=headers,
        )
        assert created.status_code == 201, created.text
    return list_id


async def _publish(
    client: AsyncClient,
    headers: dict,
    list_id: int,
    title: str = "Неправильні дієслова для B1",
    description: str | None = "120 дієслів із формами",
) -> dict:
    response = await client.post(
        f"{VOCAB}/lists/{list_id}/publication/",
        json={"title": title, "description": description},
        headers=headers,
    )
    assert response.status_code == 200, response.text
    return response.json()


async def _take(
    client: AsyncClient, headers: dict, publication_id: int, name: str = "Взяте"
) -> dict:
    response = await client.post(
        f"{LIBRARY}/publications/{publication_id}/take/",
        json={"name": name},
        headers=headers,
    )
    assert response.status_code == 201, response.text
    return response.json()


# --------------------------------------------------------------------------
# Брама: підпис автора
# --------------------------------------------------------------------------


async def test_publishing_requires_first_and_last_name(
    client: AsyncClient, db_session: AsyncSession, user, auth_headers
):
    """
    Без імені й прізвища опублікувати не можна.

    Безіменний список у Бібліотеці не накопичує ні репутації, ні довіри: немає
    кого шукати вдруге й немає кому довіряти. Шер це правило НЕ торкається —
    там людина знає, від кого посилання.
    """
    list_id = await _list_with_words(client, auth_headers, ["run"])

    response = await client.post(
        f"{VOCAB}/lists/{list_id}/publication/",
        json={"title": "Спроба"},
        headers=auth_headers,
    )
    assert response.status_code == 409, response.text
    assert response.json()["detail"]["code"] == "author_name_required"

    # Лише ім'я — все ще ні.
    await _name_the_author(db_session, user, first="Іван", last="")
    response = await client.post(
        f"{VOCAB}/lists/{list_id}/publication/",
        json={"title": "Спроба"},
        headers=auth_headers,
    )
    assert response.status_code == 409, "прізвище теж обов'язкове"

    await _name_the_author(db_session, user)
    await _publish(client, auth_headers, list_id, title="Тепер можна")


async def test_author_label_is_name_and_surname_never_email(
    client: AsyncClient, db_session: AsyncSession, user, auth_headers,
    other_auth_headers,
):
    """
    Витрину бачить кожен користувач застосунку, тож пошта не віддається ніколи.
    """
    await _name_the_author(db_session, user, "Іван", "Хомич")
    list_id = await _list_with_words(client, auth_headers, ["run"])
    await _publish(client, auth_headers, list_id)

    body = (await client.get(f"{LIBRARY}/", headers=other_auth_headers)).json()
    assert body["items"][0]["author"] == "Іван Хомич"
    assert "owner@example.com" not in str(body)


# --------------------------------------------------------------------------
# Знімок (ADR-0019)
# --------------------------------------------------------------------------


async def test_new_word_in_a_published_list_does_not_leak(
    client: AsyncClient, db_session: AsyncSession, user, auth_headers,
    other_auth_headers,
):
    """
    ГОЛОВНЕ правило ADR-0019.

    Список — це мітка, а не папка. Якби публікація була живим дзеркалом, то
    «опублікувати» перестало б бути дією над вмістом: усе, що автор потім кине в
    цю мітку, ставало б публічним від моменту кидання — без жодної дії з
    публікацією й без попередження.
    """
    await _name_the_author(db_session, user)
    list_id = await _list_with_words(client, auth_headers, ["run", "go"])
    publication = await _publish(client, auth_headers, list_id)
    assert publication["cards_count"] == 2

    # Автор кидає в опублікований список ще одне слово.
    await client.post(
        f"{VOCAB}/cards/",
        json={"word": "secret", "list_ids": [list_id]},
        headers=auth_headers,
    )

    detail = (
        await client.get(
            f"{LIBRARY}/publications/{publication['id']}/", headers=other_auth_headers
        )
    ).json()
    assert detail["cards_count"] == 2, "нове слово протекло у публікацію без «Оновити»"

    words = (
        await client.get(
            f"{LIBRARY}/publications/{publication['id']}/cards/",
            headers=other_auth_headers,
        )
    ).json()
    assert "secret" not in [item["word"] for item in words["items"]]


async def test_refresh_moves_the_snapshot_and_keeps_the_rating(
    client: AsyncClient, db_session: AsyncSession, user, auth_headers,
    other_auth_headers,
):
    """
    «Оновити» переносить вміст і НЕ скидає рейтинг.

    Інакше автор, який виправив одну друкарську помилку, втрачав би 4.6★ — і
    більше ніколи цю кнопку не натискав. Замість доглянутих списків Бібліотека
    отримала б законсервовані з помилками (ADR-0020).
    """
    await _name_the_author(db_session, user)
    list_id = await _list_with_words(client, auth_headers, ["run", "go"])
    publication = await _publish(client, auth_headers, list_id)
    publication_id = publication["id"]

    await _take(client, other_auth_headers, publication_id)
    rated = await client.put(
        f"{LIBRARY}/publications/{publication_id}/rating/",
        json={"stars": 4},
        headers=other_auth_headers,
    )
    assert rated.status_code == 200, rated.text

    await client.post(
        f"{VOCAB}/cards/",
        json={"word": "take", "list_ids": [list_id]},
        headers=auth_headers,
    )

    refreshed = await client.post(
        f"{VOCAB}/lists/{list_id}/publication/refresh/", headers=auth_headers
    )
    assert refreshed.status_code == 200, refreshed.text
    body = refreshed.json()
    assert body["cards_count"] == 3, "знімок не переніс нове слово"
    assert body["ratings_count"] == 1, "оновлення знищило оцінку"


async def test_snapshot_carries_the_whole_content(
    client: AsyncClient, db_session: AsyncSession, user, auth_headers,
    other_auth_headers,
):
    """
    У знімку доїжджають значення, транскрипція, приклади й форми.

    Це та помилка, яка тиха й найдорожча: людина візьме список і дізнається, що
    в ньому немає транскрипцій, аж через тиждень навчання.
    """
    await _name_the_author(db_session, user)
    list_id = await _list_with_words(client, auth_headers, ["run"])
    publication = await _publish(client, auth_headers, list_id)

    page = (
        await client.get(
            f"{LIBRARY}/publications/{publication['id']}/cards/",
            headers=other_auth_headers,
        )
    ).json()
    card = page["items"][0]

    assert card["word"] == "run"
    assert card["senses"][0]["translation"] == "переклад для run"
    assert card["senses"][0]["transcription"] == "[run]"
    assert card["senses"][0]["examples"][0]["text_en"] == "I run."
    assert card["senses"][0]["examples"][0]["text_uk"] == "Я run."
    assert card["forms"][0]["value"] == "run-ed"


# --------------------------------------------------------------------------
# Зняття й повернення (ADR-0020)
# --------------------------------------------------------------------------


async def test_unpublishing_and_publishing_again_keeps_the_rating(
    client: AsyncClient, db_session: AsyncSession, user, auth_headers,
    other_auth_headers,
):
    """
    Правило шеру тут ІНВЕРТУЄТЬСЯ, і це головна причина, чому Публікація —
    окрема сутність.

    У шері вимкнене посилання не воскресає: токен адресує ДОСТУП, і старий
    лінк не має тихо ожити в чужому листуванні. Публікація адресує РЕПУТАЦІЮ,
    і зняти її на тиждень не мусить коштувати 31 оцінки.
    """
    await _name_the_author(db_session, user)
    list_id = await _list_with_words(client, auth_headers, ["run"])
    publication_id = (await _publish(client, auth_headers, list_id))["id"]

    await _take(client, other_auth_headers, publication_id)
    await client.put(
        f"{LIBRARY}/publications/{publication_id}/rating/",
        json={"stars": 5},
        headers=other_auth_headers,
    )

    off = await client.delete(
        f"{VOCAB}/lists/{list_id}/publication/", headers=auth_headers
    )
    assert off.status_code == 204

    # Знята — 410, а не 404: вона існувала, і читач має бачити різницю.
    gone = await client.get(
        f"{LIBRARY}/publications/{publication_id}/", headers=other_auth_headers
    )
    assert gone.status_code == 410, gone.text
    assert gone.json()["detail"]["code"] == "publication_unlisted"

    listing = (await client.get(f"{LIBRARY}/", headers=other_auth_headers)).json()
    assert listing["total"] == 0, "знята публікація лишилась на витрині"

    back = await _publish(client, auth_headers, list_id)
    assert back["id"] == publication_id, "повернення створило ДРУГУ публікацію"
    assert back["ratings_count"] == 1, "оцінка загинула при знятті"


async def test_one_publication_per_list(
    client: AsyncClient, db_session: AsyncSession, user, auth_headers
):
    """
    Повторний POST оновлює назву й опис, а не плодить другу публікацію.

    Ідемпотентність тут така сама, як у `share_list`. Знімок при цьому НЕ
    перезнімається: інакше правка опису тихо міняла б вміст, за який поставили
    зірки.
    """
    await _name_the_author(db_session, user)
    list_id = await _list_with_words(client, auth_headers, ["run"])

    first = await _publish(client, auth_headers, list_id, title="Перша назва")
    await client.post(
        f"{VOCAB}/cards/",
        json={"word": "go", "list_ids": [list_id]},
        headers=auth_headers,
    )
    second = await _publish(client, auth_headers, list_id, title="Друга назва")

    assert second["id"] == first["id"]
    assert second["title"] == "Друга назва"
    assert second["cards_count"] == 1, "повторна публікація перезняла знімок"

    rows = (
        await db_session.execute(
            select(PublicationModel).where(PublicationModel.list_id == list_id)
        )
    ).scalars().all()
    assert len(rows) == 1


async def test_publication_survives_the_list_and_loses_update(
    client: AsyncClient, db_session: AsyncSession, user, auth_headers,
    other_auth_headers,
):
    """
    Видаливши свій список, автор не забирає публікацію з Бібліотеки.

    Знімок самодостатній, тож список лишається корисним тим, хто його знайшов.
    Гине лише можливість оновити, і про це каже `can_update`.
    """
    await _name_the_author(db_session, user)
    list_id = await _list_with_words(client, auth_headers, ["run"])
    publication_id = (await _publish(client, auth_headers, list_id))["id"]

    dropped = await client.delete(f"{VOCAB}/lists/{list_id}/", headers=auth_headers)
    assert dropped.status_code == 204, dropped.text

    alive = await client.get(
        f"{LIBRARY}/publications/{publication_id}/", headers=other_auth_headers
    )
    assert alive.status_code == 200, "публікація загинула разом зі списком"
    assert alive.json()["cards_count"] == 1, "знімок загинув разом зі списком"


# --------------------------------------------------------------------------
# Взяття
# --------------------------------------------------------------------------


async def test_taking_skips_what_you_have_and_names_it(
    client: AsyncClient, db_session: AsyncSession, user, auth_headers,
    other_auth_headers,
):
    """
    Наявні слова пропускаються — і НАЗИВАЮТЬСЯ.

    Список неповний за визначенням (ADR-0005), і неповнота, про яку не сказали,
    читається як загублені слова.
    """
    await _name_the_author(db_session, user)
    list_id = await _list_with_words(client, auth_headers, ["run", "go", "take"])
    publication_id = (await _publish(client, auth_headers, list_id))["id"]

    await client.post(
        f"{VOCAB}/cards/",
        json={"word": "go", "senses": [{"translation": "мій власний переклад"}]},
        headers=other_auth_headers,
    )

    detail = (
        await client.get(
            f"{LIBRARY}/publications/{publication_id}/", headers=other_auth_headers
        )
    ).json()
    assert detail["cards_count"] == 3
    assert detail["new_cards"] == 2, "наслідок кнопки видно ще до натискання"

    result = await _take(client, other_auth_headers, publication_id)
    assert result["created"] == 2
    assert result["skipped"] == 1
    assert result["skipped_words"] == ["go"]
    assert "overwritten" not in result, "у Бібліотеці немає перезапису"

    # Чуже не має права ні змінити твою картку, ні домалювати їй мітку.
    cards = (await client.get(f"{VOCAB}/cards/", headers=other_auth_headers)).json()
    mine = next(card for card in cards["items"] if card["word"] == "go")
    assert mine["senses"][0]["translation"] == "мій власний переклад"
    assert mine["list_ids"] == []


async def test_taking_records_the_take_even_when_nothing_is_added(
    client: AsyncClient, db_session: AsyncSession, user, auth_headers,
    other_auth_headers,
):
    """
    Взяття записується, навіть якщо жодного слова не додалось.

    Людина справді брала цю публікацію, і на цьому стоїть її право поставити
    зірки. Списку при цьому не створюємо: порожня іменована мітка була б
    сміттям.
    """
    await _name_the_author(db_session, user)
    list_id = await _list_with_words(client, auth_headers, ["run"])
    publication_id = (await _publish(client, auth_headers, list_id))["id"]

    await client.post(
        f"{VOCAB}/cards/", json={"word": "run"}, headers=other_auth_headers
    )

    result = await _take(client, other_auth_headers, publication_id)
    assert result["created"] == 0
    assert result["list_id"] is None, "створився порожній список"
    assert result["skipped_words"] == ["run"]

    detail = (
        await client.get(
            f"{LIBRARY}/publications/{publication_id}/", headers=other_auth_headers
        )
    ).json()
    assert detail["is_taken"] is True
    assert detail["can_rate"] is True, "право на оцінку не з'явилось"
    assert detail["takes_count"] == 1


async def test_taking_twice_counts_one_person(
    client: AsyncClient, db_session: AsyncSession, user, auth_headers,
    other_auth_headers,
):
    """
    Популярність рахує ЛЮДЕЙ, а не натискання.

    Той самий список можна взяти повторно під іншою назвою — і без складеного
    ключа одна людина накрутила б «взяли 3».
    """
    await _name_the_author(db_session, user)
    list_id = await _list_with_words(client, auth_headers, ["run", "go"])
    publication_id = (await _publish(client, auth_headers, list_id))["id"]

    await _take(client, other_auth_headers, publication_id, name="Перше")
    await _take(client, other_auth_headers, publication_id, name="Друге")

    detail = (
        await client.get(
            f"{LIBRARY}/publications/{publication_id}/", headers=other_auth_headers
        )
    ).json()
    assert detail["takes_count"] == 1


async def test_own_publication_cannot_be_taken(
    client: AsyncClient, db_session: AsyncSession, user, auth_headers
):
    await _name_the_author(db_session, user)
    list_id = await _list_with_words(client, auth_headers, ["run"])
    publication_id = (await _publish(client, auth_headers, list_id))["id"]

    response = await client.post(
        f"{LIBRARY}/publications/{publication_id}/take/",
        json={"name": "Своє"},
        headers=auth_headers,
    )
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "own_publication"


async def test_taken_list_remembers_where_it_came_from(
    client: AsyncClient, db_session: AsyncSession, user, other_user, auth_headers,
    other_auth_headers,
):
    """
    Провенанс: публікуючи взятий список, автор отримує позначку походження.

    Без неї витрина заповнюється копіями, а через пропуск наявних копія ще й
    неповна проти оригіналу.
    """
    await _name_the_author(db_session, user)
    await _name_the_author(db_session, other_user, "Олена", "Коваль")

    list_id = await _list_with_words(client, auth_headers, ["run", "go"])
    original_id = (await _publish(client, auth_headers, list_id, title="Оригінал"))["id"]

    taken = await _take(client, other_auth_headers, original_id, name="Моя копія")
    derived = await _publish(
        client, other_auth_headers, taken["list_id"], title="Копія плюс моє"
    )

    listing = (await client.get(f"{LIBRARY}/", headers=auth_headers)).json()
    row = next(item for item in listing["items"] if item["id"] == derived["id"])
    assert row["derived_from_title"] == "Оригінал"

    original_row = next(
        item for item in listing["items"] if item["id"] == original_id
    )
    assert original_row["derived_from_title"] is None


# --------------------------------------------------------------------------
# Рейтинг
# --------------------------------------------------------------------------


async def test_only_a_taker_can_rate(
    client: AsyncClient, db_session: AsyncSession, user, auth_headers,
    other_auth_headers,
):
    """
    Рейтинг означає «я цим користувався», а не «мені сподобалась назва».

    Накрутити важко: щоб оцінити, треба спершу засмітити власний словник.
    """
    await _name_the_author(db_session, user)
    list_id = await _list_with_words(client, auth_headers, ["run"])
    publication_id = (await _publish(client, auth_headers, list_id))["id"]

    refused = await client.put(
        f"{LIBRARY}/publications/{publication_id}/rating/",
        json={"stars": 5},
        headers=other_auth_headers,
    )
    assert refused.status_code == 403, refused.text
    assert refused.json()["detail"]["code"] == "take_required"

    await _take(client, other_auth_headers, publication_id)
    allowed = await client.put(
        f"{LIBRARY}/publications/{publication_id}/rating/",
        json={"stars": 5},
        headers=other_auth_headers,
    )
    assert allowed.status_code == 200, allowed.text


async def test_rating_survives_deleting_the_taken_list(
    client: AsyncClient, db_session: AsyncSession, user, auth_headers,
    other_auth_headers,
):
    """
    Право оцінити переживає видалення взятого списку.

    Ти справді брав, і право сказати про це не зникає з прибиранням у себе. Саме
    тому перевіряється взяття, а не наявність списку — а видалення списку є
    швидше підставою поставити 2★, ніж втратити голос.
    """
    await _name_the_author(db_session, user)
    list_id = await _list_with_words(client, auth_headers, ["run"])
    publication_id = (await _publish(client, auth_headers, list_id))["id"]

    taken = await _take(client, other_auth_headers, publication_id)
    await client.delete(f"{VOCAB}/lists/{taken['list_id']}/", headers=other_auth_headers)

    response = await client.put(
        f"{LIBRARY}/publications/{publication_id}/rating/",
        json={"stars": 2},
        headers=other_auth_headers,
    )
    assert response.status_code == 200, response.text
    assert response.json()["own_stars"] == 2


async def test_rating_is_replaced_not_added(
    client: AsyncClient, db_session: AsyncSession, user, auth_headers,
    other_auth_headers,
):
    """PUT: одна людина — одна оцінка, повторний виклик її замінює."""
    await _name_the_author(db_session, user)
    list_id = await _list_with_words(client, auth_headers, ["run"])
    publication_id = (await _publish(client, auth_headers, list_id))["id"]
    await _take(client, other_auth_headers, publication_id)

    for stars in (5, 3, 1):
        body = (
            await client.put(
                f"{LIBRARY}/publications/{publication_id}/rating/",
                json={"stars": stars},
                headers=other_auth_headers,
            )
        ).json()
        assert body["ratings_count"] == 1
        assert body["own_stars"] == stars


async def test_stars_outside_one_to_five_are_rejected(
    client: AsyncClient, db_session: AsyncSession, user, auth_headers,
    other_auth_headers,
):
    await _name_the_author(db_session, user)
    list_id = await _list_with_words(client, auth_headers, ["run"])
    publication_id = (await _publish(client, auth_headers, list_id))["id"]
    await _take(client, other_auth_headers, publication_id)

    for stars in (0, 6, -1):
        response = await client.put(
            f"{LIBRARY}/publications/{publication_id}/rating/",
            json={"stars": stars},
            headers=other_auth_headers,
        )
        assert response.status_code == 422, f"{stars} прийнято"


# --------------------------------------------------------------------------
# Скарга
# --------------------------------------------------------------------------


async def test_report_does_not_need_a_take_and_weighs_people(
    client: AsyncClient, db_session: AsyncSession, user, auth_headers,
    other_auth_headers,
):
    """
    На обсценний список скаржаться саме тому, що НЕ хочуть його брати.

    Друга скарга тієї самої людини змінює причину, а не додає ваги. Лічильник
    скарг назовні не віддається взагалі: показувати його публічно означало б дати
    спосіб цькувати автора числом.
    """
    await _name_the_author(db_session, user)
    list_id = await _list_with_words(client, auth_headers, ["run"])
    publication_id = (await _publish(client, auth_headers, list_id))["id"]

    first = await client.post(
        f"{LIBRARY}/publications/{publication_id}/report/",
        json={"reason": "spam"},
        headers=other_auth_headers,
    )
    assert first.status_code == 204, first.text

    second = await client.post(
        f"{LIBRARY}/publications/{publication_id}/report/",
        json={"reason": "obscene"},
        headers=other_auth_headers,
    )
    assert second.status_code == 204

    detail = (
        await client.get(
            f"{LIBRARY}/publications/{publication_id}/", headers=other_auth_headers
        )
    ).json()
    assert detail["own_report"] == "obscene", "друга скарга не змінила причину"
    assert "reports_count" not in detail


async def test_report_reason_is_a_closed_set(
    client: AsyncClient, db_session: AsyncSession, user, auth_headers,
    other_auth_headers,
):
    """Вільного тексту в скарзі немає — він сам стає тим, що треба модерувати."""
    await _name_the_author(db_session, user)
    list_id = await _list_with_words(client, auth_headers, ["run"])
    publication_id = (await _publish(client, auth_headers, list_id))["id"]

    response = await client.post(
        f"{LIBRARY}/publications/{publication_id}/report/",
        json={"reason": "автор мене образив"},
        headers=other_auth_headers,
    )
    assert response.status_code == 422


# --------------------------------------------------------------------------
# Поріг видимості рейтингу
#
# Правило живе єдиним SQL-виразом (`cruds/library._VISIBLE_RATING`), бо витрина
# сортує за рейтингом у базі з LIMIT/OFFSET — поріг, застосований після вибірки,
# не працював би зовсім. Пітонівської копії немає навмисно, тож накрити його можна
# лише тут, проти живої бази.
# --------------------------------------------------------------------------


async def _rate_by_strangers(
    client: AsyncClient,
    db_session: AsyncSession,
    make_user,
    publication_id: int,
    stars: list[int],
) -> None:
    """
    Стільки різних людей, скільки оцінок: кожна мусить спершу взяти список.

    Пошта не задається — лічильник фабрики монотонний у межах тесту. Свої
    «rater{index}» тут уже ламались: index починається з нуля в КОЖНОМУ виклику,
    тож два виклики поспіль упирались в UNIQUE(email).
    """
    for index, value in enumerate(stars):
        _, headers = await make_user()
        await _take(client, headers, publication_id, name=f"Взяте {index}")
        response = await client.put(
            f"{LIBRARY}/publications/{publication_id}/rating/",
            json={"stars": value},
            headers=headers,
        )
        assert response.status_code == 200, response.text


async def test_rating_is_hidden_below_three_votes(
    client: AsyncClient, db_session: AsyncSession, user, auth_headers, make_user
):
    """
    Одна й дві оцінки — це «поки без оцінок», а не число.

    Причина не в математиці: «4.9 з однієї оцінки» стало б вище за «4.6 з
    тридцяти» в сортуванні. Кількість при цьому чесна завжди — ховається саме
    середнє.
    """
    await _name_the_author(db_session, user)
    list_id = await _list_with_words(client, auth_headers, ["run", "go", "take"])
    publication_id = (await _publish(client, auth_headers, list_id))["id"]

    for expected_count in (1, 2):
        await _rate_by_strangers(client, db_session, make_user, publication_id, [5])
        row = (await client.get(f"{LIBRARY}/", headers=auth_headers)).json()["items"][0]
        assert row["ratings_count"] == expected_count
        assert row["rating"] is None, f"{expected_count} оцінки дали число"

    await _rate_by_strangers(client, db_session, make_user, publication_id, [5])
    row = (await client.get(f"{LIBRARY}/", headers=auth_headers)).json()["items"][0]
    assert row["ratings_count"] == 3
    assert row["rating"] == 5.0, "на третій оцінці рейтинг мусить з'явитись"


async def test_rating_is_rounded_to_one_decimal(
    client: AsyncClient, db_session: AsyncSession, user, auth_headers, make_user
):
    """
    Різниця між 4.66 і 4.67 не існує для людини, а два знаки створюють враження
    точності, якої в трьох оцінках немає.
    """
    await _name_the_author(db_session, user)
    list_id = await _list_with_words(client, auth_headers, ["run", "go", "take"])
    publication_id = (await _publish(client, auth_headers, list_id))["id"]

    await _rate_by_strangers(client, db_session, make_user, publication_id, [5, 4, 5])
    row = (await client.get(f"{LIBRARY}/", headers=auth_headers)).json()["items"][0]
    assert row["rating"] == 4.7


async def test_unrated_publications_sort_last_by_rating(
    client: AsyncClient, db_session: AsyncSession, user, auth_headers, make_user
):
    """
    Найважливіший наслідок того, що поріг живе в SQL.

    Публікація з однією п'ятіркою НЕ має обігнати ту, що має 4.0 із трьох
    голосів: у сортуванні вона неоцінена, як і та, що не має оцінок зовсім.
    Порахуй ми поріг у Python — тут була б саме та витрина, де число не
    збігається з місцем.
    """
    await _name_the_author(db_session, user)

    rated_list = await _list_with_words(client, auth_headers, ["run", "go"], name="Оцінена")
    rated_id = (await _publish(client, auth_headers, rated_list, title="Оцінена"))["id"]

    single_list = await _list_with_words(
        client, auth_headers, ["take", "make"], name="Одна п'ятірка"
    )
    single_id = (
        await _publish(client, auth_headers, single_list, title="Одна п'ятірка")
    )["id"]

    silent_list = await _list_with_words(
        client, auth_headers, ["give", "keep"], name="Без оцінок"
    )
    silent_id = (await _publish(client, auth_headers, silent_list, title="Без оцінок"))["id"]

    await _rate_by_strangers(client, db_session, make_user, rated_id, [4, 4, 4])
    await _rate_by_strangers(client, db_session, make_user, single_id, [5])

    body = (
        await client.get(f"{LIBRARY}/?sort=rating", headers=auth_headers)
    ).json()
    order = [item["id"] for item in body["items"]]

    assert order[0] == rated_id, "одна п'ятірка обігнала три четвірки"
    assert set(order[1:]) == {single_id, silent_id}, (
        "неоцінена й недооцінена мусять бути в хвості разом"
    )


async def test_sorting_by_popularity_counts_takers(
    client: AsyncClient, db_session: AsyncSession, user, auth_headers, make_user
):
    """`popular` — за охопленням, тобто за кількістю різних людей."""
    await _name_the_author(db_session, user)

    quiet = await _list_with_words(client, auth_headers, ["run"], name="Тиха")
    quiet_id = (await _publish(client, auth_headers, quiet, title="Тиха"))["id"]

    loud = await _list_with_words(client, auth_headers, ["go"], name="Популярна")
    loud_id = (await _publish(client, auth_headers, loud, title="Популярна"))["id"]

    for index in range(2):
        _, headers = await make_user(f"taker{index}@example.com")
        await _take(client, headers, loud_id, name="Взяте")

    _, headers = await make_user("lonely@example.com")
    await _take(client, headers, quiet_id, name="Взяте")

    body = (await client.get(f"{LIBRARY}/?sort=popular", headers=auth_headers)).json()
    assert [item["id"] for item in body["items"]] == [loud_id, quiet_id]


async def test_search_looks_at_title_and_description(
    client: AsyncClient, db_session: AsyncSession, user, auth_headers
):
    await _name_the_author(db_session, user)

    first = await _list_with_words(client, auth_headers, ["run"], name="A")
    await _publish(
        client, auth_headers, first, title="Фразові дієслова", description="для B1"
    )

    second = await _list_with_words(client, auth_headers, ["go"], name="B")
    await _publish(
        client, auth_headers, second, title="IELTS Academic", description="слова для іспиту"
    )

    by_title = (await client.get(f"{LIBRARY}/?q=фразові", headers=auth_headers)).json()
    assert [item["title"] for item in by_title["items"]] == ["Фразові дієслова"]

    by_description = (
        await client.get(f"{LIBRARY}/?q=іспиту", headers=auth_headers)
    ).json()
    assert [item["title"] for item in by_description["items"]] == ["IELTS Academic"]

    nothing = (await client.get(f"{LIBRARY}/?q=котики", headers=auth_headers)).json()
    assert nothing["total"] == 0
