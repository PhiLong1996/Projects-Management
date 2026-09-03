"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { Avatar, CenteredSpinner, ErrorBanner, PageHeader, PriorityBadge, StatusBadge } from "@/components/ui";
import { SearchIcon } from "@/components/icons";
import { projectsApi, tasksApi, usersApi } from "@/lib/endpoints";
import { useAuth } from "@/lib/auth-context";
import type { Project, Task, TaskStatus, User } from "@/lib/types";
import { ApiError } from "@/lib/api";

const STATUS_FILTERS: { key: TaskStatus | "ALL"; label: string }[] = [
  { key: "ALL", label: "All" },
  { key: "TODO", label: "To Do" },
  { key: "IN_PROGRESS", label: "In Progress" },
  { key: "IN_REVIEW", label: "In Review" },
  { key: "DONE", label: "Done" },
  { key: "CANCELLED", label: "Cancelled" },
];

function isOverdue(task: Task): boolean {
  return !!task.due_date && task.status !== "DONE" && task.status !== "CANCELLED" && new Date(task.due_date).getTime() < Date.now();
}

interface Row {
  project: Project;
  task: Task;
}

export default function TasksPage() {
  const { user } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<TaskStatus | "ALL">("ALL");
  const [onlyMine, setOnlyMine] = useState(true);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resets loading/error state before the fetch starts
    setLoading(true);
    setError(null);
    projectsApi
      .list({ page_size: 100 })
      .then(async (res) => {
        const [perProject, userList] = await Promise.all([
          Promise.all(
            res.items.map((project) =>
              tasksApi
                .listForProject(project.id, { page_size: 100, sort_by: "-created_at" })
                .then((r) => r.items.map((task) => ({ project, task })))
                .catch(() => [] as Row[])
            )
          ),
          usersApi.list({ page_size: 100 }).then((r) => r.items),
        ]);
        setRows(perProject.flat());
        setUsers(userList);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Failed to load tasks."))
      .finally(() => setLoading(false));
  }, []);

  const usersById = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows
      .filter((r) => statusFilter === "ALL" || r.task.status === statusFilter)
      .filter((r) => !onlyMine || r.task.assignee_id === user?.id)
      .filter(
        (r) =>
          !q ||
          r.task.title.toLowerCase().includes(q) ||
          r.project.name.toLowerCase().includes(q) ||
          r.project.code.toLowerCase().includes(q)
      )
      .sort((a, b) => {
        if (!a.task.due_date && !b.task.due_date) return 0;
        if (!a.task.due_date) return 1;
        if (!b.task.due_date) return -1;
        return new Date(a.task.due_date).getTime() - new Date(b.task.due_date).getTime();
      });
  }, [rows, search, statusFilter, onlyMine, user?.id]);

  return (
    <AppShell active="tasks">
      <PageHeader title="Tasks" subtitle="Every task across your projects — click one to open it." />

      {error && (
        <div style={{ marginBottom: 16 }}>
          <ErrorBanner message={error} />
        </div>
      )}

      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
        <div className="input" style={{ display: "flex", alignItems: "center", gap: 8, flex: "1 1 260px" }}>
          <SearchIcon style={{ color: "var(--text-faint)" }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tasks or projects…"
            style={{ border: "none", outline: "none", flex: 1, fontSize: 13, background: "transparent" }}
          />
        </div>
        <button type="button" className={onlyMine ? "btn btn-primary" : "btn btn-secondary"} onClick={() => setOnlyMine((v) => !v)}>
          {onlyMine ? "My tasks" : "All tasks"}
        </button>
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setStatusFilter(f.key)}
            className={statusFilter === f.key ? "btn btn-primary" : "btn btn-secondary"}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <CenteredSpinner />
      ) : filtered.length === 0 ? (
        <div className="card" style={{ padding: 24, color: "var(--text-muted)", fontSize: 13 }}>
          No tasks match.
        </div>
      ) : (
        <div className="card">
          {filtered.map(({ project, task }) => {
            const assignee = task.assignee_id ? usersById.get(task.assignee_id) : undefined;
            return (
              <Link
                key={task.id}
                href={`/projects/${project.id}/tasks/${task.id}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "12px 16px",
                  borderBottom: "1px solid var(--border)",
                  color: "inherit",
                  textDecoration: "none",
                }}
              >
                <span className="mono" style={{ fontSize: 11.5, color: "var(--text-faint)", width: 90, flexShrink: 0 }}>
                  {project.code}
                </span>
                <StatusBadge status={task.status} />
                <span style={{ fontSize: 13.5, fontWeight: 500, flex: 1 }}>{task.title}</span>
                <PriorityBadge priority={task.priority} />
                {task.due_date && (
                  <span className="mono" style={{ fontSize: 11.5, color: isOverdue(task) ? "var(--red)" : "var(--text-faint)" }}>
                    {new Date(task.due_date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                  </span>
                )}
                {assignee ? <Avatar name={assignee.full_name} size={22} /> : <span style={{ width: 22 }} />}
              </Link>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}
