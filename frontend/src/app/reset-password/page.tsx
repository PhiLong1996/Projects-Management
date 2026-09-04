"use client";

import { Suspense, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { authApi } from "@/lib/endpoints";
import { ApiError } from "@/lib/api";
import { CenteredSpinner, ErrorBanner } from "@/components/ui";
import { ArrowLeftIcon, CheckIcon, LogoMark } from "@/components/icons";

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (newPassword.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }

    setSubmitting(true);
    try {
      await authApi.resetPassword(token, newPassword);
      setDone(true);
    } catch (err) {
      // A used/expired/malformed token surfaces here as a 400 from the
      // backend (see reset-password's Consume-the-token behavior).
      setError(err instanceof ApiError ? err.message : "Couldn't reset your password. Please try again.");
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

        {!token ? (
          <>
            <div style={{ fontSize: 20, fontWeight: 600, marginBottom: 4 }}>Invalid reset link</div>
            <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 24, lineHeight: 1.6 }}>
              This link is missing its reset token. Request a new one to continue.
            </div>
            <Link href="/forgot-password" className="btn btn-primary" style={{ width: "100%", justifyContent: "center" }}>
              Request a new link
            </Link>
          </>
        ) : done ? (
          <>
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 999,
                background: "var(--green-subtle)",
                color: "var(--green)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                marginBottom: 16,
              }}
            >
              <CheckIcon />
            </div>
            <div style={{ fontSize: 20, fontWeight: 600, marginBottom: 4 }}>Password reset</div>
            <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 24, lineHeight: 1.6 }}>
              Your password has been changed. Sign in with your new password — you&apos;ll need to do this on any
              other devices too, since all previous sessions were signed out.
            </div>
            <button
              className="btn btn-primary"
              style={{ width: "100%", justifyContent: "center" }}
              onClick={() => router.replace("/login")}
            >
              Continue to sign in
            </button>
          </>
        ) : (
          <form onSubmit={handleSubmit}>
            <div style={{ fontSize: 20, fontWeight: 600, marginBottom: 4 }}>Set a new password</div>
            <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 24 }}>
              Choose a new password for your account.
            </div>

            {error && (
              <div style={{ marginBottom: 16 }}>
                <ErrorBanner message={error} />
              </div>
            )}

            <div style={{ marginBottom: 16 }}>
              <label className="label" htmlFor="new-password">
                New password
              </label>
              <input
                id="new-password"
                type="password"
                className="input"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="••••••••"
                minLength={8}
                required
                autoFocus
              />
            </div>
            <div style={{ marginBottom: 22 }}>
              <label className="label" htmlFor="confirm-password">
                Confirm new password
              </label>
              <input
                id="confirm-password"
                type="password"
                className="input"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
                minLength={8}
                required
              />
            </div>

            <button type="submit" className="btn btn-primary" style={{ width: "100%", justifyContent: "center" }} disabled={submitting}>
              {submitting ? "Resetting…" : "Reset password"}
            </button>

            <div style={{ marginTop: 18, textAlign: "center" }}>
              <Link href="/login" style={{ fontSize: 13, color: "var(--text-muted)", display: "inline-flex", alignItems: "center", gap: 6 }}>
                <ArrowLeftIcon />
                Back to sign in
              </Link>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<CenteredSpinner />}>
      <ResetPasswordForm />
    </Suspense>
  );
}
