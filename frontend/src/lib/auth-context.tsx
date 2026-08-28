"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ApiError } from "./api";
import { authApi } from "./endpoints";
import { tokenStore } from "./token-store";
import type { TokenUser } from "./types";
import { API_BASE_URL } from "./config";

interface AuthContextValue {
  user: TokenUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<TokenUser | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    // Reading localStorage has to happen post-mount (SSR has no
    // window/localStorage), so this can't be a lazy useState initializer —
    // an effect is the correct place for this one-time hydration read.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUser(tokenStore.getUser());
    setLoading(false);
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await fetch(`${API_BASE_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        let message = "Login failed.";
        try {
          const body = await res.json();
          if (res.status === 401) message = "Incorrect email or password.";
          else if (res.status === 403) message = "This account is locked. Contact an administrator.";
          else if (body?.detail) message = typeof body.detail === "string" ? body.detail : message;
        } catch {
          // ignore parse errors, keep default message
        }
        throw new ApiError(res.status, message);
      }
      const data = await res.json();
      tokenStore.setSession(data.access_token, data.refresh_token, data.user);
      setUser(data.user);
    },
    []
  );

  const logout = useCallback(async () => {
    const refreshToken = tokenStore.getRefreshToken();
    tokenStore.clear();
    setUser(null);
    if (refreshToken) {
      try {
        await authApi.logout(refreshToken);
      } catch {
        // best-effort: the local session is already cleared either way
      }
    }
    router.push("/login");
  }, [router]);

  return <AuthContext.Provider value={{ user, loading, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
