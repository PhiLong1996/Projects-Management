"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { CenteredSpinner, ErrorBanner, PageHeader, StatusBadge } from "@/components/ui";
import { SearchIcon } from "@/components/icons";
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

export default function SprintsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<SprintStatus | "ALL">("ALL");

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

  return (
    <AppShell active="sprints">
      <PageHeader title="Sprints" subtitle="Every sprint across your projects — click one to open it." />

      {error && (
        <div style={{ marginBottom: 16 }}>
          <ErrorBanner message={error} />
        </div>
      )}

      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 16, flexWrap: "wrap" }}>
        <div className="input" style={{ display: "flex", alignItems: "center", gap: 8, flex: "1 1 260px" }}>
          <SearchIcon style={{ color: "var(--text-faint)" }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search sprints or projects…"
            style={{ border: "none", outline: "none", flex: 1, fontSize: 13, background: "transparent" }}
          />
        </div>
        <div style={{ display: "flex", gap: 6 }}>
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
          {filtered.map(({ project, sprint }) => (
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
          ))}
        </div>
      )}
    </AppShell>
  );
}
