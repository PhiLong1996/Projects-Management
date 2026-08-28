// Base URL of the FastAPI backend's /api/v1 prefix. Defaults to the direct
// uvicorn dev server (README §4: `uvicorn src.app:app --reload`, port
// 8000). If you're running the full docker-compose stack instead, the API
// is only reachable through Nginx at :8080 (README §3) — set
// NEXT_PUBLIC_API_BASE_URL=http://localhost:8080/api/v1 in .env.local.
export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, "") || "http://localhost:8000/api/v1";

// Same host, ws(s):// scheme, used for the realtime notifications socket.
export const WS_BASE_URL =
  process.env.NEXT_PUBLIC_WS_BASE_URL?.replace(/\/$/, "") ||
  API_BASE_URL.replace(/^http/, "ws");
