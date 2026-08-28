"use client";

import { use, useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { Avatar, CenteredSpinner, ErrorBanner, PriorityBadge, StatusBadge } from "@/components/ui";
import { commentsApi, projectsApi, sprintsApi, tasksApi, usersApi } from "@/lib/endpoints";
import { useAuth } from "@/lib/auth-context";
import type { Attachment, AuditLog, Comment, Project, Sprint, Task, TaskPriority, TaskStatus, User } from "@/lib/types";
import { ApiError } from "@/lib/api";

const VALID_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  TODO: ["IN_PROGRESS", "CANCELLED"],
  IN_PROGRESS: ["TODO", "IN_REVIEW", "CANCELLED"],
  IN_REVIEW: ["TODO", "IN_PROGRESS", "DONE", "CANCELLED"],
  DONE: ["TODO", "IN_PROGRESS"],
  CANCELLED: ["TODO"],
};

function fmtDateTime(d: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid var(--border)" }}>
      <span style={{ fontSize: 12.5, color: "var(--text-muted)" }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 500 }}>{children}</span>
    </div>
  );
}

export default function TaskDetailPage({ params }: { params: Promise<{ projectId: string; taskId: string }> }) {
  const { projectId, taskId } = use(params);
  const { user } = useAuth();
  const [task, setTask] = useState<Task | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newComment, setNewComment] = useState("");
  const [postingComment, setPostingComment] = useState(false);
  const [savingField, setSavingField] = useState(false);

  // There's no GET /tasks/{id} endpoint on the backend — the task itself is
  // sourced from the project's task list (the same data the board page
  // already fetches), then kept in sync locally after edits.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resets loading/error state before the fetch starts
    setLoading(true);
    setError(null);
    Promise.all([
      tasksApi.listForProject(projectId, { page_size: 100 }).then((r) => r.items.find((t) => t.id === taskId) ?? null),
      projectsApi.list({ page_size: 100 }).then((r) => r.items.find((p) => p.id === projectId) ?? null),
      sprintsApi.list(projectId).catch(() => []),
      usersApi.list({ page_size: 100 }).then((r) => r.items),
      commentsApi.list(taskId).catch(() => []),
      commentsApi.listAttachments(taskId).catch(() => []),
      tasksApi.auditLogs(taskId).catch(() => []),
    ])
      .then(([t, p, sp, u, c, a, logs]) => {
        setTask(t);
        setProject(p);
        setSprints(sp);
        setUsers(u);
        setComments(c);
        setAttachments(a);
        setAuditLogs(logs);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Failed to load task."))
      .finally(() => setLoading(false));
  }, [projectId, taskId]);

  const usersById = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);

  async function changeStatus(status: TaskStatus) {
    if (!task) return;
    setSavingField(true);
    setError(null);
    try {
      await tasksApi.updateStatus(task.id, status);
      setTask({ ...task, status });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't update status.");
    } finally {
      setSavingField(false);
    }
  }

  async function patchTask(payload: Partial<Task>) {
    if (!task) return;
    setSavingField(true);
    setError(null);
    try {
      const updated = await tasksApi.update(task.id, payload);
      setTask(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save that change.");
    } finally {
      setSavingField(false);
    }
  }

  async function submitComment(e: FormEvent) {
    e.preventDefault();
    if (!newComment.trim()) return;
    setPostingComment(true);
    try {
      const comment = await commentsApi.create(taskId, newComment.trim());
      setComments((prev) => [...prev, comment]);
      setNewComment("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't post comment.");
    } finally {
      setPostingComment(false);
    }
  }

  async function handleUpload(file: File) {
    setError(null);
    try {
      const attachment = await commentsApi.upload(taskId, file);
      setAttachments((prev) => [...prev, attachment]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Upload failed.");
    }
  }

  const isPrivileged = user?.system_role === "ADMIN" || user?.system_role === "PROJECT_MANAGER";
  const isAssignee = task && user && task.assignee_id === user.id;
  const canEditAllFields = isPrivileged;
  const canEditStatus = isPrivileged || isAssignee;

  if (loading || !task) {
    return (
      <AppShell active="board">
        {loading ? <CenteredSpinner /> : <ErrorBanner message="Task not found." />}
      </AppShell>
    );
  }

  return (
    <AppShell active="board">
      <div style={{ fontSize: 12.5, color: "var(--text-faint)", marginBottom: 10 }}>
        <Link href={`/projects/${projectId}/board`}>{project ? `${project.code} board` : "Board"}</Link>
        <span style={{ margin: "0 6px" }}>/</span>
        <span className="mono">{task.id.slice(0, 8)}</span>
      </div>

      {error && (
        <div style={{ marginBottom: 16 }}>
          <ErrorBanner message={error} />
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: 24, alignItems: "flex-start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>{task.title}</div>
            <div style={{ fontSize: 13.5, color: "var(--text-muted)", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
              {task.description || "No description."}
            </div>
          </div>

          <div>
            <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 10 }}>
              Attachments <span style={{ color: "var(--text-faint)", fontWeight: 400 }}>({attachments.length})</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
              {attachments.map((a) => (
                <div key={a.id} className="card" style={{ padding: "8px 12px", fontSize: 12.5, display: "flex", justifyContent: "space-between" }}>
                  <span>{a.original_name}</span>
                  <span className="mono" style={{ color: "var(--text-faint)" }}>{Math.round(a.size_bytes / 1024)} KB</span>
                </div>
              ))}
            </div>
            <input
              type="file"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleUpload(file);
                e.target.value = "";
              }}
              style={{ fontSize: 12.5 }}
            />
          </div>

          <div>
            <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 10 }}>
              Comments <span style={{ color: "var(--text-faint)", fontWeight: 400 }}>({comments.length})</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 12 }}>
              {comments.map((c) => {
                const author = usersById.get(c.author_id);
                return (
                  <div key={c.id} style={{ display: "flex", gap: 10 }}>
                    <Avatar name={author?.full_name || "?"} size={26} />
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                        <span style={{ fontSize: 12.5, fontWeight: 600 }}>{author?.full_name || "Unknown"}</span>
                        <span style={{ fontSize: 11, color: "var(--text-faint)" }}>{fmtDateTime(c.created_at)}</span>
                      </div>
                      <div style={{ fontSize: 13, marginTop: 2 }}>{c.content}</div>
                    </div>
                  </div>
                );
              })}
            </div>
            <form onSubmit={submitComment} style={{ display: "flex", gap: 8 }}>
              <input
                className="input"
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                placeholder="Add a comment…"
              />
              <button type="submit" className="btn btn-primary" disabled={postingComment}>
                Post
              </button>
            </form>
          </div>
        </div>

        <div>
          <div className="card" style={{ padding: 16, marginBottom: 16 }}>
            <div style={{ marginBottom: 4 }}>
              <span className="label">Status</span>
              {canEditStatus ? (
                <select
                  className="input"
                  value={task.status}
                  disabled={savingField}
                  onChange={(e) => changeStatus(e.target.value as TaskStatus)}
                >
                  <option value={task.status}>{task.status.replace(/_/g, " ")}</option>
                  {VALID_TRANSITIONS[task.status].map((s) => (
                    <option key={s} value={s}>
                      {s.replace(/_/g, " ")}
                    </option>
                  ))}
                </select>
              ) : (
                <StatusBadge status={task.status} />
              )}
            </div>
          </div>

          <div className="card" style={{ padding: "4px 16px" }}>
            <FieldRow label="Assignee">
              {canEditAllFields ? (
                <select
                  className="input"
                  style={{ height: 28, fontSize: 12.5 }}
                  value={task.assignee_id ?? ""}
                  onChange={(e) => patchTask({ assignee_id: e.target.value || null } as Partial<Task>)}
                >
                  <option value="">Unassigned</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.full_name}
                    </option>
                  ))}
                </select>
              ) : task.assignee_id ? (
                usersById.get(task.assignee_id)?.full_name || "—"
              ) : (
                "Unassigned"
              )}
            </FieldRow>
            <FieldRow label="Reporter">{usersById.get(task.reporter_id)?.full_name || "—"}</FieldRow>
            <FieldRow label="Priority">
              {canEditAllFields ? (
                <select
                  className="input"
                  style={{ height: 28, fontSize: 12.5 }}
                  value={task.priority}
                  onChange={(e) => patchTask({ priority: e.target.value as TaskPriority })}
                >
                  <option value="LOW">Low</option>
                  <option value="MEDIUM">Medium</option>
                  <option value="HIGH">High</option>
                  <option value="CRITICAL">Critical</option>
                </select>
              ) : (
                <PriorityBadge priority={task.priority} />
              )}
            </FieldRow>
            <FieldRow label="Sprint">
              {canEditAllFields ? (
                <select
                  className="input"
                  style={{ height: 28, fontSize: 12.5 }}
                  value={task.sprint_id ?? ""}
                  onChange={(e) => patchTask({ sprint_id: e.target.value || null } as Partial<Task>)}
                >
                  <option value="">Backlog</option>
                  {sprints.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              ) : (
                sprints.find((s) => s.id === task.sprint_id)?.name || "Backlog"
              )}
            </FieldRow>
            <FieldRow label="Due date">{task.due_date ? fmtDateTime(task.due_date) : "—"}</FieldRow>
            <FieldRow label="Estimate">{task.estimated_hours != null ? `${task.estimated_hours}h` : "—"}</FieldRow>
            <FieldRow label="Logged">
              {(isPrivileged || isAssignee) ? (
                <input
                  className="input mono"
                  style={{ height: 28, width: 70, fontSize: 12.5, textAlign: "right" }}
                  type="number"
                  step="0.5"
                  defaultValue={task.actual_hours ?? ""}
                  onBlur={(e) => {
                    const v = e.target.value;
                    if (v !== "") patchTask({ actual_hours: parseFloat(v) });
                  }}
                />
              ) : task.actual_hours != null ? (
                `${task.actual_hours}h`
              ) : (
                "—"
              )}
            </FieldRow>
          </div>

          <div className="card" style={{ padding: 16, marginTop: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Activity</div>
            {auditLogs.length === 0 ? (
              <div style={{ fontSize: 12, color: "var(--text-faint)" }}>No changes recorded yet.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {auditLogs.map((log) => (
                  <div key={log.id} style={{ fontSize: 12 }}>
                    <div style={{ color: "var(--text)" }}>
                      <strong>{usersById.get(log.actor_id)?.full_name || "Someone"}</strong> changed{" "}
                      <span className="mono">{log.field_changed}</span>
                    </div>
                    <div style={{ color: "var(--text-faint)" }}>
                      {log.old_value ?? "—"} &rarr; {log.new_value ?? "—"} · {fmtDateTime(log.created_at)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
