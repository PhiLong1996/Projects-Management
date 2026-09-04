"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { authApi } from "@/lib/endpoints";
import { ApiError } from "@/lib/api";
import { ErrorBanner } from "@/components/ui";
import { ArrowLeftIcon, LogoMark, MailIcon } from "@/components/icons";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // The backend always returns 204 here regardless of whether the email
  // exists, so the UI can't (and shouldn't) tell the user which happened —
  // showing this generic "check your inbox" state either way is the point,
  // not a bug: it's what keeps this endpoint from leaking account existence.
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await authApi.forgotPassword(email);
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ display: "flex", width: "100%", minHeight: "100vh", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ width: "100%", maxWidth: 360 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 28 }}>
          <LogoMark />
          <span style={{ fontSize: 15, fontWeight: 600 }}>Taskflow</span>
        </div>

        {sent ? (
          <>
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 999,
                background: "var(--accent-subtle)",
                color: "var(--accent-subtle-text)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                marginBottom: 16,
              }}
            >
              <MailIcon />
            </div>
            <div style={{ fontSize: 20, fontWeight: 600, marginBottom: 4 }}>Check your inbox</div>
            <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 24, lineHeight: 1.6 }}>
              If an account exists for <strong>{email}</strong>, we&apos;ve emailed a link to reset your password.
              It expires in 30 minutes.
            </div>
            <Link href="/login" className="btn btn-secondary" style={{ width: "100%", justifyContent: "center" }}>
              <ArrowLeftIcon />
              Back to sign in
            </Link>
          </>
        ) : (
          <form onSubmit={handleSubmit}>
            <div style={{ fontSize: 20, fontWeight: 600, marginBottom: 4 }}>Forgot your password?</div>
            <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 24 }}>
              Enter your account email and we&apos;ll send you a reset link.
            </div>

            {error && (
              <div style={{ marginBottom: 16 }}>
                <ErrorBanner message={error} />
              </div>
            )}

            <div style={{ marginBottom: 22 }}>
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

            <button type="submit" className="btn btn-primary" style={{ width: "100%", justifyContent: "center" }} disabled={submitting}>
              {submitting ? "Sending…" : "Send reset link"}
            </button>

            <div style={{ marginTop: 18, textAlign: "center" }}>
              <Link href="/login" style={{ fontSize: 13, color: "var(--text-muted)" }}>
                Back to sign in
              </Link>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
