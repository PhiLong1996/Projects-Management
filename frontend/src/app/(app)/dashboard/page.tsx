"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { ProjectSelect } from "@/components/ProjectSelect";
import { CenteredSpinner, EmptyState, ErrorBanner, PageHeader, PriorityBadge } from "@/components/ui";
import { dashboardApi, projectsApi, tasksApi } from "@/lib/endpoints";
import { useSelectedProject } from "@/lib/use-selected-project";
import type { DashboardStats, Project, Task } from "@/lib/types";
import { ApiError } from "@/lib/api";

const STATUS_ORDER: { key: string; label: string; color: string }[] = [
  { key: "TODO", label: "To do", color: "var(--text-faint)" },
  { key: "IN_PROGRESS", label: "In progress", color: "var(--blue)" },
  { key: "IN_REVIEW", label: "In review", color: "var(--violet)" },
  { key: "DONE", label: "Done", color: "var(--green)" },
  { key: "CANCELLED", label: "Cancelled", color: "var(--text-faint)" },
];

const PRIORITY_ORDER: { key: string; label: string; color: string }[] = [
  { key: "LOW", label: "Low", color: "var(--blue)" },
  { key: "MEDIUM", label: "Medium", color: "var(--blue)" },
  { key: "HIGH", label: "High", color: "var(--orange)" },
  { key: "CRITICAL", label: "Critical", color: "var(--red)" },
];

function StatCard({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className="card" style={{ padding: "16px 18px" }}>
      <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 600, color: tone || "var(--text)" }}>{value}</div>
    </div>
  );
}

function timeAgoOrOverdue(dueDate: string): string {
  const diffMs = Date.now() - new Date(dueDate).getTime();
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (days >= 1) return `${days}d overdue`;
  const hours = Math.max(1, Math.floor(diffMs / (1000 * 60 * 60)));
  return `${hours}h overdue`;
}

export default function DashboardPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [overdue, setOverdue] = useState<Task[]>([]);
  const [error, setError] = useState<string | null>(null);
  const { selectedId, select } = useSelectedProject(projects);

  useEffect(() => {
    projectsApi
      .list({ page_size: 100 })
      .then((res) => setProjects(res.items))
      .catch((e) => setError(e instanceof ApiError ? e.message : "Failed to load projects."))
      .finally(() => setLoadingProjects(false));
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resets stale error state before a fresh fetch starts
    setError(null);
    dashboardApi.forProject(selectedId).then(setStats).catch((e) => setError(e instanceof ApiError ? e.message : "Failed to load dashboard."));
    tasksApi
      .listForProject(selectedId, { sort_by: "due_date", page_size: 100 })
      .then((res) => {
        const now = Date.now();
        const activeStatuses = new Set(["TODO", "IN_PROGRESS", "IN_REVIEW"]);
        const overdueTasks = res.items
          .filter((t) => t.due_date && activeStatuses.has(t.status) && new Date(t.due_date).getTime() < now)
          .slice(0, 6);
        setOverdue(overdueTasks);
      })
      .catch(() => {});
  }, [selectedId]);

  if (loadingProjects) {
    return (
      <AppShell active="dashboard">
        <CenteredSpinner />
      </AppShell>
    );
  }

  if (projects.length === 0) {
    return (
      <AppShell active="dashboard">
        <PageHeader title="Dashboard" />
        <EmptyState title="No projects yet" hint="Create a project to see stats here." />
      </AppShell>
    );
  }

  const maxStatusCount = Math.max(1, ...(stats?.tasks_by_status.map((s) => s.count) ?? [0]));
  const maxPriorityCount = Math.max(1, ...(stats?.tasks_by_priority.map((s) => s.count) ?? [0]));
  const countFor = (list: { status?: string; priority?: string; count: number }[] | undefined, key: string) =>
    list?.find((s) => s.status === key || s.priority === key)?.count ?? 0;

  return (
    <AppShell active="dashboard">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <PageHeader title="Dashboard" />
        <ProjectSelect projects={projects} selectedId={selectedId} onChange={select} />
      </div>

      {error && (
        <div style={{ marginBottom: 16 }}>
          <ErrorBanner message={error} />
        </div>
      )}

      {!stats ? (
        <CenteredSpinner />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
            <StatCard label="Total tasks" value={stats.summary.total_tasks} />
            <StatCard label="Completed" value={stats.summary.completed_tasks} tone="var(--green)" />
            <StatCard label="Overdue" value={stats.summary.overdue_tasks} tone="var(--red)" />
            <StatCard label="Completion rate" value={`${Math.round(stats.summary.completion_rate * 100)}%`} tone="var(--accent)" />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 14 }}>
            <div className="card" style={{ padding: 20 }}>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>Tasks by status</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {STATUS_ORDER.map((s) => {
                  const count = countFor(stats.tasks_by_status, s.key);
                  return (
                    <div key={s.key} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ width: 90, fontSize: 12.5, color: "var(--text-muted)" }}>{s.label}</div>
                      <div style={{ flex: 1, height: 10, borderRadius: 999, background: "var(--bg-subtle)", overflow: "hidden" }}>
                        <div style={{ width: `${(count / maxStatusCount) * 100}%`, height: "100%", background: s.color, borderRadius: 999 }} />
                      </div>
                      <div className="mono" style={{ width: 24, textAlign: "right", fontSize: 12.5 }}>{count}</div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="card" style={{ padding: 20 }}>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>Tasks by priority</div>
              <div style={{ display: "flex", alignItems: "flex-end", gap: 14, height: 140 }}>
                {PRIORITY_ORDER.map((p) => {
                  const count = countFor(stats.tasks_by_priority, p.key);
                  const heightPct = Math.max(4, (count / maxPriorityCount) * 100);
                  return (
                    <div key={p.key} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                      <div className="mono" style={{ fontSize: 12 }}>{count}</div>
                      <div style={{ width: "100%", height: 90, display: "flex", alignItems: "flex-end" }}>
                        <div style={{ width: "100%", height: `${heightPct}%`, background: p.color, borderRadius: "6px 6px 0 0" }} />
                      </div>
                      <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{p.label}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="card">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderBottom: "1px solid var(--border)" }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>Overdue tasks</div>
              {selectedId && (
                <Link href={`/projects/${selectedId}/board`} style={{ fontSize: 12.5 }}>
                  View board &rarr;
                </Link>
              )}
            </div>
            {overdue.length === 0 ? (
              <div style={{ padding: 20, fontSize: 13, color: "var(--text-muted)" }}>Nothing overdue. Nice work.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column" }}>
                {overdue.map((t, i) => (
                  <Link
                    key={t.id}
                    href={`/projects/${t.project_id}/tasks/${t.id}`}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 14,
                      padding: "13px 20px",
                      borderBottom: i === overdue.length - 1 ? "none" : "1px solid var(--border)",
                      color: "var(--text)",
                    }}
                  >
                    <span style={{ width: 7, height: 7, borderRadius: 999, background: "var(--red)", flex: "none" }} />
                    <span style={{ fontSize: 13.5, flex: 1 }}>{t.title}</span>
                    <PriorityBadge priority={t.priority} />
                    <span className="mono" style={{ fontSize: 12, color: "var(--red)", width: 80, textAlign: "right" }}>
                      {timeAgoOrOverdue(t.due_date!)}
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </AppShell>
  );
}
