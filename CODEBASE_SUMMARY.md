# Codebase Summary — Smart Task Management System (Backend)

**Purpose of this file:** a single, dense reference to this codebase's actual
current state — models, endpoints, business rules, and design decisions —
written so a new session (AI or human) can get oriented and make correct
changes *without* having to open every source file first. It will still be
necessary to open the specific file being changed; this document exists to
avoid re-deriving the whole system's shape from scratch every time.

**How this relates to the other two root docs:**
- `README.md` is user/developer-facing: how to run it, configure it, and
  what each endpoint does at a glance. Keep reading it for "how do I start
  this thing." It does not describe internal implementation details,
  permission logic, or design rationale in depth.
- `implementation_plan.md` is a **historical** audit document from the
  original pass that aligned this codebase with the spec PDF
  (`Mock Project_Smart Task Management System (1).pdf`). Its "Proposed
  Changes" are already implemented — treat it as a changelog, not as
  current source of truth. Everything built *after* that plan (search/sort/
  pagination for Project & User, forgot-password + email, Nginx, Mailpit,
  WebSocket + Redis realtime notifications) is **not** described there —
  it's covered in this file and in README.md instead.
- This file should be kept up to date the same way README.md is: when a
  future session makes a structural change (new module, new endpoint, new
  business rule, new infra piece), update the relevant section here too.

---

## 1. Tech Stack

Python 3.11 · FastAPI · Uvicorn · SQLAlchemy 2.0 (async ORM) · PostgreSQL
(Docker) / SQLite (local dev & tests) · Pydantic v2 · JWT (`PyJWT`) ·
`passlib`/`bcrypt` · Redis (realtime fan-out only) · Nginx (reverse proxy) ·
Mailpit (dev SMTP relay). Full pinned versions: `requirements.txt`.

## 2. Architecture

Layered, per-module. Every module under `src/modules/<name>/` has the same
four files:

| File | Responsibility |
|---|---|
| `models.py` | SQLAlchemy ORM table definitions |
| `schemas.py` | Pydantic request/response models + validators |
| `service.py` | **All** business logic and DB queries live here |
| `router.py` | Thin HTTP layer only: path/method, dependency injection, calls into `service.py` |

Rule enforced throughout: routers never contain business logic, and
cross-module calls always go through the target module's `service.py`
(e.g. tasks calling `notifications.service.create_event_notification`),
never through another module's `router.py`.

## 3. Directory Map

```
src/
  app.py                        FastAPI app factory, router registration, lifespan
                                 (schema create_all, admin seed, Redis subscriber task)
  config.py                     Settings (pydantic-settings, reads .env)
  database.py                   Async engine/session factory (AsyncSessionLocal), Base
  core/
    security.py                  password hashing, JWT + refresh/reset token helpers
    dependencies.py              get_current_user (HTTPBearer), get_user_from_access_token
                                  (shared core reused by the WS endpoint), require_roles
    realtime.py                  WebSocket ConnectionManager + Redis pub/sub fan-out +
                                  the SQLAlchemy after_commit broadcast hook
    email.py                     outbound email (SMTP or dev-fallback console log)
    schemas.py                   shared PaginationMeta / PaginatedResponse[T]
    pagination.py                shared parse_sort() for all search endpoints
  jobs/
    check_deadlines.py           standalone script (run via cron) — DEADLINE_APPROACHING /
                                  TASK_OVERDUE notifications
  modules/
    auth/        login, refresh, logout, change-password, forgot/reset-password
    users/       user CRUD-ish admin ops, profile self-update, search
    projects/    project CRUD, membership management
    sprints/     sprint CRUD, close-sprint task migration
    tasks/       task CRUD, status state machine, audit log, search (router.py + search_router.py)
    comments/    comments + file attachments on tasks
    dashboard/   per-project task stats
    reporting/   CSV task export
    notifications/  in-app notifications + the /ws realtime endpoint
tests/
  test_suite.py                  the entire automated test suite (unittest), ~51 tests
nginx/
  nginx.conf                     reverse proxy config for the `nginx` docker-compose service
docker-compose.yml                web, nginx, db (postgres), mailpit, redis
requirements.txt
.env.example                     documents every config key (see §9)
```

## 4. Data Model

All PKs are UUIDs (`default=uuid.uuid4`, Python-side). All FKs use
`ondelete="CASCADE"` unless noted.

| Table | Key fields | Notes |
|---|---|---|
| `users` | email (unique), full_name, password_hash, `system_role` (ADMIN/PROJECT_MANAGER/TEAM_MEMBER), `status` (ACTIVE/LOCKED/INACTIVE), last_login_at | |
| `refresh_tokens` | user_id, token_hash (sha256, unique), expires_at, revoked_at (nullable = active) | opaque token, only hash stored |
| `password_reset_tokens` | user_id, token_hash, expires_at, used_at (nullable = unused) | same pattern as refresh tokens |
| `projects` | code (unique, uppercased), name, `status` (PLANNING/ACTIVE/CLOSED), start_date, end_date, created_by | |
| `project_members` | project_id, user_id (unique pair), `project_role` (MANAGER/MEMBER), is_active | soft-delete via is_active, not row deletion |
| `sprints` | project_id, name, `status` (PLANNED/ACTIVE/CLOSED), start_date, end_date (required, not nullable) | |
| `tasks` | project_id, sprint_id (nullable = backlog), title, `status` (TODO/IN_PROGRESS/IN_REVIEW/DONE/CANCELLED), `priority` (LOW/MEDIUM/HIGH/CRITICAL), assignee_id (nullable), reporter_id, due_date, estimated_hours, actual_hours, completed_at | |
| `audit_logs` | task_id, actor_id, field_changed, old_value, new_value | written for assignee/priority/due_date/status changes only |
| `comments` | task_id, author_id, content, is_edited | |
| `attachments` | task_id, uploaded_by, original_name, storage_key (local filesystem path under `uploads/tasks/{task_id}/`), content_type, size_bytes | files stored on local disk, not object storage |
| `notifications` | recipient_id, `type` (enum, see §7), title, message, entity_type, entity_id, deduplication_key (nullable), is_read, read_at | |

## 5. Auth & Security Design

- **Access token**: JWT (HS256, `SECRET_KEY`), 30 min, includes `sub` (user
  id), `type: "access"`, unique `jti`.
- **Refresh token**: opaque `secrets.token_urlsafe(48)`, 7 days, only its
  SHA-256 hash is stored (`refresh_tokens.token_hash`). Rotated on every use
  (old one marked `revoked_at`). Reusing an already-rotated-out token is
  treated as a theft signal: it revokes **every** active session for that
  user (`_revoke_all_sessions` in `auth/service.py`).
- **Password reset token**: same opaque+hash pattern, 30 min, single-use
  (`used_at`).
- **Locked user** → distinguishes 401 (bad/expired/missing token) from 403
  (valid token, but the user is now locked/gone) — `core/dependencies.py`.
- Login is deliberately uniform: wrong password and nonexistent email both
  return 401 (never reveals which). Locked-but-correct-password returns 403.
  `forgot-password` always returns 204 regardless of whether the email
  exists (same principle).
- `HTTPBearer` is used instead of `OAuth2PasswordBearer` — this app's
  `/auth/login` is a custom JSON endpoint, not the real OAuth2 password
  grant that `OAuth2PasswordBearer` advertises to Swagger; using the real
  scheme broke Swagger's "Authorize" dialog (see `dependencies.py` comment).
- Password change / password reset / user-lock all cascade-revoke every
  refresh token for that user.
- WebSocket auth (`/api/v1/notifications/ws`) can't use a header (browsers
  can't set custom WS handshake headers), so it takes the same JWT access
  token as a `?token=` query param, validated via
  `get_user_from_access_token` (factored out of `get_current_user` for
  exactly this reuse).

## 6. API Endpoints

All routes are mounted under `/api/v1` (see `app.py`). "Access" below is
the effective rule after both `require_roles` dependencies (where used) and
in-service checks (most permission logic lives in `service.py`, not as
router-level dependencies).

### Auth (`/api/v1/auth`)
| Method & Path | Access | Notes |
|---|---|---|
| POST `/login` | public | uniform 401 on bad password/unknown email; 403 if locked |
| POST `/refresh` | valid refresh token | rotates; reuse of a revoked token cascades-revokes all sessions |
| POST `/logout` | valid refresh token (no access token needed) | 204 |
| POST `/change-password` | authenticated | revokes all sessions |
| POST `/forgot-password` | public | always 204; emails a reset link if the account exists & isn't locked |
| POST `/reset-password` | public (has token) | consumes token, revokes all sessions |

### Users (`/api/v1/users`)
| Method & Path | Access | Notes |
|---|---|---|
| POST `` | ADMIN | create user |
| PATCH `/{id}/status` | ADMIN | lock revokes all that user's refresh tokens |
| PATCH `/{id}/role` | ADMIN | change system_role |
| PATCH `/{id}` | self or ADMIN | update email/full_name; email uniqueness re-checked |
| GET `` | authenticated | search/filter(status,role)/sort/paginate; ADMIN sees everyone, others only users who share an active project with them |

### Projects (`/api/v1/projects`)
| Method & Path | Access | Notes |
|---|---|---|
| POST `` | ADMIN or PROJECT_MANAGER | creator auto-added as MANAGER member; status starts PLANNING |
| GET `` | authenticated | search/filter(status)/sort/paginate; ADMIN sees all, others only projects they're an active member of |
| PATCH `/{id}` | ADMIN or that project's MANAGER member | validates end_date >= start_date against the merged result |
| POST `/{id}/members` | ADMIN or that project's MANAGER member | reactivates if previously removed; blocked on CLOSED project; triggers `PROJECT_MEMBER_ADDED` |
| DELETE `/{id}/members/{user_id}` | ADMIN or that project's MANAGER member | 400 if member has open tasks and no `reassign_to_user_id` given |

### Sprints (`/api/v1/projects/{project_id}/sprints`)
| Method & Path | Access | Notes |
|---|---|---|
| POST `` | ADMIN or project MANAGER | blocked on CLOSED project; must be within project date bounds; no overlap with another ACTIVE sprint |
| PATCH `/{id}` | ADMIN or project MANAGER | re-validates bounds/overlap; max **one** ACTIVE sprint per project |
| POST `/{id}/close` | ADMIN or project MANAGER | moves incomplete (non-DONE/CANCELLED) tasks to `target_sprint_id` or backlog (null) |
| GET `` | **⚠️ no auth dependency at all** — see §10 | list sprints for a project |

### Tasks
| Method & Path | Access | Notes |
|---|---|---|
| POST `/api/v1/projects/{id}/tasks` | ADMIN or PM of that project | blocked on CLOSED project; assignee must be active project member; triggers `TASK_ASSIGNED` |
| GET `/api/v1/projects/{id}/tasks` | active project member or ADMIN | search/filter(sprint,assignee,status,priority)/sort/paginate (`search_router.py`) |
| PATCH `/api/v1/tasks/{id}` | ADMIN/PM (any field) or the assignee (status/actual_hours/description only) | validates status transitions (§8); audit-logs assignee/priority/due_date/status; triggers `TASK_REASSIGNED`/`TASK_STATUS_CHANGED`/`TASK_UPDATED` |
| PATCH `/api/v1/tasks/{id}/status` | assignee, PM, or ADMIN | dedicated status-only transition; returns `{id, previous_status, status, updated_at}` |
| GET `/api/v1/tasks/{id}/audit-logs` | authenticated (no explicit access-scope check beyond login) | |

### Comments & Attachments (`/api/v1/tasks/{task_id}`)
| Method & Path | Access | Notes |
|---|---|---|
| POST `/comments` | active project member or ADMIN | triggers `COMMENT_ADDED` to assignee+reporter (excl. author) |
| GET `/comments` | active project member or ADMIN | |
| DELETE `/comments/{comment_id}` | comment author, or PM/ADMIN | |
| POST `/attachments` | active project member or ADMIN | validates extension+MIME+size (10MB default, `MAX_FILE_SIZE_BYTES`); stored under `uploads/tasks/{task_id}/` |
| GET `/attachments` | active project member or ADMIN | |

### Dashboard (`/api/v1/dashboard`)
| Method & Path | Access | Notes |
|---|---|---|
| GET `/projects/{id}?sprint_id=&assignee_id=` | active project member or ADMIN | total/completed/overdue tasks, completion_rate, tasks_by_status, tasks_by_priority — returns zeros, never errors, when there's no data |

### Reporting (`/api/v1/reports`)
| Method & Path | Access | Notes |
|---|---|---|
| GET `/tasks/csv?project_id=&sprint_id=&status=&priority=` | ADMIN (all) or PM (only their managed projects); TEAM_MEMBER forbidden | streamed CSV, UTF-8 BOM |

### Notifications (`/api/v1/notifications`)
| Method & Path | Access | Notes |
|---|---|---|
| GET `` | authenticated | own notifications only; filter `is_read`, paginate |
| PATCH `/{id}/read` | authenticated | |
| PATCH `/read-all` | authenticated | |
| PATCH `/mark-read` | authenticated | legacy batch endpoint, body: `{notification_ids: [...]}` |
| WS `/ws?token=<access_token>` | JWT via query param | realtime push, see §7 |

## 7. Notifications: Triggers, Dedup, and Realtime Delivery

| Type | Fired when | Recipients (excl. actor) |
|---|---|---|
| `TASK_ASSIGNED` | task created with an assignee | assignee |
| `TASK_REASSIGNED` | assignee changed via `PATCH /tasks/{id}` | both old and new assignee |
| `TASK_STATUS_CHANGED` | status changed (either status endpoint) | assignee + reporter |
| `TASK_UPDATED` | priority or due_date changed via `PATCH /tasks/{id}` | assignee |
| `COMMENT_ADDED` | comment created | assignee + reporter |
| `PROJECT_MEMBER_ADDED` | member added/reactivated | the added member |
| `DEADLINE_APPROACHING` | due within 24h, active status (TODO/IN_PROGRESS/IN_REVIEW) — via `src/jobs/check_deadlines.py`, meant to run on a cron | assignee |
| `TASK_OVERDUE` | due date passed, active status — same cron job | assignee + project MANAGER members |

All notification creation goes through
`notifications.service.create_event_notification()` — it checks the
recipient is still an active project member (revoked members are never
notified), applies `deduplication_key` de-duplication where given (so
re-running the cron job doesn't spam), and writes the row.

**Realtime delivery** (added after the original spec, which explicitly
marked this out of MVP scope): every notification is still a DB row (`GET
/notifications` always works), but `src/core/realtime.py` also pushes it
live over WebSocket:
1. `create_event_notification()` flushes (to get id/created_at) and stashes
   a serialized dict on the SQLAlchemy session's `.info`.
2. A SQLAlchemy `after_commit` event listener (registered once, at import
   time, in `realtime.py`) fires only if the transaction actually commits,
   and schedules an async publish.
3. That publish sends the notification to a Redis Pub/Sub channel
   (`"notifications"`).
4. Every app instance/worker is subscribed to that channel
   (`redis_subscriber_loop`, started in `app.py`'s lifespan) and forwards
   to any WebSocket connections *it* personally holds
   (`ConnectionManager` — a per-process `{user_id: {websocket, ...}}` map).

This is WebSocket-for-delivery + **Redis only as the fan-out layer between
app instances** — deliberately not RabbitMQ (a message broker's
queue/ack/retry machinery solves durable work distribution, not a
lightweight one-shot broadcast). If Redis is unreachable, notification
creation still succeeds — only the live push is skipped (logged as a
warning); the row still shows up on the next `GET /notifications`.

## 8. Business Rules & State Machines

**Task status transitions** (`tasks/service.py::VALID_STATUS_TRANSITIONS`) —
anything not listed → `409` with `code: "INVALID_STATUS_TRANSITION"`:

```
TODO        → IN_PROGRESS, CANCELLED
IN_PROGRESS → TODO, IN_REVIEW, CANCELLED
IN_REVIEW   → TODO, IN_PROGRESS, DONE, CANCELLED
DONE        → TODO, IN_PROGRESS
CANCELLED   → TODO
```
`completed_at` is set on entering DONE, cleared on leaving DONE.

**Team member field restriction**: on the generic `PATCH /tasks/{id}`, a
non-admin/PM who is the assignee may only touch `{status, actual_hours,
description}` — anything else in the payload → 403. (The dedicated `PATCH
/tasks/{id}/status` endpoint is separate and doesn't have this field
restriction, since it only ever changes status.)

**Sprint rules**: must fall within the parent project's start/end dates (if
the project has them set); must not date-overlap any other ACTIVE sprint in
the same project; at most one ACTIVE sprint per project at a time; cannot
create a sprint in a CLOSED project. Closing a sprint moves its incomplete
(non-DONE/CANCELLED) tasks to `target_sprint_id`, or to the backlog
(`sprint_id = NULL`) if none given.

**Project rules**: `end_date` must be ≥ `start_date` (both create and
update — update compares against whichever value isn't being changed);
`code` is auto-uppercased and must be globally unique; creator is
automatically added as a MANAGER member; a CLOSED project blocks creating
new tasks, new sprints, and adding members.

**Project member removal**: blocked (400) if the member has open
(non-DONE/CANCELLED) tasks assigned, unless `reassign_to_user_id` (an
active member) is given — those tasks are reassigned as part of the same
call. Removal itself is a soft-delete (`is_active = False`), not a row
delete.

## 9. Email

`src/core/email.py`'s `send_email()`: if `SMTP_HOST` is unset, logs/prints
instead of sending (the "dev fallback" — keeps forgot-password fully
testable with no mail server). Once `SMTP_HOST` is set, it sends for real —
either to a self-hosted no-auth relay like the `mailpit` docker-compose
service (leave `SMTP_USER`/`SMTP_PASSWORD` blank), or to a real provider
(set those too). `forgot_password()` in `auth/service.py` wraps the send in
try/except — an unreachable SMTP server never breaks the endpoint's uniform
204 response, it's just logged. `docker-compose.yml`'s `mailpit` service
exposes a web UI at `http://localhost:8025` to view captured mail.

## 10. Search, Filter, Sort & Pagination Pattern

Project, Task, and User search all share the same contract
(`core/schemas.py` / `core/pagination.py`):
- Response shape: `{"items": [...], "pagination": {page, page_size,
  total_items, total_pages}}` (`PaginatedResponse[T]`).
- `sort_by` query param: bare field name (defaults to **descending** — a
  deliberate, historical convention kept for backward compat with the
  original Task search), or prefixed `-field` (desc) / `+field` (asc),
  parsed by `core/pagination.py::parse_sort()`.
- Each module keeps its own `*_SORT_ALLOWLIST` dict (field name → ORM
  column) in `service.py`; a `sort_by` not in that dict → `422`.
- `page_size` capped at 100 (`Query(..., le=100)` at the router).

## 11. Infrastructure

`docker-compose.yml` services:

| Service | Image | Purpose | Host-published port |
|---|---|---|---|
| `web` | built from `Dockerfile` | the API, `--reload` on, auto-wired to `db`/`mailpit`/`redis` env vars | not published directly — only reachable through `nginx` |
| `nginx` | `nginx:alpine` | reverse proxy, single entrypoint; forwards WebSocket upgrade headers for `/notifications/ws` | `8080:80` (not `80` — Windows commonly can't bind it, see `nginx.conf`/README §3) |
| `db` | `postgres:15-alpine` | primary database | `5432:5432` |
| `mailpit` | `axllent/mailpit` | dev SMTP relay + web inbox | `8025` (UI), `1025` (SMTP) |
| `redis` | `redis:7-alpine` | realtime notification fan-out only (§7) — not a cache, not a task queue | `6379:6379` |

Config keys: see `.env.example` (every key documented with which of the two
contexts — inside vs. outside Docker — it applies to) and README §6's
table.

## 12. Testing

Single file, `tests/test_suite.py`, run with:
```
python -m unittest tests.test_suite -v
```
Runs against an isolated SQLite file (deleted and recreated at import
time), boots the real FastAPI app once per test class via
`TestClient(app)` (so the real lifespan — including the Redis subscriber
task — runs too). ~51 tests across classes covering: auth (login/refresh/
lock/logout), forgot-password + email helper branching, project/sprint date
& overlap rules, task state machine + field restrictions, dashboard/
reporting permission boundaries, notification scoping, realtime WebSocket
auth + delivery, and Project/User search/filter/sort/pagination.

**Testing conventions used throughout** (follow these for new tests):
- External services are mocked, never required live: SMTP via
  `unittest.mock.patch("...send_email", ...)` or by mocking `smtplib.SMTP`;
  Redis via `patch("src.core.realtime._get_redis_client", ...)`. The suite
  passes identically whether or not `docker compose up redis`/`mailpit` are
  actually running.
- A scheduled-after-commit async side effect (the realtime broadcast) is
  timing-sensitive from a sync test; `TestRealtimeNotifications` polls with
  a short sleep loop rather than asserting immediately — see that test for
  the pattern if you add another commit-triggered async effect.

## 13. Known Gaps / Things Worth Revisiting

- **`GET /api/v1/projects/{id}/sprints` has no `get_current_user` dependency
  at all** (`sprints/router.py::list_sprints`) — unlike every other
  endpoint in the app, it's currently reachable with no auth token. Every
  other list/detail endpoint enforces at least login, and most also enforce
  project-membership scoping; this one enforces neither. Worth fixing to
  match the pattern used by dashboard/tasks/comments (`check_task_access`-
  style project-membership check).
- Out of scope / not implemented (per spec §10.2, still true): PDF export
  (CSV export exists), frontend UI, Celery, Elasticsearch, the "bonus"
  features (AI assistant, OAuth logins, Kanban/Gantt views).
- File attachments are stored on local disk (`uploads/tasks/{task_id}/`),
  not object storage — fine for a single-instance dev setup, would need
  revisiting (e.g. S3-compatible storage) before running `web` as multiple
  replicas, since replicas don't share a filesystem.
- `GET /api/v1/tasks/{id}/audit-logs` requires login but doesn't check the
  caller has access to that task's project (unlike comments/attachments,
  which use `check_task_access`).

## 14. Quick Reference — "Where do I change X?"

| Task | File(s) |
|---|---|
| Add/change a permission rule for an existing endpoint | that module's `service.py` (permission checks are inline, not router dependencies, except `require_roles` for a few admin-only routes) |
| Add a new notification type/trigger | the triggering module's `service.py` (call `notifications.service.create_event_notification`) + add the enum value in `notifications/models.py::NotificationType` |
| Change JWT/token lifetimes | `src/core/security.py` (`ACCESS_TOKEN_EXPIRE_MINUTES`, `REFRESH_TOKEN_EXPIRE_DAYS`, `PASSWORD_RESET_TOKEN_EXPIRE_MINUTES`) |
| Add a new searchable/sortable field to Project/Task/User | that module's `service.py`'s `*_SORT_ALLOWLIST` dict |
| Change email content/behavior | `src/modules/auth/service.py::forgot_password` (content) or `src/core/email.py` (transport) |
| Change realtime notification behavior | `src/core/realtime.py` (all of it lives there) |
| Add a new module | mirror an existing one: `models.py` + `schemas.py` + `service.py` + `router.py`, then register the router in `app.py` |
| Add a config value | `src/config.py` (`Settings` class) + `.env.example` + README §6 table |
