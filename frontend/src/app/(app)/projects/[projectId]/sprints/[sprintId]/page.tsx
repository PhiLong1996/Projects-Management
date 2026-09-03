"use client";

import { use, useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { Avatar, CenteredSpinner, ErrorBanner, PriorityBadge, StatusBadge } from "@/components/ui";
import { projectsApi, sprintsApi, tasksApi, usersApi } from "@/lib/endpoints";
import type { Project, Sprint, SprintStatus, Task, User } from "@/lib/types";
import { ApiError } from "@/lib/api";

function fmtDate(d: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function toDateInputValue(d: string): string {
  return d.slice(0, 10);
}

function EditSprintForm({ sprint, onSaved, onCancel }: { sprint: Sprint; onSaved: (s: Sprint) => void; onCancel: () => void }) {
  const [name, setName] = useState(sprint.name);
  const [goal, setGoal] = useState(sprint.goal ?? "");
  const [status, setStatus] = useState<SprintStatus>(sprint.status);
  const [startDate, setStartDate] = useState(toDateInputValue(sprint.start_date));
  const [endDate, setEndDate] = useState(toDateInputValue(sprint.end_date));
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const updated = await sprintsApi.update(sprint.project_id, sprint.id, {
        name,
        goal: goal || undefined,
        status,
        start_date: startDate,
        end_date: endDate,
      });
      onSaved(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to update sprint.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="card" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 10 }}>
      {error && <ErrorBanner message={error} />}
      <div>
        <label className="label">Name</label>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
      </div>
      <div>
        <label className="label">Goal</label>
        <input className="input" value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="Optional" />
      </div>
      <div style={{ display: "flex", gap: 10 }}>
        <div style={{ flex: 1 }}>
          <label className="label">Status</label>
          <select className="input" value={status} onChange={(e) => setStatus(e.target.value as SprintStatus)}>
            <option value="PLANNED">Planned</option>
            <option value="ACTIVE">Active</option>
            <option value="CLOSED">Closed</option>
          </select>
        </div>
        <div style={{ flex: 1 }}>
          <label className="label">Start date</label>
          <input className="input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
        </div>
        <div style={{ flex: 1 }}>
          <label className="label">End date</label>
          <input className="input" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} min={startDate} required />
        </div>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button type="submit" className="btn btn-primary" disabled={submitting}>
          {submitting ? "Saving…" : "Save changes"}
        </button>
        <button type="button" className="btn btn-secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function TaskRow({ projectId, task, assignee }: { projectId: string; task: Task; assignee?: User }) {
  return (
    <Link
      href={`/projects/${projectId}/tasks/${task.id}`}
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
      <StatusBadge status={task.status} />
      <span style={{ fontSize: 13.5, fontWeight: 500, flex: 1 }}>{task.title}</span>
      <PriorityBadge priority={task.priority} />
      {task.due_date && (
        <span className="mono" style={{ fontSize: 11.5, color: "var(--text-faint)" }}>
          {new Date(task.due_date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
        </span>
      )}
      {assignee ? <Avatar name={assignee.full_name} size={22} /> : <span style={{ width: 22 }} />}
    </Link>
  );
}

export default function SprintDetailPage({ params }: { params: Promise<{ projectId: string; sprintId: string }> }) {
  const { projectId, sprintId } = use(params);
  const [project, setProject] = useState<Project | null>(null);
  const [sprint, setSprint] = useState<Sprint | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [closing, setClosing] = useState(false);

  function load() {
    setLoading(true);
    setError(null);
    Promise.all([
      projectsApi.list({ page_size: 100 }).then((r) => r.items.find((p) => p.id === projectId) ?? null),
      sprintsApi.list(projectId).then((s) => s.find((x) => x.id === sprintId) ?? null),
      tasksApi.listForProject(projectId, { sprint_id: sprintId, page_size: 100 }).then((r) => r.items),
      usersApi.list({ page_size: 100 }).then((r) => r.items),
    ])
      .then(([p, s, t, u]) => {
        setProject(p);
        setSprint(s);
        setTasks(t);
        setUsers(u);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Failed to load sprint."))
      .finally(() => setLoading(false));
  }

  // eslint-disable-next-line react-hooks/set-state-in-effect -- load() sets loading state before its fetch starts
  useEffect(load, [projectId, sprintId]);

  const usersById = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);

  async function closeSprint() {
    if (!sprint) return;
    setClosing(true);
    setError(null);
    try {
      const updated = await sprintsApi.close(projectId, sprint.id);
      setSprint(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to close sprint.");
    } finally {
      setClosing(false);
    }
  }

  if (loading) {
    return (
      <AppShell active="projects">
        <CenteredSpinner />
      </AppShell>
    );
  }

  if (!sprint) {
    return (
      <AppShell active="projects">
        <div className="card" style={{ padding: 24, color: "var(--text-muted)", fontSize: 13 }}>
          {error || "That sprint couldn't be found."}
        </div>
        <div style={{ marginTop: 16 }}>
          <Link href="/projects" className="btn btn-secondary">
            Back to projects
          </Link>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell active="projects">
      <div style={{ marginBottom: 16 }}>
        <Link href="/projects" style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
          ← {project ? `${project.code} — ${project.name}` : "Back to project"}
        </Link>
      </div>

      {error && (
        <div style={{ marginBottom: 16 }}>
          <ErrorBanner message={error} />
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        {editing ? (
          <EditSprintForm
            sprint={sprint}
            onSaved={(s) => {
              setSprint(s);
              setEditing(false);
            }}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <div className="card" style={{ padding: 20 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 18, fontWeight: 600 }}>{sprint.name}</span>
                <StatusBadge status={sprint.status} />
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button type="button" className="btn btn-secondary" onClick={() => setEditing(true)}>
                  Edit
                </button>
                {sprint.status !== "CLOSED" && (
                  <button type="button" className="btn btn-secondary" onClick={closeSprint} disabled={closing}>
                    {closing ? "Closing…" : "Close sprint"}
                  </button>
                )}
              </div>
            </div>
            {sprint.goal && <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 10 }}>{sprint.goal}</div>}
            <div className="mono" style={{ fontSize: 12, color: "var(--text-faint)" }}>
              {fmtDate(sprint.start_date)} – {fmtDate(sprint.end_date)}
            </div>
          </div>
        )}

        <div className="card">
          <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--border)", fontSize: 14, fontWeight: 600 }}>
            Tasks in this sprint
          </div>
          {tasks.length === 0 ? (
            <div style={{ padding: 20, fontSize: 13, color: "var(--text-muted)" }}>No tasks assigned to this sprint yet.</div>
          ) : (
            tasks.map((t) => (
              <TaskRow key={t.id} projectId={projectId} task={t} assignee={t.assignee_id ? usersById.get(t.assignee_id) : undefined} />
            ))
          )}
        </div>
      </div>
    </AppShell>
  );
}
