"""
Доменні правила навчання з CONTEXT.md і HANDOFF.

Найдорожчі помилки проєкту живуть тут: черга, цілі й знімок дня. Кілька
тестів готують стан прямо в базі (`db_session`) — інакше довелося б чекати
шість днів, щоб слово стало «вивченим».
"""

from datetime import datetime, timedelta, timezone

from httpx import AsyncClient
from sqlalchemy import select, update

from app.database.models import (
    ReviewKindEnum,
    ReviewLogModel,
    ReviewStateEnum,
    ReviewTrackModel,
    StudyDayModel,
)

STUDY = "/api/v1/study"
VOCAB = "/api/v1/vocabulary"


async def _new_card(client: AsyncClient, headers: dict, word: str, **extra) -> dict:
    payload = {"word": word, "senses": [{"translation": "переклад"}]}
    payload.update(extra)
    response = await client.post(f"{VOCAB}/cards/", json=payload, headers=headers)
    assert response.status_code == 201, response.text
    return response.json()


async def _review(client: AsyncClient, headers: dict, track_id: int, rating: int = 3) -> dict:
    response = await client.post(
        f"{STUDY}/tracks/{track_id}/review/", json={"rating": rating}, headers=headers
    )
    assert response.status_code == 200, response.text
    return response.json()


async def _first_track(client: AsyncClient, headers: dict) -> int:
    queue = (await client.get(f"{STUDY}/queue/", headers=headers)).json()
    return queue["items"][0]["track_id"]


# --------------------------------------------------------------------------
# «Черга: спершу прострочені повторення, потім нові»
# --------------------------------------------------------------------------


async def test_overdue_reviews_come_before_new_words(
    client: AsyncClient, auth_headers, db_session
):
    """
    Якби порядок був просто випадковим, при `limit=50` із семисот доріжок
    повторення тонули б у нових — а затримка простроченого коштує
    стабільності, тоді як затримка нового не коштує нічого.
    """
    seen = await _new_card(client, auth_headers, "run")
    await _review(client, auth_headers, await _first_track(client, auth_headers))

    # Відсунемо його в минуле, щоб він знову був прострочений.
    await db_session.execute(
        update(ReviewTrackModel)
        .where(ReviewTrackModel.card_id == seen["id"])
        .values(due_at=datetime.now(timezone.utc) - timedelta(days=2))
    )
    await db_session.commit()

    # І додамо десять нових, щоб випадковість не могла дати хибно зелений тест.
    for index in range(10):
        await _new_card(client, auth_headers, f"word{index}")

    queue = (await client.get(f"{STUDY}/queue/", headers=auth_headers)).json()
    assert queue["due_count"] == 1
    assert queue["new_count"] == 10
    assert queue["items"][0]["state"] != "new", "нове слово випередило прострочене"
    assert queue["items"][0]["card"]["word"] == "run"


async def test_answering_removes_the_track_from_the_queue(
    client: AsyncClient, auth_headers
):
    await _new_card(client, auth_headers, "run")
    track_id = await _first_track(client, auth_headers)

    await _review(client, auth_headers, track_id, rating=3)

    queue = (await client.get(f"{STUDY}/queue/", headers=auth_headers)).json()
    assert track_id not in {item["track_id"] for item in queue["items"]}


async def test_queue_is_not_capped_by_the_goal(client: AsyncClient, auth_headers):
    """
    Ціль — орієнтир, а не обмеження: додаток ніколи не ховає картки, яким
    настав час.
    """
    await client.patch(
        f"{STUDY}/settings/",
        json={"daily_new_goal": 2, "daily_review_goal": 2},
        headers=auth_headers,
    )
    for index in range(6):
        await _new_card(client, auth_headers, f"word{index}")

    queue = (await client.get(f"{STUDY}/queue/", headers=auth_headers)).json()
    assert queue["new_count"] == 6
    assert len(queue["items"]) == 6


async def test_queue_filters_by_list(client: AsyncClient, auth_headers):
    response = await client.post(
        f"{VOCAB}/lists/", json={"name": "Дієслова"}, headers=auth_headers
    )
    list_id = response.json()["id"]

    await _new_card(client, auth_headers, "run", list_ids=[list_id])
    await _new_card(client, auth_headers, "table")

    queue = (
        await client.get(f"{STUDY}/queue/?list_ids={list_id}", headers=auth_headers)
    ).json()
    assert queue["new_count"] == 1
    assert queue["items"][0]["card"]["word"] == "run"


# --------------------------------------------------------------------------
# «Крок навчання: слово вертається того ж дня»
# --------------------------------------------------------------------------


async def test_forgotten_word_comes_back_the_same_day(client: AsyncClient, auth_headers):
    """
    «Не згадав» не має відкладати слово на добу — воно повертається за
    хвилини, в межах тієї ж сесії. Через це черга поповнюється сама протягом
    доби, і це нормальна поведінка, а не помилка.
    """
    await _new_card(client, auth_headers, "run")
    track_id = await _first_track(client, auth_headers)

    body = await _review(client, auth_headers, track_id, rating=1)

    due_at = datetime.fromisoformat(body["due_at"])
    assert due_at - datetime.now(timezone.utc) < timedelta(hours=1), (
        "забуте слово відклалося більш ніж на годину — кроки навчання вимкнено?"
    )


async def test_good_answer_pushes_the_word_beyond_today(client: AsyncClient, auth_headers):
    await _new_card(client, auth_headers, "run")
    track_id = await _first_track(client, auth_headers)

    body = await _review(client, auth_headers, track_id, rating=4)

    due_at = datetime.fromisoformat(body["due_at"])
    assert due_at > datetime.now(timezone.utc)


# --------------------------------------------------------------------------
# «Ціль рахує різні доріжки, а не відповіді»
# --------------------------------------------------------------------------


async def test_two_answers_on_one_track_count_as_one_unit_of_the_goal(
    client: AsyncClient, auth_headers
):
    """
    Інакше зміна кроків навчання тихо міняла б зміст самої цифри: те саме
    слово, показане тричі за день, роздувало б «повторено» втричі.
    """
    await _new_card(client, auth_headers, "run")
    track_id = await _first_track(client, auth_headers)

    await _review(client, auth_headers, track_id, rating=1)
    await _review(client, auth_headers, track_id, rating=3)

    body = (await client.get(f"{STUDY}/today/", headers=auth_headers)).json()
    assert body["reviews_done"] == 1, "лічильник рахує відповіді, а не доріжки"


async def test_two_different_tracks_count_as_two(client: AsyncClient, auth_headers):
    await _new_card(client, auth_headers, "run")
    await _new_card(client, auth_headers, "go")

    queue = (await client.get(f"{STUDY}/queue/", headers=auth_headers)).json()
    for item in queue["items"]:
        await _review(client, auth_headers, item["track_id"])

    body = (await client.get(f"{STUDY}/today/", headers=auth_headers)).json()
    assert body["reviews_done"] == 2


async def test_new_word_counts_on_the_day_it_was_created(client: AsyncClient, auth_headers):
    """Слово зараховується в ціль «додати» при створенні, а не при першому показі."""
    await _new_card(client, auth_headers, "run")

    body = (await client.get(f"{STUDY}/today/", headers=auth_headers)).json()
    assert body["new_added"] == 1
    assert body["reviews_done"] == 0


# --------------------------------------------------------------------------
# «День навчання зберігає знімок цілей, але сьогоднішній живий до півночі»
# --------------------------------------------------------------------------


async def test_raising_the_goal_reopens_today(
    client: AsyncClient, auth_headers, db_session
):
    """
    Ціль діє з миті зміни, поки день не скінчився (ADR-0023).

    Підняв планку, дійшовши до старої, — день перестає бути виконаним, бо нової
    ти ще не дійшов. Це видно й у смужці на «Сьогодні», і крапкою в календарі.
    """
    await client.patch(
        f"{STUDY}/settings/",
        json={"daily_new_goal": 1, "daily_review_goal": 1},
        headers=auth_headers,
    )
    await _new_card(client, auth_headers, "run")
    await _review(client, auth_headers, await _first_track(client, auth_headers))

    closed = (await client.get(f"{STUDY}/today/", headers=auth_headers)).json()
    assert closed["is_goal_met"] is True, "передумова тесту не виконалась"

    await client.patch(
        f"{STUDY}/settings/",
        json={"daily_new_goal": 50, "daily_review_goal": 50},
        headers=auth_headers,
    )

    body = (await client.get(f"{STUDY}/today/", headers=auth_headers)).json()
    assert body["new_goal"] == 50, "сьогоднішній день лишився зі старою ціллю"
    assert body["review_goal"] == 50
    assert body["is_goal_met"] is False

    # Календар мусить казати те саме: два джерела однієї доби не мають права
    # розходитись — саме через це «Сьогодні» й показувало не те, що профіль.
    days = (await client.get(f"{STUDY}/days/", headers=auth_headers)).json()["items"]
    assert days[-1]["review_goal"] == 50
    assert days[-1]["is_goal_met"] is False


async def test_lowering_the_goal_closes_today(client: AsyncClient, auth_headers):
    """Дзеркальний бік того самого правила: знизив планку до зробленого — день закрито."""
    await client.patch(
        f"{STUDY}/settings/",
        json={"daily_new_goal": 50, "daily_review_goal": 50},
        headers=auth_headers,
    )
    await _new_card(client, auth_headers, "run")
    await _review(client, auth_headers, await _first_track(client, auth_headers))

    assert (await client.get(f"{STUDY}/today/", headers=auth_headers)).json()[
        "is_goal_met"
    ] is False

    await client.patch(
        f"{STUDY}/settings/",
        json={"daily_new_goal": 1, "daily_review_goal": 1},
        headers=auth_headers,
    )

    body = (await client.get(f"{STUDY}/today/", headers=auth_headers)).json()
    assert body["is_goal_met"] is True


async def test_changing_the_goal_does_not_rewrite_a_past_day(
    client: AsyncClient, auth_headers, db_session
):
    """
    Ось межа, за яку правило не заходить.

    Учорашній день зберігає ті цілі, що діяли тоді, і своє «виконано». Інакше
    підняття планки заднім числом скасувало б закриті дні й обірвало серію —
    те саме, від чого захищає `ON CONFLICT DO NOTHING` в `ensure_study_day`.
    """
    await client.patch(
        f"{STUDY}/settings/",
        json={"daily_new_goal": 1, "daily_review_goal": 1},
        headers=auth_headers,
    )
    await _new_card(client, auth_headers, "run")
    await _review(client, auth_headers, await _first_track(client, auth_headers))

    # Видамо сьогоднішній день за вчорашній: чекати добу тест не може.
    row = (await db_session.execute(select(StudyDayModel))).scalars().one()
    yesterday = row.day - timedelta(days=1)
    await db_session.execute(
        update(StudyDayModel)
        .where(StudyDayModel.id == row.id)
        .values(day=yesterday, is_goal_met=True)
    )
    await db_session.commit()

    await client.patch(
        f"{STUDY}/settings/",
        json={"daily_new_goal": 50, "daily_review_goal": 50},
        headers=auth_headers,
    )

    days = (await client.get(f"{STUDY}/days/", headers=auth_headers)).json()["items"]
    past = [day for day in days if day["day"] == yesterday.isoformat()]
    assert len(past) == 1
    assert past[0]["new_goal"] == 1, "минулий день переписався поточною ціллю"
    assert past[0]["review_goal"] == 1
    assert past[0]["is_goal_met"] is True


async def test_study_day_snapshot_is_written_on_the_first_action_of_the_day(
    client: AsyncClient, auth_headers, db_session
):
    """
    Знімок пише будь-яка перша дія доби — і створення картки теж, не тільки
    відповідь. Інакше день, у який слова лише додавали, лишився б без рядка, і
    цілі для нього дописались би заднім числом уже поточні.

    Другий виклик рядка не дублює: `ON CONFLICT DO NOTHING`, бо саме перший
    запис і є правильним.
    """
    assert (await db_session.execute(select(StudyDayModel))).scalars().all() == []

    await _new_card(client, auth_headers, "run")

    await db_session.commit()
    days = (await db_session.execute(select(StudyDayModel))).scalars().all()
    assert len(days) == 1, "створення картки не зафіксувало день"

    await _review(client, auth_headers, await _first_track(client, auth_headers))

    await db_session.commit()
    days = (await db_session.execute(select(StudyDayModel))).scalars().all()
    assert len(days) == 1, "відповідь створила другий рядок на ту саму добу"


async def test_zero_goals_do_not_close_the_day(client: AsyncClient, auth_headers):
    """
    Правило зі старого PWA: ціль 0 вважається виконаною, але якщо обидві
    нульові — день не зараховується взагалі.
    """
    await client.patch(
        f"{STUDY}/settings/",
        json={"daily_new_goal": 0, "daily_review_goal": 0},
        headers=auth_headers,
    )
    await _new_card(client, auth_headers, "run")
    await _review(client, auth_headers, await _first_track(client, auth_headers))

    body = (await client.get(f"{STUDY}/today/", headers=auth_headers)).json()
    assert body["is_goal_met"] is False


async def test_both_goals_must_be_met(client: AsyncClient, auth_headers):
    await client.patch(
        f"{STUDY}/settings/",
        json={"daily_new_goal": 5, "daily_review_goal": 1},
        headers=auth_headers,
    )
    await _new_card(client, auth_headers, "run")
    await _review(client, auth_headers, await _first_track(client, auth_headers))

    body = (await client.get(f"{STUDY}/today/", headers=auth_headers)).json()
    assert body["reviews_done"] == 1
    assert body["new_added"] == 1
    # Ціль повторень виконана, ціль нових слів — ні.
    assert body["is_goal_met"] is False


# --------------------------------------------------------------------------
# «Вивчено — це стабільність доріжки перекладу»
# --------------------------------------------------------------------------


async def test_learned_counts_translation_track_only(
    client: AsyncClient, auth_headers, db_session
):
    """
    Рахується саме переклад: інакше вимкнення тренування форм тихо піднімало б
    лічильник, а картка без форм була б у привілейованому становищі.
    """
    card = await _new_card(
        client, auth_headers, "go", forms=[{"label": "Past", "value": "went"}]
    )

    # Тільки доріжка форм «дозріла».
    await db_session.execute(
        update(ReviewTrackModel)
        .where(
            ReviewTrackModel.card_id == card["id"],
            ReviewTrackModel.kind == ReviewKindEnum.FORMS,
        )
        .values(stability=12.5, state=ReviewStateEnum.REVIEW)
    )
    await db_session.commit()

    stats = (await client.get(f"{VOCAB}/stats/", headers=auth_headers)).json()
    assert stats["learned"] == 0, "форми зарахувались як вивчене слово"

    # А тепер переклад.
    await db_session.execute(
        update(ReviewTrackModel)
        .where(
            ReviewTrackModel.card_id == card["id"],
            ReviewTrackModel.kind == ReviewKindEnum.TRANSLATION,
        )
        .values(stability=12.5, state=ReviewStateEnum.REVIEW)
    )
    await db_session.commit()

    stats = (await client.get(f"{VOCAB}/stats/", headers=auth_headers)).json()
    assert stats["learned"] == 1


async def test_relearning_word_is_not_learned(
    client: AsyncClient, auth_headers, db_session
):
    """Стабільність доросла, але слово знову забули — це не «вивчено»."""
    card = await _new_card(client, auth_headers, "run")

    await db_session.execute(
        update(ReviewTrackModel)
        .where(ReviewTrackModel.card_id == card["id"])
        .values(stability=12.5, state=ReviewStateEnum.RELEARNING)
    )
    await db_session.commit()

    stats = (await client.get(f"{VOCAB}/stats/", headers=auth_headers)).json()
    assert stats["learned"] == 0


async def test_stability_below_six_days_is_not_learned(
    client: AsyncClient, auth_headers, db_session
):
    card = await _new_card(client, auth_headers, "run")

    await db_session.execute(
        update(ReviewTrackModel)
        .where(ReviewTrackModel.card_id == card["id"])
        .values(stability=5.9, state=ReviewStateEnum.REVIEW)
    )
    await db_session.commit()

    stats = (await client.get(f"{VOCAB}/stats/", headers=auth_headers)).json()
    assert stats["learned"] == 0


# --------------------------------------------------------------------------
# «Запис повторення — незмінний слід»
# --------------------------------------------------------------------------


async def test_review_log_keeps_the_state_before_the_answer(
    client: AsyncClient, auth_headers, db_session
):
    """
    Оптимізатору потрібен стан ДО відповіді — відновити його заднім числом
    неможливо, тому пишеться одразу.
    """
    await _new_card(client, auth_headers, "run")
    track_id = await _first_track(client, auth_headers)

    await _review(client, auth_headers, track_id, rating=2)

    await db_session.commit()
    log = (
        await db_session.execute(
            select(ReviewLogModel).where(ReviewLogModel.track_id == track_id)
        )
    ).scalars().one()

    assert log.rating == 2
    assert log.state_before == ReviewStateEnum.NEW
    assert log.due_at_after is not None


async def test_review_duration_is_stored_when_sent(
    client: AsyncClient, auth_headers, db_session
):
    await _new_card(client, auth_headers, "run")
    track_id = await _first_track(client, auth_headers)

    await client.post(
        f"{STUDY}/tracks/{track_id}/review/",
        json={"rating": 3, "review_duration": 4200},
        headers=auth_headers,
    )

    await db_session.commit()
    log = (
        await db_session.execute(
            select(ReviewLogModel).where(ReviewLogModel.track_id == track_id)
        )
    ).scalars().one()
    assert log.review_duration == 4200


# --------------------------------------------------------------------------
# Чуже
# --------------------------------------------------------------------------


async def test_cannot_review_another_users_track(
    client: AsyncClient, auth_headers, other_auth_headers
):
    await _new_card(client, auth_headers, "run")
    track_id = await _first_track(client, auth_headers)

    response = await client.post(
        f"{STUDY}/tracks/{track_id}/review/",
        json={"rating": 3},
        headers=other_auth_headers,
    )
    assert response.status_code == 404, response.text
