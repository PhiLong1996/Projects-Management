import type { Project } from "@/lib/types";
import { ChevronDownIcon } from "./icons";

export function ProjectSelect({
  projects,
  selectedId,
  onChange,
}: {
  projects: Project[];
  selectedId: string | null;
  onChange: (id: string) => void;
}) {
  return (
    <div style={{ position: "relative", display: "inline-flex" }}>
      <select
        value={selectedId ?? ""}
        onChange={(e) => onChange(e.target.value)}
        style={{
          appearance: "none",
          height: 34,
          padding: "0 30px 0 12px",
          borderRadius: 8,
          border: "1px solid var(--border)",
          background: "var(--surface)",
          fontSize: 13,
          fontWeight: 500,
          color: "var(--text)",
          cursor: "pointer",
        }}
      >
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.code} — {p.name}
          </option>
        ))}
      </select>
      <ChevronDownIcon style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", pointerEvents: "none", color: "var(--text-faint)" }} />
    </div>
  );
}
