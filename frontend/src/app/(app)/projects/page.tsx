"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { CenteredSpinner, ErrorBanner, PageHeader, StatusBadge } from "@/components/ui";
import { PlusIcon, SearchIcon } from "@/components/icons";
import { projectsApi, sprintsApi, usersApi } from "@/lib/endpoints";
import { useAuth } from "@/lib/auth-context";
import type { Project, ProjectStatus, Sprint, User } from "@/lib/types";
import { ApiError } from "@/lib/api";

// Converts a Project's ISO date string (or null) into the yyyy-mm-dd shape
// an <input type="date"> expects.
function toDateInputValue(d: string | null): string {
  if (!d) return "";
  return d.slice(0, 10);
}

function fmtDate(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function NewProjectForm({ onCreated, onCancel }: { onCreated: (p: Project) => void; onCancel: () => void }) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const project = await projectsApi.create({
        code,
        name,
        description: description || undefined,
        start_date: startDate || undefined,
        end_date: endDate || undefined,
      });
      onCreated(project);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create project.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="card" style={{ padding: 16, marginBottom: 12, display: "flex", flexDirection: "column", gap: 10 }}>
      {error && <ErrorBanner message={error} />}
      <div>
        <label className="label">Code</label>
        <input className="input" value={code} onChange={(e) => setCode(e.target.value)} placeholder="API-V2" required />
      </div>
      <div>
        <label className="label">Name</label>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="API Platform v2" required />
      </div>
      <div>
        <label className="label">Description</label>
        <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" />
      </div>
      <div style={{ display: "flex", gap: 10 }}>
        <div style={{ flex: 1 }}>
          <label className="label">Start date</label>
          <input className="input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </div>
        <div style={{ flex: 1 }}>
          <label className="label">End date</label>
          <input className="input" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} min={startDate || undefined} />
        </div>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button type="submit" className="btn btn-primary" disabled={submitting}>
          {submitting ? "Creating…" : "Create project"}
        </button>
        <button type="button" className="btn btn-secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function EditProjectForm({ project, onSaved, onCancel }: { project: Project; onSaved: (p: Project) => void; onCancel: () => void }) {
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? "");
  const [status, setStatus] = useState<ProjectStatus>(project.status);
  const [startDate, setStartDate] = useState(toDateInputValue(project.start_date));
  const [endDate, setEndDate] = useState(toDateInputValue(project.end_date));
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const updated = await projectsApi.update(project.id, {
        name,
        description: description || undefined,
        status,
        start_date: startDate || undefined,
        end_date: endDate || undefined,
      });
      onSaved(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to update project.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="card" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 10 }}>
      {error && <ErrorBanner message={error} />}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span className="mono" style={{ fontSize: 12, color: "var(--text-faint)" }}>{project.code}</span>
        <span style={{ fontSize: 12, color: "var(--text-faint)" }}>(code can&apos;t be changed)</span>
      </div>
      <div>
        <label className="label">Name</label>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
      </div>
      <div>
        <label className="label">Description</label>
        <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" />
      </div>
      <div style={{ display: "flex", gap: 10 }}>
        <div style={{ flex: 1 }}>
          <label className="label">Status</label>
          <select className="input" value={status} onChange={(e) => setStatus(e.target.value as ProjectStatus)}>
            <option value="PLANNING">Planning</option>
            <option value="ACTIVE">Active</option>
            <option value="CLOSED">Closed</option>
          </select>
        </div>
        <div style={{ flex: 1 }}>
          <label className="label">Start date</label>
          <input className="input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </div>
        <div style={{ flex: 1 }}>
          <label className="label">End date</label>
          <input className="input" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} min={startDate || undefined} />
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

function SprintRow({ projectId, sprint }: { projectId: string; sprint: Sprint }) {
  return (
    <Link
      href={`/projects/${projectId}/sprints/${sprint.id}`}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "12px 16px",
        borderBottom: "1px solid var(--border)",
        color: "inherit",
        textDecoration: "none",
        cursor: "pointer",
      }}
      className="sprint-row"
    >
      <StatusBadge status={sprint.status} />
      <span style={{ fontSize: 13.5, fontWeight: 500, flex: 1 }}>{sprint.name}</span>
      <span className="mono" style={{ fontSize: 12, color: "var(--text-faint)" }}>
        {fmtDate(sprint.start_date)} – {fmtDate(sprint.end_date)}
      </span>
    </Link>
  );
}

function NewSprintForm({ projectId, onCreated }: { projectId: string; onCreated: (s: Sprint) => void }) {
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const sprint = await sprintsApi.create(projectId, { name, start_date: startDate, end_date: endDate });
      onCreated(sprint);
      setName("");
      setStartDate("");
      setEndDate("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create sprint.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ display: "flex", gap: 8, alignItems: "flex-end", padding: 16, borderTop: "1px solid var(--border)", flexWrap: "wrap" }}>
      {error && (
        <div style={{ width: "100%" }}>
          <ErrorBanner message={error} />
        </div>
      )}
      <div style={{ flex: "1 1 160px" }}>
        <label className="label">Sprint name</label>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Sprint 4" required />
      </div>
      <div>
        <label className="label">Start</label>
        <input className="input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
      </div>
      <div>
        <label className="label">End</label>
        <input className="input" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} required />
      </div>
      <button type="submit" className="btn btn-primary" disabled={submitting}>
        {submitting ? "Adding…" : "Add sprint"}
      </button>
    </form>
  );
}

// Searchable "type to find a person" combobox. Debounces GET /users with
// the typed query (an empty query still fires, so focusing the field shows
// a recommended list of the first alphabetical page rather than nothing).
function MemberPicker({ selected, onSelect }: { selected: User | null; onSelect: (u: User | null) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<User[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (selected) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resets loading state before the debounced fetch starts
    setSearching(true);
    const t = setTimeout(() => {
      usersApi
        .list({ search: query.trim() || undefined, page_size: 20, sort_by: "full_name" })
        .then((res) => {
          setResults(res.items);
          setSearchError(null);
        })
        .catch((err) => {
          setResults([]);
          setSearchError(err instanceof ApiError ? err.message : "Couldn't load users.");
        })
        .finally(() => setSearching(false));
    }, 250);
    return () => clearTimeout(t);
  }, [query, selected]);

  if (selected) {
    return (
      <div className="input" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 13 }}>
          {selected.full_name} <span style={{ color: "var(--text-faint)" }}>({selected.email})</span>
        </span>
        <button
          type="button"
          onClick={() => {
            onSelect(null);
            setQuery("");
          }}
          style={{ border: "none", background: "transparent", cursor: "pointer", color: "var(--accent)", fontSize: 12.5 }}
        >
          Change
        </button>
      </div>
    );
  }

  return (
    <div style={{ position: "relative" }}>
      <input
        className="input"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Search by name or email…"
        autoComplete="off"
      />
      {open && (
        <div
          className="card"
          style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 20, maxHeight: 240, overflowY: "auto", padding: 4 }}
        >
          {searching ? (
            <div style={{ padding: 10, fontSize: 12.5, color: "var(--text-muted)" }}>Searching…</div>
          ) : searchError ? (
            <div style={{ padding: 10, fontSize: 12.5, color: "var(--red)" }}>{searchError}</div>
          ) : results.length === 0 ? (
            <div style={{ padding: 10, fontSize: 12.5, color: "var(--text-muted)" }}>
              {query ? "No matching people." : "No users found."}
            </div>
          ) : (
            <>
              {!query && (
                <div style={{ padding: "4px 10px", fontSize: 11, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.03em" }}>
                  Suggested
                </div>
              )}
              {results.map((u) => (
                <div
                  key={u.id}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onSelect(u);
                    setOpen(false);
                  }}
                  style={{ padding: "8px 10px", borderRadius: 6, cursor: "pointer" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-subtle)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{u.full_name}</div>
                  <div style={{ fontSize: 11.5, color: "var(--text-faint)" }}>{u.email}</div>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function AddMemberForm({ projectId }: { projectId: string }) {
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [role, setRole] = useState<"MEMBER" | "MANAGER">("MEMBER");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!selectedUser) return;
    setError(null);
    setSuccess(null);
    setSubmitting(true);
    try {
      await projectsApi.addMember(projectId, selectedUser.id, role);
      setSuccess(`${selectedUser.full_name} added.`);
      setSelectedUser(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to add member.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
      {error && (
        <div style={{ width: "100%" }}>
          <ErrorBanner message={error} />
        </div>
      )}
      {success && <div style={{ width: "100%", fontSize: 12.5, color: "var(--green)" }}>{success}</div>}
      <div style={{ flex: "1 1 260px" }}>
        <label className="label">Member</label>
        <MemberPicker selected={selectedUser} onSelect={setSelectedUser} />
      </div>
      <div>
        <label className="label">Role</label>
        <select className="input" value={role} onChange={(e) => setRole(e.target.value as "MEMBER" | "MANAGER")}>
          <option value="MEMBER">Member</option>
          <option value="MANAGER">Manager</option>
        </select>
      </div>
      <button type="submit" className="btn btn-primary" disabled={submitting || !selectedUser}>
        {submitting ? "Adding…" : "Add member"}
      </button>
    </form>
  );
}

export default function ProjectsPage() {
  const { user } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showNewProject, setShowNewProject] = useState(false);
  const [editingProject, setEditingProject] = useState(false);
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [sprintsLoading, setSprintsLoading] = useState(false);

  const canCreateProject = user?.system_role === "ADMIN" || user?.system_role === "PROJECT_MANAGER";

  function loadProjects() {
    setLoading(true);
    projectsApi
      .list({ page_size: 100, search: search || undefined })
      .then((res) => {
        setProjects(res.items);
        if (!selectedId && res.items.length > 0) setSelectedId(res.items[0].id);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Failed to load projects."))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loadProjects() sets loading state before its fetch starts
    loadProjects();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const t = setTimeout(loadProjects, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  useEffect(() => {
    if (!selectedId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resets loading state before the fetch starts
    setSprintsLoading(true);
    sprintsApi
      .list(selectedId)
      .then(setSprints)
      .catch(() => setSprints([]))
      .finally(() => setSprintsLoading(false));
  }, [selectedId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- closes any open edit form when the selection changes
    setEditingProject(false);
  }, [selectedId]);

  const selected = projects.find((p) => p.id === selectedId) || null;

  return (
    <AppShell active="projects">
      <PageHeader
        title="Projects"
        action={
          canCreateProject && (
            <button className="btn btn-primary" onClick={() => setShowNewProject((v) => !v)}>
              <PlusIcon /> New project
            </button>
          )
        }
      />

      {error && (
        <div style={{ marginBottom: 16 }}>
          <ErrorBanner message={error} />
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "380px 1fr", gap: 20, alignItems: "flex-start" }}>
        <div>
          {showNewProject && (
            <NewProjectForm
              onCreated={(p) => {
                setProjects((prev) => [p, ...prev]);
                setSelectedId(p.id);
                setShowNewProject(false);
              }}
              onCancel={() => setShowNewProject(false)}
            />
          )}
          <div className="input" style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <SearchIcon style={{ color: "var(--text-faint)" }} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search projects…"
              style={{ border: "none", outline: "none", flex: 1, fontSize: 13, background: "transparent" }}
            />
          </div>
          {loading ? (
            <CenteredSpinner />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {projects.map((p) => (
                <div
                  key={p.id}
                  onClick={() => setSelectedId(p.id)}
                  className="card"
                  style={{
                    padding: 14,
                    cursor: "pointer",
                    borderColor: p.id === selectedId ? "var(--accent)" : "var(--border)",
                    background: p.id === selectedId ? "var(--accent-subtle)" : "var(--surface)",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                    <span className="mono" style={{ fontSize: 11.5, color: "var(--text-faint)" }}>{p.code}</span>
                    <StatusBadge status={p.status} />
                  </div>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>{p.name}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          {!selected ? (
            <div className="card" style={{ padding: 24, color: "var(--text-muted)", fontSize: 13 }}>
              Select a project to see its details.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              {editingProject ? (
                <EditProjectForm
                  project={selected}
                  onSaved={(p) => {
                    setProjects((prev) => prev.map((existing) => (existing.id === p.id ? p : existing)));
                    setEditingProject(false);
                  }}
                  onCancel={() => setEditingProject(false)}
                />
              ) : (
                <div className="card" style={{ padding: 20 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span className="mono" style={{ fontSize: 12, color: "var(--text-faint)" }}>{selected.code}</span>
                      <StatusBadge status={selected.status} />
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button type="button" className="btn btn-secondary" onClick={() => setEditingProject(true)}>
                        Edit
                      </button>
                      <Link href={`/projects/${selected.id}/board`} className="btn btn-secondary">
                        Open board
                      </Link>
                    </div>
                  </div>
                  <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 6 }}>{selected.name}</div>
                  <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 10 }}>
                    {selected.description || "No description."}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-faint)" }}>
                    {fmtDate(selected.start_date)} – {fmtDate(selected.end_date)}
                  </div>
                </div>
              )}

              <div className="card">
                <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--border)", fontSize: 14, fontWeight: 600 }}>
                  Sprints
                </div>
                {sprintsLoading ? (
                  <CenteredSpinner />
                ) : sprints.length === 0 ? (
                  <div style={{ padding: 20, fontSize: 13, color: "var(--text-muted)" }}>No sprints yet.</div>
                ) : (
                  sprints.map((s) => <SprintRow key={s.id} projectId={selected.id} sprint={s} />)
                )}
                <NewSprintForm projectId={selected.id} onCreated={(s) => setSprints((prev) => [...prev, s])} />
              </div>

              <div className="card" style={{ padding: 20 }}>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Add member</div>
                <div style={{ fontSize: 12, color: "var(--text-faint)", marginBottom: 12 }}>
                  The backend doesn&apos;t yet expose a list-members endpoint, so membership can be
                  managed here but not browsed as a roster.
                </div>
                <AddMemberForm projectId={selected.id} />
              </div>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
