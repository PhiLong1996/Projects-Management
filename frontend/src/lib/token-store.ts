// Client-side token storage. The backend's /auth/login returns a bearer
// access token (30 min) + opaque refresh token (7 days) — there's no
// cookie/session involved (see CODEBASE_SUMMARY.md §5), so the frontend is
// responsible for holding both and rotating them itself.
import type { TokenUser } from "./types";

const ACCESS_KEY = "taskflow.access_token";
const REFRESH_KEY = "taskflow.refresh_token";
const USER_KEY = "taskflow.user";

function isBrowser() {
  return typeof window !== "undefined";
}

export const tokenStore = {
  getAccessToken(): string | null {
    if (!isBrowser()) return null;
    return window.localStorage.getItem(ACCESS_KEY);
  },
  getRefreshToken(): string | null {
    if (!isBrowser()) return null;
    return window.localStorage.getItem(REFRESH_KEY);
  },
  getUser(): TokenUser | null {
    if (!isBrowser()) return null;
    const raw = window.localStorage.getItem(USER_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as TokenUser;
    } catch {
      return null;
    }
  },
  setSession(accessToken: string, refreshToken: string, user: TokenUser) {
    if (!isBrowser()) return;
    window.localStorage.setItem(ACCESS_KEY, accessToken);
    window.localStorage.setItem(REFRESH_KEY, refreshToken);
    window.localStorage.setItem(USER_KEY, JSON.stringify(user));
  },
  setAccessToken(accessToken: string) {
    if (!isBrowser()) return;
    window.localStorage.setItem(ACCESS_KEY, accessToken);
  },
  clear() {
    if (!isBrowser()) return;
    window.localStorage.removeItem(ACCESS_KEY);
    window.localStorage.removeItem(REFRESH_KEY);
    window.localStorage.removeItem(USER_KEY);
  },
};
