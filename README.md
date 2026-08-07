# Slovnuk

Slovnuk is a web application for learning English words with spaced repetition.
A user keeps a personal dictionary, groups words into lists, and every day
reviews the words that are due. There is also a small grammar reference, and
lists can be shared — either by a private link or publicly through a Library.

The application is live at
[slovnuk.ivankhomych.com](https://slovnuk.ivankhomych.com).

Most of the work here is on the backend: an async FastAPI service with
PostgreSQL, JWT authentication, S3-compatible file storage, transactional
emails, an AI integration, and a spaced-repetition scheduler. The frontend is a
React PWA that consumes the API; it is not the focus of this repository.

---

## What the backend does

**Accounts.** Registration with email activation, login, refresh tokens,
password reset, password change. Passwords are hashed with bcrypt. Access and
refresh tokens are signed with two different secret keys.

**Profiles.** Name, avatar upload, and user preferences. Avatars go to
S3-compatible storage (MinIO in this project).

**Vocabulary.** Cards (a word with its senses, examples and irregular forms),
lists, and statistics. A card belongs to a user and is unique per user; lists
work like labels, so one card can be in several lists at once.

**Study.** This is the core. Every card has two independent review tracks — one
for the translation, one for the forms. The scheduler is
[FSRS](https://github.com/open-spaced-repetition/py-fsrs), which keeps
*stability* and *difficulty* per track and computes the next due moment from the
user's answer. Each answer is written to an immutable review log, which is the
raw material for optimising per-user scheduler parameters later.

**Study days.** Daily goals and progress. Day boundaries are computed in the
user's own timezone, in SQL (`AT TIME ZONE`), not in Python.

**Grammar.** Markdown reference notes grouped into sections. These are not part
of the review queue.

**Sharing.** An owner can share a list by link. The receiver imports it as a
one-time copy: new cards, clean review history. Words the receiver already has
are skipped and reported, so an imported list is incomplete by design — a
stranger's list is never allowed to overwrite your own cards silently.

**Library.** Public lists. Publishing takes a *snapshot* of the list, not a live
mirror, so later edits stay private until the author updates the publication.
Publications carry their own rating, take counter, and origin, and they survive
deletion of the original list.

**AI card filling.** An endpoint that asks Claude to propose senses,
transcription and forms for a single word. Access is a per-user privilege stored
in the database, not a role. Every call is logged with token counts, successful
or not, because that log is the only source of truth about cost. Two independent
checks guard it: no API key on the server → `503`; no privilege for this user →
`403`.

---

## Tech stack

### Backend

| | |
|---|---|
| Language | Python 3.14 |
| Web framework | FastAPI + Starlette, Uvicorn |
| Validation / settings | Pydantic v2, pydantic-settings |
| Database | PostgreSQL 17 |
| ORM | SQLAlchemy 2.0 (async) + asyncpg |
| Migrations | Alembic |
| Auth | JWT (python-jose), bcrypt via passlib |
| File storage | S3-compatible (MinIO) via aioboto3 |
| Email | Resend + Jinja2 HTML templates |
| Spaced repetition | py-fsrs |
| AI | Anthropic Claude SDK |

### Frontend

React 19, TypeScript, Vite, TanStack Query, IndexedDB, installable PWA.
API types are generated from the backend's OpenAPI schema, so the Pydantic
schemas are the single source of truth for both sides.

### Infrastructure

Docker and Docker Compose, Caddy as the reverse proxy in production.

---

## How the backend is built

The code is split into layers, and each layer has one job:

```
backend/app/
├── main.py            # FastAPI app, routers, CORS
├── config/            # Settings (pydantic-settings) and DI providers
├── routes/            # HTTP layer: request/response, status codes, transactions
├── schemas/           # Pydantic request and response models
├── services/          # Pure domain logic, no database session
├── cruds/             # SQLAlchemy queries
├── database/
│   ├── models/        # SQLAlchemy models
│   └── validators/    # Field-level validation shared with schemas
├── security/          # JWT manager, password hashing, auth dependencies
├── storages/          # S3 client behind an interface
├── notifications/     # Email sender behind an interface, HTML templates
├── integrations/      # Anthropic client behind an interface, prompts
├── validation/        # Reusable validation helpers
└── exceptions/        # Domain exceptions
```

## Running it locally

### Requirements

- Docker and Docker Compose v2
- Python 3.14 and Node.js 20+ (only if you want to run backend or frontend
  outside Docker)

### 1. Configuration

```bash
git clone <repo-url> slovnuk
cd slovnuk
cp .env.example .env
```

Generate two **different** secret keys and put them into `.env`:

```bash
python -c "import secrets; print(secrets.token_urlsafe(64))"
```

```dotenv
SECRET_KEY_ACCESS=<first value>
SECRET_KEY_REFRESH=<second value>
```

Everything else in `.env.example` already works for local use. Two variables are
optional:

- `RESEND_API_KEY` — without it no emails are sent. See step 4 for how to get a
  working account anyway.
- `ANTHROPIC_API_KEY` — without it the AI endpoint returns `503` and the feature
  is simply absent. This is the normal local state.

### 2. Start everything in Docker

```bash
docker compose up -d --build
```

This starts PostgreSQL, MinIO (with buckets created automatically), the backend,
and the frontend. Migrations run on backend startup.

| | |
|---|---|
| Application | http://localhost:8080 |
| API docs (Swagger) | http://localhost:8000/docs |
| MinIO console | http://localhost:9001 |

All ports are published on `127.0.0.1` only.

### 3. Or run the backend on the host (better for development)

Start only the infrastructure:

```bash
docker compose up -d postgres minio createbuckets
```

In `.env`, point storage at the published port instead of the Docker network:

```dotenv
S3_STORAGE_ENDPOINT=http://localhost:9000
```

Then:

```bash
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt -r requirements-dev.txt

cd backend
alembic upgrade head
python -m uvicorn app.main:app --reload --port 8000
```

For the frontend:

```bash
cd frontend
npm install
npm run dev                        # http://localhost:5173
```

Vite proxies `/api/*` to the backend, so in development the frontend and the API
share one origin — the same as in production behind Caddy.

### 4. Get an account with data

Registration works, but activation needs a real email. The simplest way to get a
usable account is the seed script, which creates an already activated user with
cards, review history, grammar notes and a published list:

```bash
cd backend
python -m scripts.seed_test_data
```

Default credentials are `test@example.com` / `TestPass123!`. Re-run with
`--reset` to start over, or pass `--email` and `--password` for your own.

### 5. Run the tests

The test database has to exist once:

```bash
docker compose exec postgres createdb -U slovnuk slovnuk_test
```

Then:

```bash
cd backend
python -m pytest
```

`conftest.py` switches to `slovnuk_test` on its own and refuses to run against
any database whose name does not end in `_test`.

### 6. Tune the scheduler to a person (optional, and rarely)

FSRS ships with parameters averaged over many learners. Once someone has enough
of their own review history, those 21 weights can be fitted to them personally.
The fitting runs from a developer machine, never on the server — it needs
`torch`, and the API image has no business carrying it
([ADR-0002](docs/adr/0002-optymizator-poza-serverom.md)):

```bash
pip install -r requirements-optimizer.txt      # torch and friends, ~2.5 GB

cd backend
python -m scripts.optimize_parameters --email me@example.com            # report only
python -m scripts.optimize_parameters --email me@example.com --write    # and save
```

Without `--write` nothing is written. With it, the script still refuses to save
a result equal to the library defaults: `fsrs_parameters` being `NULL` honestly
means "not fitted yet", and defaults sitting there under the guise of personal
weights would destroy that signal.

Expect the first meaningful run no earlier than a couple of months into daily
study — the library needs 512 reviews where at least a day passed since the
previous look at the same track.

---

## API

The full API is documented by FastAPI itself at `/docs` (Swagger) and `/redoc`.
All endpoints live under `/api/v1`:

| Prefix | What it covers |
|---|---|
| `/accounts` | register, activate, login, refresh, password reset, me |
| `/profiles` | profile, avatar upload |
| `/vocabulary` | cards, lists, statistics |
| `/study` | review queue, answers, daily progress, study settings |
| `/grammar` | notes and sections |
| `/ai` | AI card proposals |
| `/vocabulary/lists/{id}/share`, `/shares/{token}` | private sharing |
| `/library`, `/vocabulary/lists/{id}/publication` | public library |

To regenerate the OpenAPI file used for frontend types:

```bash
cd backend
python -c "import json, io; from app.main import app; io.open('openapi.json','w',encoding='utf-8').write(json.dumps(app.openapi(), ensure_ascii=False, indent=1))"
cd ../frontend && npm run api-types
```

---

## Documentation

The project keeps its written decisions in the repository. These files are in
Ukrainian.

- [`CONTEXT.md`](CONTEXT.md) — the domain vocabulary: what a card, a track, a
  publication or a snapshot means, and which words are deliberately avoided.
- [`docs/adr/`](docs/adr/) — 31 architecture decision records, each explaining
  one decision and its cost.
- [`docs/HANDOFF.md`](docs/HANDOFF.md) — known debts, open questions, and traps
  that already cost debugging time.
- [`docs/DEPLOY.md`](docs/DEPLOY.md) — production deployment.
- [`frontend/README.md`](frontend/README.md) — the frontend.
