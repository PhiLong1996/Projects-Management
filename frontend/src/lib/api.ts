import { API_BASE_URL } from "./config";
import { tokenStore } from "./token-store";
import type { ApiErrorBody, TokenResponse } from "./types";

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function extractMessage(body: ApiErrorBody | undefined, fallback: string): string {
  if (!body || !body.detail) return fallback;
  const { detail } = body;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail.map((d) => d.msg).join("; ") || fallback;
  }
  if (typeof detail === "object") return detail.message || fallback;
  return fallback;
}

// Single-flight refresh: if several requests 401 at once, only issue one
// POST /auth/refresh and let the others wait on it (the backend rotates
// the refresh token on every use, so firing it twice would revoke the
// second caller's still-valid token).
let refreshPromise: Promise<string | null> | null = null;

async function doRefresh(): Promise<string | null> {
  const refreshToken = tokenStore.getRefreshToken();
  if (!refreshToken) return null;
  try {
    const res = await fetch(`${API_BASE_URL}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    if (!res.ok) {
      tokenStore.clear();
      return null;
    }
    const data = (await res.json()) as TokenResponse;
    tokenStore.setSession(data.access_token, data.refresh_token, data.user);
    return data.access_token;
  } catch {
    return null;
  }
}

function refreshAccessToken(): Promise<string | null> {
  if (!refreshPromise) {
    refreshPromise = doRefresh().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  isForm?: boolean;
  skipAuth?: boolean;
}

function buildUrl(path: string, query?: RequestOptions["query"]): string {
  const url = new URL(`${API_BASE_URL}${path}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    }
  }
  return url.toString();
}

async function request<T>(path: string, opts: RequestOptions = {}, retried = false): Promise<T> {
  const { method = "GET", body, query, isForm, skipAuth } = opts;
  const headers: Record<string, string> = {};
  if (!isForm && body !== undefined) headers["Content-Type"] = "application/json";
  const accessToken = tokenStore.getAccessToken();
  if (accessToken && !skipAuth) headers["Authorization"] = `Bearer ${accessToken}`;

  const res = await fetch(buildUrl(path, query), {
    method,
    headers,
    body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
  });

  if (res.status === 401 && !skipAuth && !retried) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      return request<T>(path, opts, true);
    }
    tokenStore.clear();
    if (typeof window !== "undefined") {
      // Deliberate full reload (not useRouter) — this is a plain module, not
      // a component, and a hard navigation guarantees every bit of in-memory
      // React state (auth context included) is wiped on session expiry.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = "/login";
    }
    throw new ApiError(401, "Session expired. Please log in again.");
  }

  if (res.status === 204) {
    return undefined as T;
  }

  let data: unknown = undefined;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = undefined;
    }
  }

  if (!res.ok) {
    const body = data as ApiErrorBody | undefined;
    const code =
      body && typeof body.detail === "object" && !Array.isArray(body.detail)
        ? body.detail?.code
        : undefined;
    throw new ApiError(res.status, extractMessage(body, `Request failed (${res.status})`), code);
  }

  return data as T;
}

export const api = {
  get: <T>(path: string, query?: RequestOptions["query"]) => request<T>(path, { method: "GET", query }),
  post: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
    request<T>(path, { ...opts, method: "POST", body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: "PATCH", body }),
  delete: <T>(path: string, body?: unknown) => request<T>(path, { method: "DELETE", body }),
  postForm: <T>(path: string, form: FormData) => request<T>(path, { method: "POST", body: form, isForm: true }),
};

export { refreshAccessToken };
