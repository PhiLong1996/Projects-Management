import type { ReactNode } from "react";
import type { NotificationType, ProjectStatus, SprintStatus, SystemRole, TaskPriority, TaskStatus, UserStatus } from "@/lib/types";

const AVATAR_COLORS = [
  "var(--accent)",
  "var(--blue)",
  "var(--violet)",
  "var(--orange)",
  "oklch(0.6 0.12 190)",
  "oklch(0.6 0.13 340)",
  "oklch(0.6 0.12 120)",
];

function colorForName(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function Avatar({ name, size = 26 }: { name: string; size?: number }) {
  return (
    <div
      className="avatar"
      style={{ width: size, height: size, background: colorForName(name), fontSize: size * 0.4 }}
      title={name}
    >
      {initials(name)}
    </div>
  );
}

const STATUS_COLOR: Record<string, { bg: string; fg: string }> = {
  TODO: { bg: "var(--bg-subtle)", fg: "var(--text-muted)" },
  IN_PROGRESS: { bg: "var(--blue-subtle)", fg: "var(--blue)" },
  IN_REVIEW: { bg: "var(--violet-subtle)", fg: "var(--violet)" },
  DONE: { bg: "var(--green-subtle)", fg: "var(--green)" },
  CANCELLED: { bg: "var(--bg-subtle)", fg: "var(--text-faint)" },
  PLANNING: { bg: "var(--amber-subtle)", fg: "var(--amber)" },
  ACTIVE: { bg: "var(--green-subtle)", fg: "var(--green)" },
  CLOSED: { bg: "var(--bg-subtle)", fg: "var(--text-muted)" },
  PLANNED: { bg: "var(--blue-subtle)", fg: "var(--blue)" },
};

const PRIORITY_COLOR: Record<TaskPriority, { bg: string; fg: string }> = {
  LOW: { bg: "var(--blue-subtle)", fg: "var(--blue)" },
  MEDIUM: { bg: "var(--blue-subtle)", fg: "var(--blue)" },
  HIGH: { bg: "var(--orange-subtle)", fg: "var(--orange)" },
  CRITICAL: { bg: "var(--red-subtle)", fg: "var(--red)" },
};

const USER_STATUS_COLOR: Record<UserStatus, { bg: string; fg: string; dot: string }> = {
  ACTIVE: { bg: "var(--green-subtle)", fg: "var(--green)", dot: "var(--green)" },
  LOCKED: { bg: "var(--red-subtle)", fg: "var(--red)", dot: "var(--red)" },
  INACTIVE: { bg: "var(--bg-subtle)", fg: "var(--text-faint)", dot: "var(--text-faint)" },
};

const ROLE_COLOR: Record<SystemRole, { bg: string; fg: string }> = {
  ADMIN: { bg: "var(--violet-subtle)", fg: "var(--violet)" },
  PROJECT_MANAGER: { bg: "var(--accent-subtle)", fg: "var(--accent-subtle-text)" },
  TEAM_MEMBER: { bg: "var(--bg-subtle)", fg: "var(--text-muted)" },
};

export function StatusBadge({ status }: { status: TaskStatus | ProjectStatus | SprintStatus }) {
  const c = STATUS_COLOR[status] ?? { bg: "var(--bg-subtle)", fg: "var(--text-muted)" };
  return (
    <span className="badge" style={{ background: c.bg, color: c.fg }}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

export function PriorityBadge({ priority }: { priority: TaskPriority }) {
  const c = PRIORITY_COLOR[priority];
  return (
    <span className="badge" style={{ background: c.bg, color: c.fg }}>
      {priority}
    </span>
  );
}

export function UserStatusBadge({ status }: { status: UserStatus }) {
  const c = USER_STATUS_COLOR[status];
  return (
    <span className="badge" style={{ background: c.bg, color: c.fg }}>
      <span style={{ width: 6, height: 6, borderRadius: 999, background: c.dot }} />
      {status}
    </span>
  );
}

export function RoleBadge({ role }: { role: SystemRole }) {
  const c = ROLE_COLOR[role];
  return (
    <span className="badge" style={{ background: c.bg, color: c.fg }}>
      {role.replace(/_/g, " ")}
    </span>
  );
}

export const NOTIFICATION_LABEL: Record<NotificationType, string> = {
  TASK_ASSIGNED: "Task assigned",
  TASK_REASSIGNED: "Task reassigned",
  TASK_STATUS_CHANGED: "Task status changed",
  TASK_UPDATED: "Task updated",
  COMMENT_ADDED: "New comment",
  DEADLINE_APPROACHING: "Deadline approaching",
  TASK_OVERDUE: "Task overdue",
  PROJECT_MEMBER_ADDED: "Added to project",
};

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="card" style={{ padding: "36px 20px", textAlign: "center", color: "var(--text-muted)" }}>
      <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--text)" }}>{title}</div>
      {hint && <div style={{ fontSize: 12.5, marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

export function ErrorBanner({ message }: { message: string }) {
  return (
    <div
      className="card"
      style={{ padding: "10px 14px", background: "var(--red-subtle)", borderColor: "var(--red-subtle)", color: "var(--red)", fontSize: 13 }}
    >
      {message}
    </div>
  );
}

export function SuccessBanner({ message }: { message: string }) {
  return (
    <div
      className="card"
      style={{
        padding: "10px 14px",
        background: "var(--green-subtle)",
        borderColor: "var(--green-subtle)",
        color: "var(--green)",
        fontSize: 13,
      }}
    >
      {message}
    </div>
  );
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: subtitle ? 4 : 20 }}>
      <div>
        <div style={{ fontSize: 20, fontWeight: 600 }}>{title}</div>
        {subtitle && <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4 }}>{subtitle}</div>}
      </div>
      {action}
    </div>
  );
}

export function Spinner() {
  return (
    <div
      style={{
        width: 18,
        height: 18,
        borderRadius: "999px",
        border: "2px solid var(--border)",
        borderTopColor: "var(--accent)",
        animation: "spin 0.7s linear infinite",
      }}
    >
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

export function CenteredSpinner() {
  return (
    <div style={{ display: "flex", justifyContent: "center", padding: "60px 0" }}>
      <Spinner />
    </div>
  );
}
