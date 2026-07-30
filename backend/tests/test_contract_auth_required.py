"""
Кожен ендпоінт, якого немає в списку публічних, мусить відповідати 401 без
токена.

Перелік адрес береться з живого застосунку, а не переписується руками. Це
навмисно: коли зʼявиться новий роут і в ньому забудуть авторизацію, він
потрапить сюди сам і тест почервоніє. Руками ведеться тільки `PUBLIC` — і
дописати туди адресу можна лише свідомо.
"""

import pytest
from fastapi.routing import APIRoute
from httpx import AsyncClient

from app.main import app

# Адреси, які мусять працювати без токена. Кожна тут — свідоме рішення:
# це вхід до застосунку (реєстрація, активація, логін) або відновлення
# доступу, тобто саме ті випадки, коли токена ще або вже немає.
PUBLIC = {
    ("GET", "/"),
    ("POST", "/api/v1/accounts/register/"),
    ("POST", "/api/v1/accounts/activate/"),
    ("POST", "/api/v1/accounts/login/"),
    ("POST", "/api/v1/accounts/refresh/"),
    ("POST", "/api/v1/accounts/password-reset/request/"),
    ("POST", "/api/v1/accounts/reset-password/complete/"),
}

# Значення для параметрів шляху. Мусять проходити валідацію типу, інакше
# замість 401 прилетить 422 і тест перевірятиме не те, що треба.
PATH_VALUES = {
    "user_id": "1",
    "card_id": "1",
    "list_id": "1",
    "note_id": "1",
    "category_id": "1",
    "track_id": "1",
    "publication_id": "1",
    "token": "sometoken",
}


def _collect_routes(routes, prefix=""):
    """
    FastAPI 0.140 не розгортає підключені роутери в плоский список — вони
    лишаються обʼєктами `_IncludedRouter` з власними `routes`. Тому обхід
    рекурсивний, а префікс збирається по дорозі.
    """
    collected = []
    for route in routes:
        if isinstance(route, APIRoute):
            collected.append((prefix + route.path, route))
        elif type(route).__name__ == "_IncludedRouter":
            include_prefix = getattr(route.include_context, "prefix", "") or ""
            collected.extend(
                _collect_routes(route.original_router.routes, prefix + include_prefix)
            )
    return collected


def _all_endpoints() -> list[tuple[str, str]]:
    endpoints = []
    for path, route in _collect_routes(app.routes):
        for method in sorted(route.methods - {"HEAD", "OPTIONS"}):
            endpoints.append((method, path))
    return sorted(endpoints)


ALL_ENDPOINTS = _all_endpoints()
PROTECTED = [pair for pair in ALL_ENDPOINTS if pair not in PUBLIC]


def _fill(path: str) -> str:
    for name, value in PATH_VALUES.items():
        path = path.replace("{" + name + "}", value)
    assert "{" not in path, f"Немає значення для параметра шляху в {path}"
    return path


@pytest.mark.parametrize("method,path", PROTECTED, ids=lambda v: v)
async def test_requires_authentication(client: AsyncClient, method: str, path: str):
    response = await client.request(method, _fill(path), json={})

    assert response.status_code == 401, (
        f"{method} {path} відповів {response.status_code} без токена. "
        "Якщо адреса справді має бути публічною — додай її до PUBLIC "
        "у цьому файлі, свідомо."
    )


def test_public_list_matches_reality():
    """
    Захист від протилежної помилки: адреса зникла або перейменувалась, а в
    PUBLIC лишився мертвий рядок — і тоді справжній ендпоінт тихо випав би
    з перевірки на 401.
    """
    unknown = PUBLIC - set(ALL_ENDPOINTS)
    assert not unknown, f"У PUBLIC є адреси, яких у застосунку немає: {unknown}"


def test_endpoint_count_is_sane():
    """Дешевий сторож: роути зникли цілим роутером — помітимо одразу."""
    assert len(ALL_ENDPOINTS) == 53, (
        f"Ендпоінтів стало {len(ALL_ENDPOINTS)}, а було 53. Якщо це навмисно — "
        "онови число тут."
    )
