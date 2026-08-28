# Taskflow — Frontend

A real Next.js 16 (App Router, TypeScript, Tailwind CSS v4) client for the
Smart Task Management System API in the parent directory — not a design
mockup. It's built directly against that backend's actual endpoints; see
`../CODEBASE_SUMMARY.md` for the full API contract this was built from.

## Running it

This is the frontend half of the project — the backend lives in the sibling
`../backend/` folder with its own README/Dockerfile/compose. The two are
deliberately independent so each can be run, debugged, and deployed on its
own; you need the backend running first (see `../backend/README.md` §4 or
§3).

```bash
npm install
cp .env.local.example .env.local   # defaults already point at http://localhost:8000/api/v1
npm run dev
```

Open **http://localhost:3000**. Log in with the backend's seeded admin
account (`ADMIN_EMAIL` / `ADMIN_PASSWORD` in its `.env`, `admin@example.com`
/ `Admin@123` by default).

If the backend is running under the full `docker-compose` stack (behind
Nginx on `:8080`) instead of bare `uvicorn`, point `NEXT_PUBLIC_API_BASE_URL`
in `.env.local` at `http://localhost:8080/api/v1` instead — see the comments
in `.env.local.example`.

**CORS**: the backend needs `CORS_ORIGINS` to include this app's origin
(`http://localhost:3000` by default — see `../backend/.env.example` and
`../backend/README.md` §6). Without it, the browser will block every request
with a CORS error even though the backend itself is up.

## Running with Docker

```bash
cp .env.local.example .env   # note: plain .env, not .env.local — docker-compose reads .env
docker compose up --build
```

`docker-compose.yml` bind-mounts the source for hot reload (`next dev`
inside the container), so this behaves like `npm run dev` but doesn't
need Node installed on the host. `NEXT_PUBLIC_API_BASE_URL` is baked into
the browser bundle, so it has to be an address your **host machine** (not
the container) can reach — it defaults to
`http://localhost:8080/api/v1`, matching the backend's own
`docker-compose.yml` (Nginx on `:8080`). If you're instead running the
backend with bare `uvicorn` on `:8000`, override it in `.env`:

```bash
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000/api/v1
```

Since the backend and frontend now each have their own `docker-compose.yml`,
the usual way to run both locally is two terminals: `cd backend && docker
compose up --build` in one, `cd frontend && docker compose up --build` in
the other — see the repo root `README.md` for the combined quickstart.

## What's here

- **Auth** — login, JWT access token (30 min) + opaque refresh token
  (7 days) in `localStorage`, automatic refresh-and-retry on a 401, logout.
- **Dashboard** — per-project stats (status/priority breakdown, overdue
  tasks), project picker.
- **Projects** — list/create, sprints (list/create), and an add/remove
  member form (see the gap note below).
- **Board** — drag-and-drop Kanban (To Do / In Progress / In Review /
  Done), task creation.
- **Task detail** — fields (status/assignee/priority/sprint/due
  date/estimate/logged hours), description, comments, attachments, audit
  log — permissions mirror the backend's rules (a non-admin/PM assignee can
  only touch status, actual hours, and description).
- **Notifications** — list with read/unread filtering, plus a realtime bell
  fed by the backend's `/notifications/ws` WebSocket.
- **Admin** — user list/search, create user, lock/unlock (ADMIN only).

## Two real backend gaps this had to work around

Both are also logged in `../CODEBASE_SUMMARY.md` §13 as things worth fixing
on the backend:

1. **No `GET` endpoint to list a project's members.** The backend only
   exposes `POST /projects/{id}/members` and `DELETE
   /projects/{id}/members/{user_id}` — there's no way to read the roster
   back. The Projects page's Members panel is therefore add/remove-only,
   not a browsable list, and says so in the UI.
2. **No `GET /tasks/{id}`.** The task detail page re-fetches the project's
   task list (`GET /projects/{id}/tasks`, up to 100 items) and finds the
   task by id client-side, rather than fetching it directly. Fine for small
   projects; would need a real single-task endpoint to scale.

## Design system

Fonts (IBM Plex Sans/Mono) and the oklch color tokens in
`src/app/globals.css` match the Claude Design canvas this UI was drafted
from — same palette, same component conventions (badges, avatars, cards).

## Structure

```
src/
  app/
    (app)/            routes behind the auth guard (dashboard, projects,
                       board, task detail, notifications, admin/users)
    login/
    layout.tsx         fonts + AuthProvider
    globals.css         design tokens
  components/          AppShell (sidebar/topbar), icons, shared UI bits
  lib/
    api.ts              fetch wrapper: auth header, 401 -> refresh -> retry
    endpoints.ts         one typed function per backend route
    types.ts             TS mirror of the backend's Pydantic response models
    auth-context.tsx      AuthProvider / useAuth
    use-notifications-socket.ts   WS client with reconnect/backoff
    token-store.ts        localStorage session storage
```
