"use client";

import { use, useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { Avatar, CenteredSpinner, ErrorBanner, PageHeader, PriorityBadge } from "@/components/ui";
import { PlusIcon } from "@/components/icons";
import { projectsApi, sprintsApi, tasksApi, usersApi } from "@/lib/endpoints";
import type { Project, Sprint, Task, TaskPriority, TaskStatus, User } from "@/lib/types";
import { ApiError } from "@/lib/api";

const COLUMNS: { key: TaskStatus; label: string; color: string }[] = [
  { key: "TODO", label: "To Do", color: "var(--text-faint)" },
  { key: "IN_PROGRESS", label: "In Progress", color: "var(--blue)" },
  { key: "IN_REVIEW", label: "In Review", color: "var(--violet)" },
  { key: "DONE", label: "Done", color: "var(--green)" },
];

function isOverdue(task: Task): boolean {
  return !!task.due_date && task.status !== "DONE" && task.status !== "CANCELLED" && new Date(task.due_date).getTime() < Date.now();
}

function TaskCard({
  projectId,
  task,
  assignee,
  onDragStart,
}: {
  projectId: string;
  task: Task;
  assignee?: User;
  onDragStart: (e: React.DragEvent, taskId: string) => void;
}) {
  // The card IS the link (rather than a draggable div with a separate
  // absolutely-positioned Link on top for navigation) — an overlay on top
  // of a draggable element intercepts the drag gesture before it ever
  // reaches the card underneath (anchors are natively draggable too, so
  // the browser would start dragging the link instead), which made cards
  // stick instead of dragging between columns.
  return (
    <Link
      href={`/projects/${projectId}/tasks/${task.id}`}
      draggable
      onDragStart={(e) => onDragStart(e, task.id)}
      className="card"
      style={{ display: "block", padding: 12, cursor: "grab", color: "var(--text)", textDecoration: "none" }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <span className="mono" style={{ fontSize: 10.5, color: "var(--text-faint)" }}>
          {task.id.slice(0, 8)}
        </span>
        <PriorityBadge priority={task.priority} />
      </div>
      <div style={{ fontSize: 13, fontWeight: 500, lineHeight: 1.4, marginBottom: 10 }}>{task.title}</div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        {task.due_date ? (
          <span className="mono" style={{ fontSize: 11, color: isOverdue(task) ? "var(--red)" : "var(--text-faint)" }}>
            {new Date(task.due_date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
          </span>
        ) : (
          <span />
        )}
        {assignee && <Avatar name={assignee.full_name} size={22} />}
      </div>
    </Link>
  );
}

function NewTaskForm({ projectId, users, onCreated, onCancel }: { projectId: string; users: User[]; onCreated: (t: Task) => void; onCancel: () => void }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("MEDIUM");
  const [assigneeId, setAssigneeId] = useState("");
  const [sprintId, setSprintId] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    sprintsApi.list(projectId).then(setSprints).catch(() => setSprints([]));
  }, [projectId]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const task = await tasksApi.create(projectId, {
        title,
        description: description || undefined,
        priority,
        sprint_id: sprintId || undefined,
        assignee_id: assigneeId || undefined,
        due_date: dueDate ? new Date(dueDate).toISOString() : undefined,
      });
      onCreated(task);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create task.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="card" style={{ padding: 16, marginBottom: 16, display: "flex", flexDirection: "column", gap: 10 }}>
      {error && <ErrorBanner message={error} />}
      <div>
        <label className="label">Title</label>
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} required autoFocus />
      </div>
      <div>
        <label className="label">Description</label>
        <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <div style={{ display: "flex", gap: 10 }}>
        <div style={{ flex: 1 }}>
          <label className="label">Priority</label>
          <select className="input" value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)}>
            <option value="LOW">Low</option>
            <option value="MEDIUM">Medium</option>
            <option value="HIGH">High</option>
            <option value="CRITICAL">Critical</option>
          </select>
        </div>
        <div style={{ flex: 1 }}>
          <label className="label">Sprint</label>
          <select className="input" value={sprintId} onChange={(e) => setSprintId(e.target.value)}>
            <option value="">Backlog</option>
            {sprints.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div style={{ flex: 1 }}>
          <label className="label">Assignee</label>
          <select className="input" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
            <option value="">Unassigned</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.full_name}
              </option>
            ))}
          </select>
        </div>
        <div style={{ flex: 1 }}>
          <label className="label">Due date</label>
          <input className="input" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </div>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button type="submit" className="btn btn-primary" disabled={submitting}>
          {submitting ? "Creating…" : "Create task"}
        </button>
        <button type="button" className="btn btn-secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export default function BoardPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = use(params);
  const [project, setProject] = useState<Project | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showNewTask, setShowNewTask] = useState(false);
  const [dragTaskId, setDragTaskId] = useState<string | null>(null);

  function load() {
    setLoading(true);
    Promise.all([
      projectsApi.list({ page_size: 100 }).then((r) => r.items.find((p) => p.id === projectId) ?? null),
      tasksApi.listForProject(projectId, { page_size: 100, sort_by: "-created_at" }).then((r) => r.items),
      usersApi.list({ page_size: 100 }).then((r) => r.items),
    ])
      .then(([p, t, u]) => {
        setProject(p);
        setTasks(t);
        setUsers(u);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Failed to load board."))
      .finally(() => setLoading(false));
  }

  // eslint-disable-next-line react-hooks/set-state-in-effect -- load() sets loading state before its fetch starts
  useEffect(load, [projectId]);

  const usersById = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);

  async function moveTask(taskId: string, status: TaskStatus) {
    const prev = tasks;
    setTasks((cur) => cur.map((t) => (t.id === taskId ? { ...t, status } : t)));
    try {
      await tasksApi.updateStatus(taskId, status);
    } catch (err) {
      setTasks(prev);
      setError(err instanceof ApiError ? err.message : "Couldn't move that task.");
    }
  }

  if (loading) {
    return (
      <AppShell active="board">
        <CenteredSpinner />
      </AppShell>
    );
  }

  return (
    <AppShell active="board">
      <PageHeader
        title={project ? `${project.code} — ${project.name}` : "Board"}
        subtitle="Drag a card between columns to change its status."
        action={
          <button className="btn btn-primary" onClick={() => setShowNewTask((v) => !v)}>
            <PlusIcon /> New task
          </button>
        }
      />

      {error && (
        <div style={{ marginBottom: 16 }}>
          <ErrorBanner message={error} />
        </div>
      )}

      {showNewTask && (
        <NewTaskForm
          projectId={projectId}
          users={users}
          onCreated={(t) => {
            setTasks((prev) => [t, ...prev]);
            setShowNewTask(false);
          }}
          onCancel={() => setShowNewTask(false)}
        />
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
        {COLUMNS.map((col) => {
          const colTasks = tasks.filter((t) => t.status === col.key);
          return (
            <div
              key={col.key}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                if (dragTaskId) moveTask(dragTaskId, col.key);
                setDragTaskId(null);
              }}
              style={{ display: "flex", flexDirection: "column", gap: 10, minHeight: 200 }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 8, height: 8, borderRadius: 999, background: col.color }} />
                <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.03em" }}>
                  {col.label}
                </span>
                <span className="mono" style={{ fontSize: 11.5, color: "var(--text-faint)" }}>{colTasks.length}</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {colTasks.map((t) => (
                  <TaskCard
                    key={t.id}
                    projectId={projectId}
                    task={t}
                    assignee={t.assignee_id ? usersById.get(t.assignee_id) : undefined}
                    onDragStart={(e, id) => {
                      e.dataTransfer.effectAllowed = "move";
                      setDragTaskId(id);
                    }}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </AppShell>
  );
}
