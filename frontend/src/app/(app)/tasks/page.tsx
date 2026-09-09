"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { Avatar, CenteredSpinner, ErrorBanner, PageHeader, PriorityBadge, StatusBadge } from "@/components/ui";
import { EditIcon, PlusIcon, SearchIcon } from "@/components/icons";
import { projectsApi, sprintsApi, tasksApi, usersApi } from "@/lib/endpoints";
import { useAuth } from "@/lib/auth-context";
import type { Project, ProjectMemberWithUser, Sprint, Task, TaskPriority, TaskStatus, TokenUser, User } from "@/lib/types";
import { ApiError } from "@/lib/api";

const STATUS_FILTERS: { key: TaskStatus | "ALL"; label: string }[] = [
  { key: "ALL", label: "All" },
  { key: "TODO", label: "To Do" },
  { key: "IN_PROGRESS", label: "In Progress" },
  { key: "IN_REVIEW", label: "In Review" },
  { key: "DONE", label: "Done" },
  { key: "CANCELLED", label: "Cancelled" },
];

// Same transition table as the per-project task detail page — kept local
// since there's no shared constants module for it yet.
const VALID_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  TODO: ["IN_PROGRESS", "CANCELLED"],
  IN_PROGRESS: ["TODO", "IN_REVIEW", "CANCELLED"],
  IN_REVIEW: ["TODO", "IN_PROGRESS", "DONE", "CANCELLED"],
  DONE: ["TODO", "IN_PROGRESS"],
  CANCELLED: ["TODO"],
};

function isOverdue(task: Task): boolean {
  return !!task.due_date && task.status !== "DONE" && task.status !== "CANCELLED" && new Date(task.due_date).getTime() < Date.now();
}

interface Row {
  project: Project;
  task: Task;
}

function TaskFormPanel({
  mode,
  projects,
  task,
  project: fixedProject,
  currentUser,
  onSaved,
  onCancel,
}: {
  mode: "create" | "edit";
  projects: Project[];
  task?: Task;
  project?: Project;
  currentUser: TokenUser | null;
  onSaved: (task: Task, project: Project) => void;
  onCancel: () => void;
}) {
  const [projectId, setProjectId] = useState(fixedProject?.id ?? "");
  const [title, setTitle] = useState(task?.title ?? "");
  const [description, setDescription] = useState(task?.description ?? "");
  const [priority, setPriority] = useState<TaskPriority>(task?.priority ?? "MEDIUM");
  const [status, setStatus] = useState<TaskStatus>(task?.status ?? "TODO");
  const [assigneeId, setAssigneeId] = useState(task?.assignee_id ?? "");
  const [sprintId, setSprintId] = useState(task?.sprint_id ?? "");
  const [dueDate, setDueDate] = useState(task?.due_date ? task.due_date.slice(0, 10) : "");
  const [estimatedHours, setEstimatedHours] = useState(task?.estimated_hours != null ? String(task.estimated_hours) : "");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [members, setMembers] = useState<ProjectMemberWithUser[]>([]);
  const [membersError, setMembersError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clears scoped options when no project is selected
      setSprints([]);
      setMembers([]);
      setMembersError(null);
      return;
    }
    setMembersError(null);
    Promise.all([
      sprintsApi.list(projectId).catch(() => [] as Sprint[]),
      projectsApi.listMembers(projectId).catch((e) => {
        setMembersError(e instanceof ApiError ? e.message : "Couldn't load project members.");
        return [] as ProjectMemberWithUser[];
      }),
    ]).then(([sp, mem]) => {
      setSprints(sp);
      setMembers(mem);
    });
  }, [projectId]);

  const selectedProject = fixedProject ?? projects.find((p) => p.id === projectId) ?? null;

  const isPrivileged = currentUser?.system_role === "ADMIN" || currentUser?.system_role === "PROJECT_MANAGER";
  const isAssignee = !!(mode === "edit" && task && currentUser && task.assignee_id === currentUser.id);
  const canEditAllFields = mode === "create" || isPrivileged;
  const canEditStatus = mode === "edit" && (isPrivileged || isAssignee);
  const canEditDescriptionOnly = mode === "edit" && !isPrivileged && isAssignee;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!selectedProject) {
      setError("Choose a project.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      if (mode === "create") {
        const created = await tasksApi.create(selectedProject.id, {
          title,
          description: description || undefined,
          priority,
          sprint_id: sprintId || undefined,
          assignee_id: assigneeId || undefined,
          due_date: dueDate ? new Date(dueDate).toISOString() : undefined,
          estimated_hours: estimatedHours ? parseFloat(estimatedHours) : undefined,
        });
        onSaved(created, selectedProject);
        return;
      }

      if (!task) return;
      const payload: Partial<Task> = {};
      if (canEditAllFields) {
        payload.title = title;
        payload.description = description || null;
        payload.priority = priority;
        payload.sprint_id = sprintId || null;
        payload.assignee_id = assigneeId || null;
        payload.due_date = dueDate ? new Date(dueDate).toISOString() : null;
        payload.estimated_hours = estimatedHours ? parseFloat(estimatedHours) : null;
      } else if (canEditDescriptionOnly) {
        payload.description = description || null;
      }
      // The backend rejects a status field that equals the task's current
      // status (it only recognizes actual transitions), so only send it
      // when it actually changed.
      if (canEditStatus && status !== task.status) {
        payload.status = status;
      }
      if (Object.keys(payload).length === 0) {
        onCancel();
        return;
      }
      const updated = await tasksApi.update(task.id, payload);
      onSaved(updated, selectedProject);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save task.");
    } finally {
      setSubmitting(false);
    }
  }

  const fieldsLocked = mode === "edit" && !canEditAllFields && !canEditDescriptionOnly;

  return (
    <form onSubmit={submit} className="card" style={{ padding: 16, marginBottom: 16, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: 13.5, fontWeight: 600 }}>{mode === "create" ? "New task" : `Edit task${task ? `: ${task.title}` : ""}`}</div>
      {error && <ErrorBanner message={error} />}
      {fieldsLocked && (
        <ErrorBanner message="You can only change the status of tasks assigned to you." />
      )}

      <div style={{ display: "flex", gap: 10 }}>
        <div style={{ flex: 1 }}>
          <label className="label">Project</label>
          {mode === "create" ? (
            <select
              className="input"
              value={projectId}
              onChange={(e) => {
                setProjectId(e.target.value);
                setSprintId("");
                setAssigneeId("");
              }}
              required
            >
              <option value="">Select a project…</option>
              {projects
                .filter((p) => p.status !== "CLOSED")
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.code} — {p.name}
                  </option>
                ))}
            </select>
          ) : (
            <div className="input" style={{ display: "flex", alignItems: "center", color: "var(--text-muted)", background: "var(--bg-subtle)" }}>
              {fixedProject ? `${fixedProject.code} — ${fixedProject.name}` : "—"}
            </div>
          )}
        </div>
        <div style={{ flex: 1 }}>
          <label className="label">Sprint</label>
          <select
            className="input"
            value={sprintId}
            disabled={!selectedProject || !canEditAllFields}
            onChange={(e) => setSprintId(e.target.value)}
          >
            <option value="">Backlog</option>
            {sprints.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      {mode === "edit" && (
        <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: -4 }}>
          A task can&apos;t be moved to a different project once created — only its sprint can change.
        </div>
      )}

      <div>
        <label className="label">Title</label>
        <input
          className="input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={!canEditAllFields}
          required
          autoFocus={mode === "create"}
        />
      </div>
      <div>
        <label className="label">Description</label>
        <input
          className="input"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={!canEditAllFields && !canEditDescriptionOnly}
        />
      </div>

      <div style={{ display: "flex", gap: 10 }}>
        <div style={{ flex: 1 }}>
          <label className="label">Priority</label>
          {canEditAllFields ? (
            <select className="input" value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)}>
              <option value="LOW">Low</option>
              <option value="MEDIUM">Medium</option>
              <option value="HIGH">High</option>
              <option value="CRITICAL">Critical</option>
            </select>
          ) : (
            <div style={{ padding: "6px 0" }}>
              <PriorityBadge priority={priority} />
            </div>
          )}
        </div>
        <div style={{ flex: 1 }}>
          <label className="label">Assignee</label>
          <select
            className="input"
            value={assigneeId}
            disabled={!selectedProject || !canEditAllFields}
            onChange={(e) => setAssigneeId(e.target.value)}
          >
            <option value="">Unassigned</option>
            {members.map((m) => (
              <option key={m.user_id} value={m.user_id}>
                {m.user.full_name}
              </option>
            ))}
          </select>
        </div>
        <div style={{ flex: 1 }}>
          <label className="label">Due date</label>
          <input
            className="input"
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            disabled={!canEditAllFields}
          />
        </div>
      </div>

      {membersError && selectedProject && <ErrorBanner message={membersError} />}

      <div style={{ display: "flex", gap: 10 }}>
        <div style={{ flex: 1 }}>
          <label className="label">Estimated hours</label>
          <input
            className="input"
            type="number"
            min="0"
            step="0.5"
            value={estimatedHours}
            onChange={(e) => setEstimatedHours(e.target.value)}
            disabled={!canEditAllFields}
          />
        </div>
        {mode === "edit" && task && (
          <div style={{ flex: 1 }}>
            <label className="label">Status</label>
            {canEditStatus ? (
              <select className="input" value={status} onChange={(e) => setStatus(e.target.value as TaskStatus)}>
                <option value={task.status}>{task.status.replace(/_/g, " ")}</option>
                {VALID_TRANSITIONS[task.status].map((s) => (
                  <option key={s} value={s}>
                    {s.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            ) : (
              <div style={{ padding: "6px 0" }}>
                <StatusBadge status={task.status} />
              </div>
            )}
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <button type="submit" className="btn btn-primary" disabled={submitting || (mode === "create" && !projectId)}>
          {submitting ? "Saving…" : mode === "create" ? "Create task" : "Save changes"}
        </button>
        <button type="button" className="btn btn-secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export default function TasksPage() {
  const { user } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<TaskStatus | "ALL">("ALL");
  const [projectFilter, setProjectFilter] = useState<string>("ALL");
  const [onlyMine, setOnlyMine] = useState(true);
  const [formMode, setFormMode] = useState<"closed" | "create" | "edit">("closed");
  const [editingRow, setEditingRow] = useState<Row | null>(null);
  const [justCreatedId, setJustCreatedId] = useState<string | null>(null);

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
        setProjects(res.items);
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
      .filter((r) => projectFilter === "ALL" || r.project.id === projectFilter)
      .filter((r) => !onlyMine || r.task.assignee_id === user?.id)
      .filter(
        (r) =>
          !q ||
          r.task.title.toLowerCase().includes(q) ||
          (r.task.description ?? "").toLowerCase().includes(q) ||
          r.project.name.toLowerCase().includes(q) ||
          r.project.code.toLowerCase().includes(q)
      )
      .sort((a, b) => {
        if (!a.task.due_date && !b.task.due_date) return 0;
        if (!a.task.due_date) return 1;
        if (!b.task.due_date) return -1;
        return new Date(a.task.due_date).getTime() - new Date(b.task.due_date).getTime();
      });
  }, [rows, search, statusFilter, projectFilter, onlyMine, user?.id]);

  function openCreate() {
    setEditingRow(null);
    setFormMode((m) => (m === "create" ? "closed" : "create"));
  }

  function openEdit(row: Row) {
    setEditingRow(row);
    setFormMode("edit");
  }

  function closeForm() {
    setFormMode("closed");
    setEditingRow(null);
  }

  function handleSaved(task: Task, project: Project) {
    const wasCreate = formMode === "create";
    setRows((prev) => {
      const exists = prev.some((r) => r.task.id === task.id);
      if (exists) return prev.map((r) => (r.task.id === task.id ? { project, task } : r));
      return [{ project, task }, ...prev];
    });
    closeForm();

    if (wasCreate) {
      // A new task is created with whatever status/project/assignee was
      // picked in the form — the current filters may well hide it (most
      // commonly "My tasks" when it wasn't assigned to the creator), which
      // reads as "it didn't get created". Relax only the filters that
      // would actually hide it, so it's guaranteed visible right away.
      if (statusFilter !== "ALL" && statusFilter !== task.status) setStatusFilter("ALL");
      if (projectFilter !== "ALL" && projectFilter !== project.id) setProjectFilter("ALL");
      if (onlyMine && task.assignee_id !== user?.id) setOnlyMine(false);
      if (search.trim() && !task.title.toLowerCase().includes(search.trim().toLowerCase())) setSearch("");
      setJustCreatedId(task.id);
      window.setTimeout(() => setJustCreatedId((id) => (id === task.id ? null : id)), 3000);
    }
  }

  return (
    <AppShell active="tasks">
      <PageHeader
        title="Tasks"
        subtitle="Every task across your projects — click one to open it."
        action={
          <button type="button" className="btn btn-primary" onClick={openCreate}>
            <PlusIcon /> New task
          </button>
        }
      />

      {error && (
        <div style={{ marginBottom: 16 }}>
          <ErrorBanner message={error} />
        </div>
      )}

      {formMode !== "closed" && (
        <TaskFormPanel
          mode={formMode}
          projects={projects}
          task={editingRow?.task}
          project={editingRow?.project}
          currentUser={user}
          onSaved={handleSaved}
          onCancel={closeForm}
        />
      )}

      {/* Search/filter toolbar — a distinct bordered panel, set apart from
          the "New task" action above (which lives in the page header) so
          the two don't read as one continuous control strip. */}
      <div className="card" style={{ padding: 14, marginTop: formMode === "closed" ? 24 : 0, marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
          <div className="input" style={{ display: "flex", alignItems: "center", gap: 8, flex: "1 1 240px" }}>
            <SearchIcon style={{ color: "var(--text-faint)" }} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search tasks or projects…"
              style={{ border: "none", outline: "none", flex: 1, fontSize: 13, background: "transparent" }}
            />
          </div>
          <select
            className="input"
            style={{ width: 200, flexShrink: 0 }}
            value={projectFilter}
            onChange={(e) => setProjectFilter(e.target.value)}
          >
            <option value="ALL">All projects</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} — {p.name}
              </option>
            ))}
          </select>
          <button type="button" className={onlyMine ? "btn btn-primary" : "btn btn-secondary"} onClick={() => setOnlyMine((v) => !v)}>
            {onlyMine ? "My tasks" : "All tasks"}
          </button>
        </div>

        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
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
            const isNew = task.id === justCreatedId;
            return (
              <div key={task.id} style={{ position: "relative" }}>
                <Link href={`/projects/${project.id}/tasks/${task.id}`} style={{ position: "absolute", inset: 0 }} aria-label={task.title} />
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "12px 16px",
                    borderBottom: "1px solid var(--border)",
                    background: isNew ? "var(--accent-subtle)" : "transparent",
                    transition: "background 0.6s ease",
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
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      openEdit({ project, task });
                    }}
                    title="Edit task"
                    style={{ position: "relative", zIndex: 1, background: "none", border: "none", cursor: "pointer", color: "var(--text-faint)", padding: 4 }}
                  >
                    <EditIcon />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}
