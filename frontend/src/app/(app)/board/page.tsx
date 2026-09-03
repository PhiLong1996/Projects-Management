"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { CenteredSpinner, PageHeader } from "@/components/ui";
import { PlusIcon } from "@/components/icons";
import { projectsApi } from "@/lib/endpoints";
import type { TaskStatus } from "@/lib/types";
import { ApiError } from "@/lib/api";

const SELECTED_PROJECT_KEY = "taskflow.selected_project_id";

// Mirrors the columns in the real board at
// src/app/(app)/projects/[projectId]/board/page.tsx — duplicated rather
// than imported since that page doesn't export them, and this page only
// ever renders them empty, so there's little to keep in sync.
const COLUMNS: { key: TaskStatus; label: string; color: string }[] = [
  { key: "TODO", label: "To Do", color: "var(--text-faint)" },
  { key: "IN_PROGRESS", label: "In Progress", color: "var(--blue)" },
  { key: "IN_REVIEW", label: "In Review", color: "var(--violet)" },
  { key: "DONE", label: "Done", color: "var(--green)" },
];

// Project-independent entry point for the sidebar's "Board" link. The real
// board lives at /projects/{id}/board, which needs a project id up front —
// not something the sidebar always has. This page picks one (the last
// selected, or the first available) and bounces straight there; if the
// user has no projects at all yet, it shows the same board layout empty
// instead of the link doing nothing.
export default function BoardEntryPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    projectsApi
      .list({ page_size: 100 })
      .then((res) => {
        if (cancelled) return;
        if (res.items.length === 0) {
          setLoading(false);
          return;
        }
        const stored = typeof window !== "undefined" ? window.localStorage.getItem(SELECTED_PROJECT_KEY) : null;
        const target = res.items.find((p) => p.id === stored) ?? res.items[0];
        router.replace(`/projects/${target.id}/board`);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "Failed to load projects.");
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

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
        title="Board"
        subtitle={error ?? "You don't have any projects yet — create one to start tracking tasks here."}
        action={
          <Link href="/projects" className="btn btn-primary">
            <PlusIcon /> New project
          </Link>
        }
      />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
        {COLUMNS.map((col) => (
          <div key={col.key} style={{ display: "flex", flexDirection: "column", gap: 10, minHeight: 200 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ width: 8, height: 8, borderRadius: 999, background: col.color }} />
              <span
                style={{
                  fontSize: 12.5,
                  fontWeight: 600,
                  color: "var(--text-muted)",
                  textTransform: "uppercase",
                  letterSpacing: "0.03em",
                }}
              >
                {col.label}
              </span>
              <span className="mono" style={{ fontSize: 11.5, color: "var(--text-faint)" }}>
                0
              </span>
            </div>
          </div>
        ))}
      </div>
    </AppShell>
  );
}
