"use client";

import { useEffect, useState } from "react";
import type { Project } from "./types";

const KEY = "taskflow.selected_project_id";

// Small convenience shared by every page that needs "which project is the
// user currently looking at" (dashboard, board, projects detail) — since
// the backend has no notion of a "current project", it's purely a client
// preference, remembered across page loads.
export function useSelectedProject(projects: Project[]) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (projects.length === 0) return;
    // Reads localStorage (browser-only) to restore the last-viewed
    // project once the list has loaded — an effect, not a lazy initial
    // state, since `projects` itself only arrives after an async fetch.
    const stored = typeof window !== "undefined" ? window.localStorage.getItem(KEY) : null;
    const valid = stored && projects.some((p) => p.id === stored);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedId(valid ? stored : projects[0].id);
  }, [projects]);

  function select(id: string) {
    setSelectedId(id);
    if (typeof window !== "undefined") window.localStorage.setItem(KEY, id);
  }

  const selected = projects.find((p) => p.id === selectedId) || null;
  return { selectedId, selected, select };
}
