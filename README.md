# Smart Task Management System

A task/project management app: FastAPI backend + Next.js frontend, kept as
two independent, sibling folders so each can be built, run, and debugged on
its own.

```
backend/     FastAPI · SQLAlchemy (async) · PostgreSQL/SQLite · JWT auth
             own Dockerfile + docker-compose.yml → see backend/README.md
frontend/    Next.js 16 · TypeScript · Tailwind CSS v4
             own Dockerfile + docker-compose.yml → see frontend/README.md
```

Neither folder depends on the other at build time — the frontend only talks
to the backend over HTTP/WebSocket at runtime, using a configurable base
URL. That's what makes "each have 1 docker compose" work: you can build,
run, restart, or debug either side without touching the other.

## Quickstart (both sides, Docker)

Two terminals:

```bash
# terminal 1
cd backend
docker compose up --build
# API on http://localhost:8080/api/v1 (behind Nginx), Mailpit UI on :8025

# terminal 2
cd frontend
docker compose up --build
# app on http://localhost:3000
```

The backend's CORS config (`CORS_ORIGINS` in `backend/.env`) already
includes `http://localhost:3000` by default, and the frontend's default
`NEXT_PUBLIC_API_BASE_URL` already points at `http://localhost:8080/api/v1`
— so this pairing works with no extra configuration. Log in with the
backend's seeded admin account (`admin@example.com` / `Admin@123` by
default; see `backend/README.md` §6).

If you'd rather run the backend with bare `uvicorn` instead of the full
Docker stack (`backend/README.md` §4), it listens on `:8000` — point the
frontend's `NEXT_PUBLIC_API_BASE_URL` at `http://localhost:8000/api/v1`
instead (see `frontend/.env.local.example` / `frontend/README.md`).

## Where to go next

- `backend/README.md` — running, configuring, and every API endpoint.
- `frontend/README.md` — running the frontend, what's implemented, and two
  real backend gaps it had to work around.
- `CODEBASE_SUMMARY.md` — a dense internal reference to the backend's
  actual current state (models, endpoints, business rules, design
  decisions) for anyone (AI or human) making changes to it.
- `implementation_plan.md` — historical audit doc from the original spec
  pass; a changelog, not current source of truth.
