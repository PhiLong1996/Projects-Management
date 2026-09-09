"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { CenteredSpinner, ErrorBanner, PageHeader, StatusBadge } from "@/components/ui";
import { PlusIcon, SearchIcon } from "@/components/icons";
import { projectsApi, sprintsApi } from "@/lib/endpoints";
import type { Project, Sprint, SprintStatus } from "@/lib/types";
import { ApiError } from "@/lib/api";

function fmtDate(d: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

const STATUS_ORDER: Record<SprintStatus, number> = { ACTIVE: 0, PLANNED: 1, CLOSED: 2 };
const STATUS_FILTERS: { key: SprintStatus | "ALL"; label: string }[] = [
  { key: "ALL", label: "All" },
  { key: "ACTIVE", label: "Active" },
  { key: "PLANNED", label: "Planned" },
  { key: "CLOSED", label: "Closed" },
];

interface Row {
  project: Project;
  sprint: Sprint;
}

function SprintFormPanel({
  projects,
  onSaved,
  onCancel,
}: {
  projects: Project[];
  onSaved: (sprint: Sprint, project: Project) => void;
  onCancel: () => void;
}) {
  const [projectId, setProjectId] = useState("");
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const selectedProject = projects.find((p) => p.id === projectId) ?? null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!selectedProject) {
      setError("Choose a project.");
      return;
    }
    if (!startDate || !endDate) {
      setError("Start and end dates are required.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const created = await sprintsApi.create(selectedProject.id, {
        name,
        goal: goal || undefined,
        start_date: new Date(startDate).toISOString(),
        end_date: new Date(endDate).toISOString(),
      });
      onSaved(created, selectedProject);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create sprint.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="card" style={{ padding: 16, marginBottom: 16, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: 13.5, fontWeight: 600 }}>New sprint</div>
      {error && <ErrorBanner message={error} />}

      <div>
        <label className="label">Project</label>
        <select className="input" value={projectId} onChange={(e) => setProjectId(e.target.value)} required>
          <option value="">Select a project…</option>
          {projects
            .filter((p) => p.status !== "CLOSED")
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} — {p.name}
              </option>
            ))}
        </select>
      </div>

      <div>
        <label className="label">Name</label>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
      </div>
      <div>
        <label className="label">Goal</label>
        <input className="input" value={goal} onChange={(e) => setGoal(e.target.value)} />
      </div>

      <div style={{ display: "flex", gap: 10 }}>
        <div style={{ flex: 1 }}>
          <label className="label">Start date</label>
          <input className="input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
        </div>
        <div style={{ flex: 1 }}>
          <label className="label">End date</label>
          <input className="input" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} required />
        </div>
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <button type="submit" className="btn btn-primary" disabled={submitting || !projectId}>
          {submitting ? "Creating…" : "Create sprint"}
        </button>
        <button type="button" className="btn btn-secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export default function SprintsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<SprintStatus | "ALL">("ALL");
  const [showCreate, setShowCreate] = useState(false);
  const [justCreatedId, setJustCreatedId] = useState<string | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resets loading/error state before the fetch starts
    setLoading(true);
    setError(null);
    projectsApi
      .list({ page_size: 100 })
      .then(async (res) => {
        const perProject = await Promise.all(
          res.items.map((project) =>
            sprintsApi
              .list(project.id)
              .then((sprints) => sprints.map((sprint) => ({ project, sprint })))
              .catch(() => [] as Row[])
          )
        );
        setProjects(res.items);
        setRows(perProject.flat());
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Failed to load sprints."))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows
      .filter((r) => statusFilter === "ALL" || r.sprint.status === statusFilter)
      .filter(
        (r) =>
          !q ||
          r.sprint.name.toLowerCase().includes(q) ||
          r.project.name.toLowerCase().includes(q) ||
          r.project.code.toLowerCase().includes(q)
      )
      .sort((a, b) => {
        const byStatus = STATUS_ORDER[a.sprint.status] - STATUS_ORDER[b.sprint.status];
        if (byStatus !== 0) return byStatus;
        return new Date(b.sprint.start_date).getTime() - new Date(a.sprint.start_date).getTime();
      });
  }, [rows, search, statusFilter]);

  function handleSaved(sprint: Sprint, project: Project) {
    setRows((prev) => [{ project, sprint }, ...prev]);
    setShowCreate(false);

    // A new sprint starts out PLANNED — the current status filter or search
    // may hide it from the list that was just updated, which reads as "it
    // didn't get created". Relax only what would actually hide it.
    if (statusFilter !== "ALL" && statusFilter !== sprint.status) setStatusFilter("ALL");
    if (search.trim() && !sprint.name.toLowerCase().includes(search.trim().toLowerCase())) setSearch("");
    setJustCreatedId(sprint.id);
    window.setTimeout(() => setJustCreatedId((id) => (id === sprint.id ? null : id)), 3000);
  }

  return (
    <AppShell active="sprints">
      <PageHeader
        title="Sprints"
        subtitle="Every sprint across your projects — click one to open it."
        action={
          <button type="button" className="btn btn-primary" onClick={() => setShowCreate((v) => !v)}>
            <PlusIcon /> New sprint
          </button>
        }
      />

      {error && (
        <div style={{ marginBottom: 16 }}>
          <ErrorBanner message={error} />
        </div>
      )}

      {showCreate && <SprintFormPanel projects={projects} onSaved={handleSaved} onCancel={() => setShowCreate(false)} />}

      {/* Search/filter toolbar — a distinct bordered panel, set apart from
          the "New sprint" action above (which lives in the page header) so
          the two don't read as one continuous control strip. */}
      <div className="card" style={{ padding: 14, marginTop: showCreate ? 0 : 24, marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
          <div className="input" style={{ display: "flex", alignItems: "center", gap: 8, flex: "1 1 260px" }}>
            <SearchIcon style={{ color: "var(--text-faint)" }} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search sprints or projects…"
              style={{ border: "none", outline: "none", flex: 1, fontSize: 13, background: "transparent" }}
            />
          </div>
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
          No sprints match.
        </div>
      ) : (
        <div className="card">
          {filtered.map(({ project, sprint }) => {
            const isNew = sprint.id === justCreatedId;
            return (
              <Link
                key={sprint.id}
                href={`/projects/${project.id}/sprints/${sprint.id}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                  padding: "12px 16px",
                  borderBottom: "1px solid var(--border)",
                  color: "inherit",
                  textDecoration: "none",
                  background: isNew ? "var(--accent-subtle)" : "transparent",
                  transition: "background 0.6s ease",
                }}
              >
                <span className="mono" style={{ fontSize: 11.5, color: "var(--text-faint)", width: 90, flexShrink: 0 }}>
                  {project.code}
                </span>
                <StatusBadge status={sprint.status} />
                <span style={{ fontSize: 13.5, fontWeight: 500, flex: 1 }}>{sprint.name}</span>
                <span className="mono" style={{ fontSize: 12, color: "var(--text-faint)" }}>
                  {fmtDate(sprint.start_date)} – {fmtDate(sprint.end_date)}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}
