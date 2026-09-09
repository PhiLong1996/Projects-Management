"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { Avatar, CenteredSpinner, EmptyState, ErrorBanner, PageHeader, PriorityBadge } from "@/components/ui";
import { PlusIcon } from "@/components/icons";
import { projectsApi, sprintsApi, tasksApi, usersApi } from "@/lib/endpoints";
import type { Project, Sprint, Task, TaskPriority, TaskStatus, User } from "@/lib/types";
import { ApiError } from "@/lib/api";

const SELECTED_PROJECT_KEY = "taskflow.selected_project_id";
const ALL_PROJECTS = "ALL";

const COLUMNS: { key: TaskStatus; label: string; color: string }[] = [
  { key: "TODO", label: "To Do", color: "var(--text-faint)" },
  { key: "IN_PROGRESS", label: "In Progress", color: "var(--blue)" },
  { key: "IN_REVIEW", label: "In Review", color: "var(--violet)" },
  { key: "DONE", label: "Done", color: "var(--green)" },
];

function isOverdue(task: Task): boolean {
  return !!task.due_date && task.status !== "DONE" && task.status !== "CANCELLED" && new Date(task.due_date).getTime() < Date.now();
}

interface Row {
  project: Project;
  task: Task;
}

function TaskCard({
  row,
  showProjectBadge,
  assignee,
  onDragStart,
}: {
  row: Row;
  showProjectBadge: boolean;
  assignee?: User;
  onDragStart: (e: React.DragEvent, taskId: string) => void;
}) {
  const { task, project } = row;
  // The card IS the link (rather than a draggable div with a separate
  // absolutely-positioned Link on top for navigation) — an overlay on top
  // of a draggable element intercepts the drag gesture before it ever
  // reaches the card underneath (anchors are natively draggable too, so
  // the browser would start dragging the link instead), which made cards
  // stick instead of dragging between columns.
  return (
    <Link
      href={`/projects/${project.id}/tasks/${task.id}`}
      draggable
      onDragStart={(e) => onDragStart(e, task.id)}
      className="card"
      style={{ display: "block", padding: 12, cursor: "grab", color: "var(--text)", textDecoration: "none" }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        {showProjectBadge ? (
          <span className="mono" style={{ fontSize: 10.5, color: "var(--text-faint)" }}>
            {project.code}
          </span>
        ) : (
          <span className="mono" style={{ fontSize: 10.5, color: "var(--text-faint)" }}>
            {task.id.slice(0, 8)}
          </span>
        )}
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

// Board with a project switcher. "All projects" aggregates every project's
// tasks into one kanban view (cards carry a project code badge instead of
// their short id, and creating a task is disabled — creation always needs
// a single project, same reasoning as the Tasks page's create form).
// Picking one project narrows to that project's own board, same behavior
// as the old /projects/{id}/board page this replaces as the sidebar's
// "Board" destination.
export default function BoardPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  // null = still resolving which project (or "All projects") was last
  // selected, from localStorage — kept distinct from ALL_PROJECTS so the
  // load effect below doesn't fire with the wrong scope for a moment
  // before that resolves.
  const [selected, setSelected] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showNewTask, setShowNewTask] = useState(false);
  const [dragTaskId, setDragTaskId] = useState<string | null>(null);

  // Resolve the project list and the persisted selection once on mount
  // (falling back to "All projects" the very first time, or if the
  // stored project no longer exists).
  useEffect(() => {
    projectsApi.list({ page_size: 100 }).then((res) => {
      setProjects(res.items);
      const stored = typeof window !== "undefined" ? window.localStorage.getItem(SELECTED_PROJECT_KEY) : null;
      const valid = stored === ALL_PROJECTS || res.items.some((p) => p.id === stored);
      setSelected(valid && stored ? stored : ALL_PROJECTS);
    });
  }, []);

  function load(scope: string) {
    setLoading(true);
    setError(null);
    const usersPromise = usersApi.list({ page_size: 100 }).then((r) => r.items);

    if (scope === ALL_PROJECTS) {
      Promise.all([projectsApi.list({ page_size: 100 }).then((r) => r.items), usersPromise])
        .then(async ([allProjects, u]) => {
          const perProject = await Promise.all(
            allProjects.map((project) =>
              tasksApi
                .listForProject(project.id, { page_size: 100, sort_by: "-created_at" })
                .then((r) => r.items.map((task) => ({ project, task })))
                .catch(() => [] as Row[])
            )
          );
          setProjects(allProjects);
          setRows(perProject.flat());
          setUsers(u);
        })
        .catch((e) => setError(e instanceof ApiError ? e.message : "Failed to load board."))
        .finally(() => setLoading(false));
      return;
    }

    Promise.all([
      projectsApi.list({ page_size: 100 }).then((r) => r.items.find((p) => p.id === scope) ?? null),
      tasksApi.listForProject(scope, { page_size: 100, sort_by: "-created_at" }).then((r) => r.items),
      usersPromise,
    ])
      .then(([p, tasks, u]) => {
        if (p) setRows(tasks.map((task) => ({ project: p, task })));
        else setRows([]);
        setUsers(u);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Failed to load board."))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (selected === null) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load() sets loading state before its fetch starts
    load(selected);
  }, [selected]);

  const usersById = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);
  const selectedProject = !selected || selected === ALL_PROJECTS ? null : projects.find((p) => p.id === selected) ?? null;

  function selectProject(id: string) {
    setSelected(id);
    setShowNewTask(false);
    if (typeof window !== "undefined") window.localStorage.setItem(SELECTED_PROJECT_KEY, id);
  }

  async function moveTask(taskId: string, status: TaskStatus) {
    const prev = rows;
    setRows((cur) => cur.map((r) => (r.task.id === taskId ? { ...r, task: { ...r.task, status } } : r)));
    try {
      await tasksApi.updateStatus(taskId, status);
    } catch (err) {
      setRows(prev);
      setError(err instanceof ApiError ? err.message : "Couldn't move that task.");
    }
  }

  return (
    <AppShell active="board">
      <PageHeader
        title="Board"
        subtitle="Drag a card between columns to change its status."
        action={
          selectedProject ? (
            <button className="btn btn-primary" onClick={() => setShowNewTask((v) => !v)}>
              <PlusIcon /> New task
            </button>
          ) : undefined
        }
      />

      <div className="card" style={{ padding: 14, marginTop: 24, marginBottom: 16, display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 12.5, color: "var(--text-muted)", flexShrink: 0 }}>Project</span>
        <select className="input" style={{ maxWidth: 320 }} value={selected ?? ALL_PROJECTS} onChange={(e) => selectProject(e.target.value)}>
          <option value={ALL_PROJECTS}>All projects</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.code} — {p.name}
            </option>
          ))}
        </select>
        {selected === ALL_PROJECTS && (
          <span style={{ fontSize: 12, color: "var(--text-faint)" }}>Pick a single project to add a task here.</span>
        )}
      </div>

      {error && (
        <div style={{ marginBottom: 16 }}>
          <ErrorBanner message={error} />
        </div>
      )}

      {showNewTask && selectedProject && (
        <NewTaskForm
          projectId={selectedProject.id}
          users={users}
          onCreated={(t) => {
            setRows((prev) => [{ project: selectedProject, task: t }, ...prev]);
            setShowNewTask(false);
          }}
          onCancel={() => setShowNewTask(false)}
        />
      )}

      {loading ? (
        <CenteredSpinner />
      ) : projects.length === 0 ? (
        <EmptyState title="No projects yet" hint="Create a project to start tracking tasks here." />
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
          {COLUMNS.map((col) => {
            const colRows = rows.filter((r) => r.task.status === col.key);
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
                  <span className="mono" style={{ fontSize: 11.5, color: "var(--text-faint)" }}>
                    {colRows.length}
                  </span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {colRows.map((row) => (
                    <TaskCard
                      key={row.task.id}
                      row={row}
                      showProjectBadge={selected === ALL_PROJECTS}
                      assignee={row.task.assignee_id ? usersById.get(row.task.assignee_id) : undefined}
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
      )}
    </AppShell>
  );
}
