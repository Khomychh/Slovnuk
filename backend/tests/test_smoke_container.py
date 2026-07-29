"""
Єдиний тест, що б'є в справжній HTTP справжнього контейнера.

Решта набору ходить через ASGITransport — швидко, зі стектрейсами, але в
межах venv розробника. Одного вона побачити не може: розбіжності між тим, що
встановлено в тебе, і тим, що потрапило в образ. Ця розбіжність тут уже
кусала двічі — `asyncpg` не був у `requirements.txt`, а `tzdata` бракувало
для `zoneinfo`, — і обидва рази бекенд не піднімався взагалі.

Тому перевіряється не логіка, а факт: образ збирається, `entrypoint.sh`
проганяє міграції, сервер відповідає, і застосунок справді дістає базу.

Запуск:
    docker compose up -d --build backend
    python -m pytest -m smoke

Без піднятого контейнера тест ПРОПУСКАЄТЬСЯ, а не падає — так само, як
`test_day_counts.py` без Postgres. Тобто зелений `pytest` на голій машині не
означає, що перевірено все (ADR-0006).

УВАГА: контейнер підключений до РОБОЧОЇ бази (`.env` + docker-compose), а не
до `slovnuk_test`. Тому `test_container_ran_migrations` лишає в ній рядок
`smoke-probe@example.com` — один раз, далі буде 409. Прибрати:

    docker compose exec postgres psql -U slovnuk -d slovnuk \\
        -c "DELETE FROM users WHERE email = 'smoke-probe@example.com';"

Робити перевірку без запису не вийде: саме реєстрація доводить, що міграції
пройшли і група USER на місці.
"""

import os

import httpx
import pytest

pytestmark = pytest.mark.smoke

BASE_URL = f"http://localhost:{os.environ.get('BACKEND_PORT', '8000')}"


@pytest.fixture
async def container() -> httpx.AsyncClient:
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=5.0) as client:
        try:
            await client.get("/")
        except httpx.HTTPError as error:
            pytest.skip(
                f"Контейнер бекенда не відповідає на {BASE_URL}: {error}. "
                "Підніми його: docker compose up -d --build backend"
            )
        yield client


async def test_container_serves_requests(container: httpx.AsyncClient):
    """Образ зібрався, залежності на місці, uvicorn піднявся."""
    response = await container.get("/")
    assert response.status_code == 200, response.text
    assert response.json() == {"message": "Slovnuk"}


async def test_container_reaches_the_database(container: httpx.AsyncClient):
    """
    Логін із завідомо неіснуючим email мусить дати 401, а не 500.

    401 тут означає більше, ніж здається: запит дійшов до бази, отримав
    порожній результат і повернувся. Саме цей шлях був повністю зламаний, коли
    `asyncpg` бракувало в залежностях.
    """
    response = await container.post(
        "/api/v1/accounts/login/",
        json={"email": "nobody@example.com", "password": "Qwerty!23456"},
    )
    assert response.status_code == 401, response.text
    assert response.json()["detail"]["code"] == "invalid_credentials"


async def test_container_ran_migrations(container: httpx.AsyncClient):
    """
    `entrypoint.sh` проганяє `alembic upgrade head` перед стартом. Якщо
    міграції не пройшли, реєстрація впаде 500-ю на відсутній групі
    користувачів — а не 409 про зайнятий email чи 201.
    """
    response = await container.post(
        "/api/v1/accounts/register/",
        json={"email": "smoke-probe@example.com", "password": "Qwerty!23456"},
    )
    assert response.status_code in (201, 409), response.text
