# Smart Task Management System — Backend API

Centralized project/task management API built with **FastAPI + SQLAlchemy (async) + PostgreSQL**,
implementing the MVP scope defined in `Mock Project_Smart Task Management System (1).pdf`
(see `implementation_plan.md` for the change log against that spec).

## 1. Tech Stack

- Python 3.11, FastAPI, Uvicorn
- SQLAlchemy 2.0 (async ORM), Alembic (migrations, optional — tables are also
  auto-created on startup for the MVP)
- PostgreSQL (via Docker Compose) — SQLite is used automatically for local
  dev/tests if `DATABASE_URL` is not overridden
- JWT authentication (access + refresh tokens), bcrypt password hashing

## 2. Project Structure

Layered architecture (per Section 7 of the spec): each module's `router.py`
only handles HTTP wiring (path/method, request parsing, dependency
injection, response shaping) and delegates every DB query and business rule
to that module's `service.py`.

```
src/
  app.py                  FastAPI app, router registration, startup admin seed
  config.py                Settings (reads .env)
  database.py               Async engine/session, Base
  core/
    security.py              password hashing, JWT helpers
    dependencies.py           get_current_user, require_roles
  jobs/
    check_deadlines.py        scheduled job: DEADLINE_APPROACHING / TASK_OVERDUE
  modules/
    auth/ users/ projects/ sprints/ tasks/ comments/
    dashboard/ reporting/ notifications/
      models.py    SQLAlchemy ORM models
      schemas.py   Pydantic request/response schemas
      service.py   business logic + DB access (the layer to edit for rule changes)
      router.py    thin HTTP layer — calls service.py, no business logic
tests/
  test_suite.py             automated tests (unittest)
```

Cross-module calls always go through the target module's `service.py`
(e.g. `src.modules.notifications.service.create_event_notification`,
`src.modules.projects.service.verify_pm_or_admin`) rather than importing
from another module's `router.py`.

## 3. Running with Docker Compose (recommended)

```bash
docker compose up --build
```

This starts:
- `db` — PostgreSQL 15
- `web` — the API, on http://localhost:8000 (auto-reload enabled), waiting for
  `db` to report healthy before starting

Swagger UI: http://localhost:8000/docs

On first boot, if the `users` table is empty, an Administrator account is
seeded automatically using `ADMIN_EMAIL` / `ADMIN_PASSWORD` from `.env`
(defaults: `admin@example.com` / `Admin@123`). **Change these in `.env`
before any real deployment.**

## 4. Running locally without Docker

```bash
python3 -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn src.app:app --reload
```

Without a `DATABASE_URL` override, this uses a local SQLite file
(`task_management.db`) — convenient for quick manual testing, but Docker
Compose + PostgreSQL is the target runtime for the MVP.

> **Note:** `passlib`'s bcrypt backend is incompatible with `bcrypt>=4.1`
> (raises `ValueError: password cannot be longer than 72 bytes` on the very
> first hash call, which crashes the startup admin-seed step). `requirements.txt`
> pins `bcrypt==4.0.1` — keep that pin if you upgrade other dependencies.

## 5. Running in Debug Mode

**Option A — VS Code debugger (recommended, breakpoints included).**
`.vscode/launch.json` ships with three ready-to-use configs (Run and Debug
panel, or press `F5`):

- **API: Debug (uvicorn, no reload)** — starts the API under the debugger.
  Breakpoints in any `router.py`/`service.py` will hit reliably. Use this
  one for actually stepping through code.
- **API: Debug (uvicorn, with reload)** — same, but auto-restarts on file
  changes. Uvicorn's `--reload` runs your app in a subprocess, so on some
  setups breakpoints can be less reliable here than in the no-reload config
  — if a breakpoint doesn't stop execution, switch to "no reload".
- **Tests: Debug test_suite.py** — runs `tests/test_suite.py` under the
  debugger so you can step through a failing test.

Both API configs set `DB_ECHO=true` so SQL statements print to the Debug
Console as well.

Requires the VS Code Python extension (which bundles `debugpy`) and your
`venv` selected as the interpreter (`Ctrl+Shift+P` → *Python: Select
Interpreter*).

**Option B — plain terminal, no IDE.**

```bash
uvicorn src.app:app --reload --log-level debug
```

`--log-level debug` prints request routing/lifecycle details. Add
`DB_ECHO=true` (in `.env` or as an env var) to also log every SQL statement:

```bash
# .env
DB_ECHO=true
```

For interactive debugging without an IDE, drop `breakpoint()` at the line
you want to inspect — it opens `pdb` in the terminal running uvicorn (works
with `--reload` too, since standard input isn't a subprocess concern here).

**Option C — debugging inside Docker.** `docker-compose.yml`'s `web` service
already bind-mounts `./src` and runs with `--reload`, so editing code on
your host restarts the container's server without a rebuild — that covers
most iteration. To attach VS Code's debugger *into* the container itself
(rather than running locally), add `debugpy` to `requirements.txt`, start
uvicorn behind `python -m debugpy --listen 0.0.0.0:5678 --wait-for-client -m
uvicorn src.app:app --host 0.0.0.0 --port 8000`, publish port `5678`, and
use a VS Code "Remote Attach" launch config — only worth doing if you
specifically need to debug a container-only issue (e.g. something that
doesn't reproduce against SQLite locally).

## 6. Configuration (`.env`)

| Variable | Default | Notes |
|---|---|---|
| `DATABASE_URL` | `sqlite+aiosqlite:///./task_management.db` | Overridden to Postgres by `docker-compose.yml` |
| `SECRET_KEY` | — | JWT signing key. Use a random value ≥ 32 bytes in any real environment. |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | `admin@example.com` / `Admin@123` | Seeded only if the `users` table is empty |
| `DB_ECHO` | `false` | Set `true` to log SQL statements while debugging |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASSWORD` | unset | Outbound email for forgot-password. Left blank, emails are logged instead of sent (see §7). |
| `SMTP_FROM` | `SMTP_USER` | "From" address on sent emails, if different from the login user |
| `SMTP_USE_TLS` | `true` | STARTTLS on connect |
| `FRONTEND_URL` | `http://localhost:3000` | Base URL used to build the password-reset link emailed to users |

Unrecognized keys in `.env` are ignored rather than crashing startup.

## 7. Authentication

- `POST /api/v1/auth/login` — returns `access_token`, `refresh_token`
  (`expires_in=1800`s), and the caller's profile.
- `POST /api/v1/auth/refresh` — rotates the refresh token; the old one is
  revoked and cannot be reused.
- `POST /api/v1/auth/logout` — revokes the supplied refresh token. Takes only
  `refresh_token` in the body — no `Authorization` header/access token is
  required, so logout still works even after the access token (30 min) has
  expired, as long as the refresh token (7 day) is still valid.
- `POST /api/v1/auth/change-password` — requires the current password and
  revokes all existing refresh sessions.
- `POST /api/v1/auth/forgot-password` — takes `email`. Always returns `204`
  regardless of whether the email exists or the account is locked (same
  uniform-response principle as login), so this endpoint can never be used
  to enumerate accounts. If the account exists and is active, a one-time
  reset link valid for 30 minutes is emailed (see below).
- `POST /api/v1/auth/reset-password` — takes `token` (from the emailed
  link) and `new_password`. Consumes the token (a second use returns `400`),
  and — like `change-password` — revokes every existing session on success.

Send `Authorization: Bearer <access_token>` on all protected endpoints.

### Forgot password / email

`PasswordResetToken` follows the exact same pattern as refresh tokens: an
opaque random token (`secrets.token_urlsafe(48)`) is emailed to the user,
only its SHA-256 hash is stored (`password_reset_tokens.token_hash`), and
`used_at` (nullable, set once consumed) prevents replay.

Email sending lives in `src/core/email.py`. **With no `SMTP_*` settings in
`.env`, the email is logged/printed instead of sent** — this is intentional,
not a stub: it means the forgot-password flow is fully testable locally
(see `TestForgotPassword` in `tests/test_suite.py`, which captures the
logged email to extract the reset token) without needing a real mail
provider. Add real SMTP credentials (Gmail app password, SendGrid,
Mailtrap, etc.) to `.env` to send actual emails — no code changes needed,
same `send_email()` call either way.

### Refresh token format & storage

The refresh token handed to clients is an **opaque random string**
(`secrets.token_urlsafe(48)`), not a JWT — its validity is always checked
against the database anyway (to support revocation), so there's nothing to
gain from it being self-describing. Only its SHA-256 hash is ever persisted,
in `refresh_tokens.token_hash` (spec Section 13.9). The raw token is never
stored and is unrecoverable from the DB.

`refresh_tokens.revoked_at` (nullable datetime) replaces a plain
`is_revoked` boolean so the row also records *when* revocation happened; a
token is considered revoked whenever `revoked_at IS NOT NULL`. It's set on
refresh (rotation), logout, password change, and admin account-lock.

**Reuse detection:** presenting a refresh token that's already been rotated
out (or otherwise revoked) is treated as a possible theft signal — instead
of just rejecting that one request, it revokes *every* active session for
that user, forcing re-login everywhere.

> **Note if upgrading from an older checkout:** the `refresh_tokens` table
> schema changed (`token` → `token_hash`, `is_revoked` → `revoked_at`). Since
> this project only does `Base.metadata.create_all` (no migrations), delete
> your local `task_management.db` (SQLite) or run `docker compose down -v`
> (Postgres) before starting the app again, otherwise the old schema will
> cause SQL errors at runtime.

## 8. Roles & Permissions

Three system roles: `ADMIN`, `PROJECT_MANAGER`, `TEAM_MEMBER`. Project-level
role (`MANAGER` / `MEMBER`) is separate and scoped per project via
`ProjectMember`. Enforcement matches the Permission Matrix in Section 12 of
the spec — e.g. Team Members may only update `status`, `description`, and
`actual_hours` on tasks assigned to them, and task status changes follow a
fixed transition table (`409 INVALID_STATUS_TRANSITION` on an invalid move).

## 9. Search, Filter, Sort & Pagination (FR-07)

Project, Task, and User listing all share the same search contract — one
paginated response envelope and one `sort_by` convention, via
`src/core/schemas.py` (`PaginatedResponse`/`PaginationMeta`) and
`src/core/pagination.py` (`parse_sort`):

```json
{
  "items": [ ... ],
  "pagination": { "page": 1, "page_size": 20, "total_items": 42, "total_pages": 3 }
}
```

- `GET /api/v1/projects` — `search` (name or code), `status` filter, `sort_by`,
  `page`, `page_size`. Scoped per AC-03: Admin sees every project, everyone
  else only projects they're an active member of.
- `GET /api/v1/projects/{project_id}/tasks` — `sprint_id`, `assignee_id`,
  `status`, `priority` filters, `search` (title or description), `sort_by`,
  `page`, `page_size` (AC-08).
- `GET /api/v1/users` — `search` (name or email), `status`/`role` filters,
  `sort_by`, `page`, `page_size`. Scoped so non-Admins only see users who
  share a project with them (plus themselves).

`sort_by` takes a bare field name (defaults to descending) or a field name
prefixed with `-` (descending) or `+` (ascending), e.g. `sort_by=-created_at`
or `sort_by=+name`. Each endpoint validates the field against its own
allowlist (`PROJECT_SORT_ALLOWLIST`, `SEARCH_SORT_ALLOWLIST`,
`USER_SORT_ALLOWLIST` in each module's `service.py`) and returns
`422 Unprocessable Entity` for an unknown field, so a typo doesn't silently
fall back to some default. `page_size` is capped at 100.

## 10. Notifications

In-app notifications only (MVP). Triggered on task assignment/reassignment,
status changes, priority/due-date updates, new comments, and project member
additions. `src/jobs/check_deadlines.py` should be run periodically (e.g. via
cron, every 15–30 minutes) to emit `DEADLINE_APPROACHING` (due within 24h)
and `TASK_OVERDUE` notifications:

```bash
python -m src.jobs.check_deadlines
```

Notifications are deduplicated via `deduplication_key`, so re-running the job
does not create duplicate entries.

## 11. Reporting

`GET /api/v1/reports/tasks/csv` — CSV export of tasks, filterable by
`project_id`, `sprint_id`, `status`, `priority`. Administrators see all
projects; Project Managers see only projects they manage; Team Members
receive `403 Forbidden`.

## 12. Tests

```bash
pip install -r requirements.txt
python -m unittest tests.test_suite -v
```

Covers authentication (login/refresh/lock/change-password), project & sprint
rules (date bounds, sprint overlap, closed-project restrictions, member
removal with open tasks), task state-machine transitions and field-level
permission restrictions, dashboard/reporting permission boundaries, and
notification scoping. Tests run against an isolated SQLite file
(`test_suite.db`, recreated on each run) — no external database required.

## 13. API Documentation

Interactive OpenAPI docs are served at `/docs` (Swagger) and `/redoc` once the
app is running. See Section 14 of the requirement spec for representative
request/response payloads (login, create project, create task, status
update, task list, project dashboard, standard error shape).

## 14. Known Scope Limits (MVP)

Per Section 10.2 of the spec, the following are explicitly out of MVP scope
and not implemented: email/WebSocket notification delivery, PDF export,
frontend UI, Redis/Celery/RabbitMQ/Elasticsearch, and the optional bonus
features (AI assistant, OAuth logins, Kanban/Gantt views, etc.).
