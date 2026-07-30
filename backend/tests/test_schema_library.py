"""
Правила виживання публікації — ADR-0019 і ADR-0020.

Тут перевіряється не код, а СХЕМА: чиї видалення публікація переживає, а чиї ні.
Усе це живе в `ondelete` на п'яти FK, тобто в одному рядку міграції кожне — і
саме тому найлегше ламається тихо. Наступний `alembic revision --autogenerate`,
запущений із моделі, де хтось «причесав» SET NULL на CASCADE, не скаже нічого;
почервоніти мусять ці тести.

Роутів Бібліотеки ще немає, тож усе робиться сесією напряму. Це навмисно: правила
належать базі, а не роутам, і мусять триматись незалежно від того, який код їх
колись викликатиме.

Видалення робляться Core-запитом `delete(...)`, а НЕ `session.delete(obj)`. Це не
дрібниця стилю: `session.delete` виконує каскади SQLAlchemy — тобто тест зеленів
би від ORM-конфігурації навіть на схемі, де `ondelete` зламано. Тут перевіряється
саме база.

`expire_on_commit=False` (database.py) робить читання після запису брехливим —
об'єкт лишається в identity map із уже завантаженими значеннями. Тому після
кожного видалення стоїть `expire_all()`, інакше тест побачив би старий `list_id`
і був би зеленим на зламаній схемі. З тієї ж родини пасток: діти додаються як
`PublicationCardModel(publication_id=...)`, а не через `publication.cards.append`
— звертання до незавантаженої колекції в async-сесії падає з `MissingGreenlet`.
"""

import pytest

from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.database.models import (
    CardModel,
    PublicationCardModel,
    PublicationModel,
    PublicationRatingModel,
    PublicationTakeModel,
    UserModel,
    WordListModel,
)


async def _publication(
    db_session: AsyncSession, owner: UserModel, taker: UserModel
) -> tuple[PublicationModel, WordListModel]:
    """
    Публікація з одним словом у знімку, одним взяттям і однією оцінкою.

    Мінімум, на якому видно всі чотири наслідки видалень.
    """
    word_list = WordListModel(name="Дієслова", user_id=owner.id)
    db_session.add(word_list)
    await db_session.flush()

    publication = PublicationModel(
        title="Неправильні дієслова для B1",
        description="120 дієслів із формами",
        list_id=word_list.id,
        owner_id=owner.id,
    )
    db_session.add(publication)
    await db_session.flush()

    db_session.add(
        PublicationCardModel(
            publication_id=publication.id,
            position=0,
            word="run",
            word_normalized="run",
            content={"senses": [{"translation": "бігти"}], "forms": []},
        )
    )
    db_session.add(PublicationTakeModel(publication_id=publication.id, user_id=taker.id))
    db_session.add(
        PublicationRatingModel(
            publication_id=publication.id, user_id=taker.id, stars=4
        )
    )
    await db_session.commit()
    return publication, word_list


async def _counts(db_session: AsyncSession, publication_id: int) -> dict[str, int]:
    async def count(model, column) -> int:
        result = await db_session.execute(
            select(func.count()).select_from(model).where(column == publication_id)
        )
        return result.scalar_one()

    return {
        "snapshot": await count(
            PublicationCardModel, PublicationCardModel.publication_id
        ),
        "takes": await count(PublicationTakeModel, PublicationTakeModel.publication_id),
        "ratings": await count(
            PublicationRatingModel, PublicationRatingModel.publication_id
        ),
    }


async def test_publication_survives_list_deletion(
    db_session: AsyncSession, user: UserModel, other_user: UserModel
):
    """
    Видалення власного списку не чіпає публікації — лише розв'язує їх.

    Це прямий наслідок знімка (ADR-0019): вміст у публікації свій, тож прибирання
    міток у власному словнику не має права худнути те, чим користуються інші.
    Гине лише можливість «Оновити», і про це каже `list_id IS NULL`.
    """
    publication, word_list = await _publication(db_session, user, other_user)
    publication_id = publication.id
    # id забираються ДО expire_all(): той знецінює всі об'єкти сесії, включно з
    # фікстурою `user`, і читання `user.id` після нього пішло б по базу
    # синхронним доступом до атрибута — тобто MissingGreenlet.
    owner_id = user.id

    result = await db_session.execute(
        delete(WordListModel).where(WordListModel.id == word_list.id)
    )
    # Без цього тест був би зеленим і тоді, коли DELETE не зачепив нічого: тобто
    # «публікація вижила» означало б «нічого не видаляли».
    assert result.rowcount == 1
    await db_session.commit()
    db_session.expire_all()

    alive = await db_session.get(PublicationModel, publication_id)
    assert alive is not None, "публікація загинула разом зі списком"
    assert alive.list_id is None, "list_id мусив стати NULL, а не лишитись живим"
    assert alive.owner_id == owner_id, "видалення списку не чіпає автора"
    assert await _counts(db_session, publication_id) == {
        "snapshot": 1,
        "takes": 1,
        "ratings": 1,
    }


async def test_publication_survives_author_deletion(
    db_session: AsyncSession, user: UserModel, other_user: UserModel
):
    """
    Видалення акаунта АВТОРА не вбиває публікації — автор анонімізується.

    Знімок самодостатній, тож список лишається корисним тим, хто його знайшов, а
    рейтинг і взяття лишаються при ньому. Автор, який хоче забрати роботу з
    собою, знімає публікацію ДО видалення акаунта — це його вибір, зроблений
    явно.
    """
    publication, _ = await _publication(db_session, user, other_user)
    publication_id = publication.id

    result = await db_session.execute(delete(UserModel).where(UserModel.id == user.id))
    assert result.rowcount == 1
    await db_session.commit()
    db_session.expire_all()

    alive = await db_session.get(PublicationModel, publication_id)
    assert alive is not None, "публікація загинула разом з акаунтом автора"
    assert alive.owner_id is None, "owner_id мусив стати NULL"
    assert alive.title == "Неправильні дієслова для B1"
    assert await _counts(db_session, publication_id) == {
        "snapshot": 1,
        "takes": 1,
        "ratings": 1,
    }


async def test_taker_deletion_removes_their_take_and_rating(
    db_session: AsyncSession, user: UserModel, other_user: UserModel
):
    """
    Видалення акаунта ЧИТАЧА — протилежний бік тієї ж монети.

    Пішовши з застосунку, людина більше не має цього списку, тож популярність
    мусить зменшитись, а її оцінка — зникнути. Публікація при цьому цілісінька.
    Саме тому тут CASCADE, а не SET NULL: взяття без людини не є взяттям.
    """
    publication, _ = await _publication(db_session, user, other_user)
    publication_id = publication.id

    result = await db_session.execute(
        delete(UserModel).where(UserModel.id == other_user.id)
    )
    assert result.rowcount == 1
    await db_session.commit()
    db_session.expire_all()

    assert await db_session.get(PublicationModel, publication_id) is not None
    assert await _counts(db_session, publication_id) == {
        "snapshot": 1,
        "takes": 0,
        "ratings": 0,
    }


async def test_snapshot_dies_with_publication(
    db_session: AsyncSession, user: UserModel, other_user: UserModel
):
    """
    Знімок без публікації не існує.

    Це єдине видалення, яке справді все зносить, — і в звичайній роботі його не
    буває: публікація знімається з витрини прапорцем `is_listed`, а не
    видаленням рядка (ADR-0020). Тест тримає CASCADE для того шляху, яким
    знімок замінюється при «Оновити»: діти видаляються, нові вставляються.
    """
    publication, _ = await _publication(db_session, user, other_user)
    publication_id = publication.id

    result = await db_session.execute(
        delete(PublicationModel).where(PublicationModel.id == publication_id)
    )
    assert result.rowcount == 1
    await db_session.commit()
    db_session.expire_all()

    assert await db_session.get(PublicationModel, publication_id) is None
    assert await _counts(db_session, publication_id) == {
        "snapshot": 0,
        "takes": 0,
        "ratings": 0,
    }


async def test_list_keeps_only_one_publication(
    db_session: AsyncSession, user: UserModel, other_user: UserModel
):
    """
    У списку публікація щонайбільше одна.

    Тому «Опублікувати» ідемпотентний, як `share_list`, а зняття й повернення —
    це один і той самий рядок разом із рейтингом. Без цього констрейнта
    «повернув публікацію» тихо плодило б другу, з нульовим рейтингом.
    """
    publication, word_list = await _publication(db_session, user, other_user)

    db_session.add(
        PublicationModel(title="Та сама, вдруге", list_id=word_list.id, owner_id=user.id)
    )
    with pytest.raises(IntegrityError):
        await db_session.commit()
    await db_session.rollback()


async def test_orphaned_publications_do_not_collide(
    db_session: AsyncSession, user: UserModel
):
    """
    Осиротілих публікацій (list_id IS NULL) може бути скільки завгодно.

    Це не дірка в `uq_publications_list`, а причина, з якої той констрейнт узагалі
    можливий: у Postgres NULL не конфліктує сам із собою. Інакше видалення двох
    опублікованих списків впало б на унікальності.
    """
    db_session.add_all(
        [
            PublicationModel(title="Осиротіла А", list_id=None, owner_id=user.id),
            PublicationModel(title="Осиротіла Б", list_id=None, owner_id=user.id),
        ]
    )
    await db_session.commit()

    result = await db_session.execute(
        select(func.count()).select_from(PublicationModel)
    )
    assert result.scalar_one() == 2


@pytest.mark.parametrize("stars", [0, 6, -1, 100])
async def test_stars_outside_one_to_five_are_rejected(
    db_session: AsyncSession, user: UserModel, stars: int
):
    """
    Межі 1–5 тримає БАЗА, а не лише схема.

    Це навмисна відмова від того, як зроблено `desired_retention`: там межі живуть
    тільки в Pydantic, і HANDOFF називає це дірою. Повторювати її тут немає
    підстав — оцінка приходить від користувача, і єдина перевірка на шляху не
    мусить бути в найм'якшому шарі.
    """
    publication = PublicationModel(title="Проба", owner_id=user.id)
    db_session.add(publication)
    await db_session.flush()

    db_session.add(
        PublicationRatingModel(
            publication_id=publication.id, user_id=user.id, stars=stars
        )
    )
    with pytest.raises(IntegrityError):
        await db_session.commit()
    await db_session.rollback()


async def test_snapshot_rejects_duplicate_word(
    db_session: AsyncSession, user: UserModel
):
    """
    У знімку слово одне.

    Джерело — список, а `cards` тримає UNIQUE(user_id, word_normalized), тож
    дублів там бути не може. Констрейнт заявляє це вголос: писар знімка, який
    продублює слово, впаде тут, а не зіпсує тихо звірку з чужим словником —
    `already_have` рахується саме за нормалізованим словом.
    """
    publication = PublicationModel(title="Проба", owner_id=user.id)
    db_session.add(publication)
    await db_session.flush()

    # «Run» і «run» — те саме слово: normalize_word обрізає пробіли й опускає
    # регістр, і знімок мусить триматись тієї ж рівності, що й словник.
    db_session.add_all(
        [
            PublicationCardModel(
                publication_id=publication.id,
                position=0,
                word="Run",
                word_normalized="run",
                content={},
            ),
            PublicationCardModel(
                publication_id=publication.id,
                position=1,
                word="run",
                word_normalized="run",
                content={},
            ),
        ]
    )
    with pytest.raises(IntegrityError):
        await db_session.commit()
    await db_session.rollback()


async def test_one_take_per_person(
    db_session: AsyncSession, user: UserModel, other_user: UserModel
):
    """
    Одне взяття на людину, скільком би списками вона це не розклала.

    Саме тому популярність — це `COUNT(*)`, а не `COUNT(DISTINCT user_id)`:
    другий варіант читається без пасток лише доти, доки хтось не напише перший.
    Той самий список можна взяти повторно під іншою назвою (`import_share` віддає
    409 лише на зайняту назву), і без цього ключа одна людина накрутила б
    «взяли 3».
    """
    publication, _ = await _publication(db_session, user, other_user)

    db_session.add(
        PublicationTakeModel(publication_id=publication.id, user_id=other_user.id)
    )
    with pytest.raises(IntegrityError):
        await db_session.commit()
    await db_session.rollback()


async def test_snapshot_is_independent_of_the_source_card(
    db_session: AsyncSession, user: UserModel
):
    """
    Знімок не можна зберігати як звичайні картки, і ось чому.

    `cards` тримає UNIQUE(user_id, word_normalized), тож власник фізично не може
    мати другу копію свого ж слова — «прихований список-копія» помирає на місці.
    Знімок у власній таблиці цього обмеження не має: те саме слово живе і в
    словнику автора, і в публікації, і це два незалежні рядки.
    """
    card = CardModel(word="run", user_id=user.id)
    publication = PublicationModel(title="Проба", owner_id=user.id)
    db_session.add_all([card, publication])
    await db_session.flush()

    db_session.add(
        PublicationCardModel(
            publication_id=publication.id,
            position=0,
            word="run",
            word_normalized="run",
            content={},
        )
    )
    await db_session.commit()

    # Друга копія слова у ВЛАСНОМУ словнику — саме те, що неможливо.
    db_session.add(CardModel(word="Run", user_id=user.id))
    with pytest.raises(IntegrityError):
        await db_session.commit()
    await db_session.rollback()
