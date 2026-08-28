"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { LogoMark } from "@/components/icons";
import { ErrorBanner } from "@/components/ui";

export default function LoginPage() {
  const { user, login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (user) router.replace("/dashboard");
  }, [user, router]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
      router.replace("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ display: "flex", width: "100%", minHeight: "100vh" }}>
      <div
        style={{
          flex: "0 0 44%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 48,
          background: "linear-gradient(160deg, oklch(0.24 0.05 264), oklch(0.16 0.04 270))",
          color: "white",
        }}
        className="hidden md:flex"
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <rect x="3" y="3" width="8" height="8" rx="2" stroke="white" strokeWidth="1.8" />
            <rect x="13" y="3" width="8" height="8" rx="2" stroke="white" strokeWidth="1.8" opacity="0.55" />
            <rect x="3" y="13" width="8" height="8" rx="2" stroke="white" strokeWidth="1.8" opacity="0.55" />
            <rect x="13" y="13" width="8" height="8" rx="2" stroke="white" strokeWidth="1.8" />
          </svg>
          <span style={{ fontSize: 17, fontWeight: 600 }}>Taskflow</span>
        </div>
        <div style={{ maxWidth: 380 }}>
          <div style={{ fontSize: 26, fontWeight: 600, lineHeight: 1.3 }}>
            Plan sprints, track tasks, and ship on time.
          </div>
          <div style={{ fontSize: 14, opacity: 0.75, marginTop: 12, lineHeight: 1.6 }}>
            One workspace for projects, sprints, and the whole team&apos;s work — with realtime
            updates the moment something changes.
          </div>
        </div>
        <div style={{ fontSize: 12, opacity: 0.55 }}>Smart Task Management System</div>
      </div>

      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <form onSubmit={handleSubmit} style={{ width: "100%", maxWidth: 360 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 28 }}>
            <LogoMark />
            <span style={{ fontSize: 15, fontWeight: 600 }}>Taskflow</span>
          </div>
          <div style={{ fontSize: 20, fontWeight: 600, marginBottom: 4 }}>Welcome back</div>
          <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 24 }}>
            Sign in with your workspace account.
          </div>

          {error && (
            <div style={{ marginBottom: 16 }}>
              <ErrorBanner message={error} />
            </div>
          )}

          <div style={{ marginBottom: 16 }}>
            <label className="label" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              type="email"
              className="input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              required
              autoFocus
            />
          </div>
          <div style={{ marginBottom: 22 }}>
            <label className="label" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              type="password"
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </div>
          <button type="submit" className="btn btn-primary" style={{ width: "100%", justifyContent: "center" }} disabled={submitting}>
            {submitting ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
