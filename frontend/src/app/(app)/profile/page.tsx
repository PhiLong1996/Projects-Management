"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { Avatar, ErrorBanner, PageHeader, RoleBadge, SuccessBanner } from "@/components/ui";
import { authApi, usersApi } from "@/lib/endpoints";
import { useAuth } from "@/lib/auth-context";
import { ApiError } from "@/lib/api";

function ProfileDetailsCard() {
  const { user, updateUser } = useAuth();
  const [fullName, setFullName] = useState(user?.full_name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  if (!user) return null;

  const dirty = fullName.trim() !== user.full_name || email.trim() !== user.email;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!user) return;
    setError(null);
    setSuccess(false);
    setSubmitting(true);
    try {
      const updated = await usersApi.updateProfile(user.id, {
        full_name: fullName.trim(),
        email: email.trim(),
      });
      // Push the change into the cached session (localStorage + the
      // AppShell's sidebar) immediately, without needing a re-login.
      updateUser({ full_name: updated.full_name, email: updated.email });
      setSuccess(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't update your profile.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="card" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <Avatar name={user.full_name} size={44} />
        <div>
          <div style={{ fontSize: 14.5, fontWeight: 600 }}>{user.full_name}</div>
          <div style={{ marginTop: 4 }}>
            <RoleBadge role={user.system_role} />
          </div>
        </div>
      </div>

      {error && <ErrorBanner message={error} />}
      {success && !dirty && <SuccessBanner message="Profile updated." />}

      <div>
        <label className="label" htmlFor="full-name">
          Full name
        </label>
        <input
          id="full-name"
          className="input"
          value={fullName}
          onChange={(e) => {
            setFullName(e.target.value);
            setSuccess(false);
          }}
          required
          minLength={1}
          maxLength={255}
        />
      </div>
      <div>
        <label className="label" htmlFor="profile-email">
          Email
        </label>
        <input
          id="profile-email"
          type="email"
          className="input"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            setSuccess(false);
          }}
          required
        />
      </div>
      <div style={{ fontSize: 12, color: "var(--text-faint)" }}>
        Your role ({user.system_role.replace(/_/g, " ").toLowerCase()}) can only be changed by an admin.
      </div>

      <div>
        <button type="submit" className="btn btn-primary" disabled={submitting || !dirty}>
          {submitting ? "Saving…" : "Save changes"}
        </button>
      </div>
    </form>
  );
}

function ChangePasswordCard() {
  const { logout } = useAuth();
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("New passwords don't match.");
      return;
    }

    setSubmitting(true);
    try {
      await authApi.changePassword(currentPassword, newPassword);
      // Changing your password revokes every refresh session, this one
      // included (see backend README §7 / auth service.change_password),
      // so the current login stops working the moment the access token
      // expires. Sign out immediately and explain why, rather than leaving
      // the user in a session that's about to die on its own.
      await logout();
      router.replace("/login?notice=" + encodeURIComponent("Password changed. Please sign in again."));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't change your password.");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="card" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <div style={{ fontSize: 14.5, fontWeight: 600 }}>Change password</div>
        <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 2 }}>
          You&apos;ll be signed out on every device after this — sign back in with your new password.
        </div>
      </div>

      {error && <ErrorBanner message={error} />}

      <div>
        <label className="label" htmlFor="current-password">
          Current password
        </label>
        <input
          id="current-password"
          type="password"
          className="input"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          required
        />
      </div>
      <div style={{ display: "flex", gap: 10 }}>
        <div style={{ flex: 1 }}>
          <label className="label" htmlFor="profile-new-password">
            New password
          </label>
          <input
            id="profile-new-password"
            type="password"
            className="input"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            minLength={8}
            required
          />
        </div>
        <div style={{ flex: 1 }}>
          <label className="label" htmlFor="profile-confirm-password">
            Confirm new password
          </label>
          <input
            id="profile-confirm-password"
            type="password"
            className="input"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            minLength={8}
            required
          />
        </div>
      </div>

      <div>
        <button type="submit" className="btn btn-secondary" disabled={submitting}>
          {submitting ? "Changing…" : "Change password"}
        </button>
      </div>
    </form>
  );
}

export default function ProfilePage() {
  return (
    <AppShell active="profile">
      <PageHeader title="Profile" subtitle="Manage your account details and password." />
      <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 480, marginTop: 20 }}>
        <ProfileDetailsCard />
        <ChangePasswordCard />
      </div>
    </AppShell>
  );
}
