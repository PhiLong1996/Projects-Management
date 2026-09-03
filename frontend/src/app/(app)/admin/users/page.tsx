"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { Avatar, CenteredSpinner, ErrorBanner, PageHeader, RoleBadge, UserStatusBadge } from "@/components/ui";
import { PlusIcon, SearchIcon } from "@/components/icons";
import { usersApi } from "@/lib/endpoints";
import { useAuth } from "@/lib/auth-context";
import type { SystemRole, User, UserStatus } from "@/lib/types";
import { ApiError } from "@/lib/api";
import { parseApiDate } from "@/lib/date";

function fmtLastActive(iso: string | null): string {
  if (!iso) return "Never";
  const diffMs = Date.now() - parseApiDate(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function NewUserForm({ onCreated, onCancel }: { onCreated: (u: User) => void; onCancel: () => void }) {
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<SystemRole>("TEAM_MEMBER");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const user = await usersApi.create({ email, full_name: fullName, password, system_role: role });
      onCreated(user);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create user.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="card" style={{ padding: 16, marginBottom: 16, display: "flex", flexDirection: "column", gap: 10 }}>
      {error && <ErrorBanner message={error} />}
      <div style={{ display: "flex", gap: 10 }}>
        <div style={{ flex: 1 }}>
          <label className="label">Full name</label>
          <input className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
        </div>
        <div style={{ flex: 1 }}>
          <label className="label">Email</label>
          <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
      </div>
      <div style={{ display: "flex", gap: 10 }}>
        <div style={{ flex: 1 }}>
          <label className="label">Temporary password</label>
          <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required />
        </div>
        <div style={{ flex: 1 }}>
          <label className="label">Role</label>
          <select className="input" value={role} onChange={(e) => setRole(e.target.value as SystemRole)}>
            <option value="TEAM_MEMBER">Team member</option>
            <option value="PROJECT_MANAGER">Project manager</option>
            <option value="ADMIN">Admin</option>
          </select>
        </div>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button type="submit" className="btn btn-primary" disabled={submitting}>
          {submitting ? "Creating…" : "Create user"}
        </button>
        <button type="button" className="btn btn-secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export default function AdminUsersPage() {
  const { user: currentUser, loading: authLoading } = useAuth();
  const router = useRouter();
  const [users, setUsers] = useState<User[]>([]);
  const [totalItems, setTotalItems] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showNewUser, setShowNewUser] = useState(false);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && currentUser && currentUser.system_role !== "ADMIN") {
      router.replace("/dashboard");
    }
  }, [authLoading, currentUser, router]);

  function load() {
    setLoading(true);
    usersApi
      .list({ page_size: 50, search: search || undefined })
      .then((res) => {
        setUsers(res.items);
        setTotalItems(res.pagination.total_items);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Failed to load users."))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  async function toggleLock(u: User) {
    setBusyUserId(u.id);
    setError(null);
    const nextStatus: UserStatus = u.status === "LOCKED" ? "ACTIVE" : "LOCKED";
    try {
      const updated = await usersApi.updateStatus(u.id, nextStatus);
      setUsers((prev) => prev.map((x) => (x.id === u.id ? updated : x)));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't update status.");
    } finally {
      setBusyUserId(null);
    }
  }

  if (authLoading || (currentUser && currentUser.system_role !== "ADMIN")) {
    return (
      <AppShell active="admin">
        <CenteredSpinner />
      </AppShell>
    );
  }

  return (
    <AppShell active="admin">
      <PageHeader
        title="Users"
        subtitle={`${totalItems} user${totalItems === 1 ? "" : "s"}`}
        action={
          <button className="btn btn-primary" onClick={() => setShowNewUser((v) => !v)}>
            <PlusIcon /> Create user
          </button>
        }
      />
      <div style={{ height: 16 }} />

      {error && (
        <div style={{ marginBottom: 16 }}>
          <ErrorBanner message={error} />
        </div>
      )}

      {showNewUser && (
        <NewUserForm
          onCreated={(u) => {
            setUsers((prev) => [u, ...prev]);
            setShowNewUser(false);
          }}
          onCancel={() => setShowNewUser(false)}
        />
      )}

      <div className="input" style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, maxWidth: 280 }}>
        <SearchIcon style={{ color: "var(--text-faint)" }} />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search users…"
          style={{ border: "none", outline: "none", flex: 1, fontSize: 13, background: "transparent" }}
        />
      </div>

      {loading ? (
        <CenteredSpinner />
      ) : (
        <div className="card" style={{ overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["Name", "Email", "Role", "Status", "Last active", ""].map((h) => (
                  <th
                    key={h}
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      textTransform: "uppercase",
                      letterSpacing: "0.03em",
                      color: "var(--text-faint)",
                      textAlign: "left",
                      padding: "14px 16px 10px 16px",
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td style={{ padding: "12px 16px", borderTop: "1px solid var(--border)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <Avatar name={u.full_name} />
                      <span style={{ fontWeight: 500, fontSize: 13.5 }}>{u.full_name}</span>
                    </div>
                  </td>
                  <td className="mono" style={{ padding: "12px 16px", borderTop: "1px solid var(--border)", fontSize: 12.5, color: "var(--text-muted)" }}>
                    {u.email}
                  </td>
                  <td style={{ padding: "12px 16px", borderTop: "1px solid var(--border)" }}>
                    <RoleBadge role={u.system_role} />
                  </td>
                  <td style={{ padding: "12px 16px", borderTop: "1px solid var(--border)" }}>
                    <UserStatusBadge status={u.status} />
                  </td>
                  <td style={{ padding: "12px 16px", borderTop: "1px solid var(--border)", fontSize: 13, color: "var(--text-muted)" }}>
                    {fmtLastActive(u.last_login_at)}
                  </td>
                  <td style={{ padding: "12px 16px", borderTop: "1px solid var(--border)", textAlign: "right" }}>
                    {u.id !== currentUser?.id && u.status !== "INACTIVE" && (
                      <button
                        onClick={() => toggleLock(u)}
                        disabled={busyUserId === u.id}
                        className={u.status === "LOCKED" ? "btn btn-secondary" : "btn btn-danger"}
                        style={{ height: 26, fontSize: 11.5, padding: "0 10px" }}
                      >
                        {u.status === "LOCKED" ? "Unlock" : "Lock"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}
