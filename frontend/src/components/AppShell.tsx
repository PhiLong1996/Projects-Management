"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { useAuth } from "@/lib/auth-context";
import { notificationsApi } from "@/lib/endpoints";
import { useNotificationsSocket } from "@/lib/use-notifications-socket";
import { Avatar } from "./ui";
import { AdminIcon, BellIcon, BoardIcon, DashboardIcon, LogoMark, ProjectsIcon, SprintIcon, TaskIcon, UserIcon } from "./icons";

type NavKey = "dashboard" | "board" | "projects" | "sprints" | "tasks" | "notifications" | "admin" | "profile";

function NavItem({ href, icon, label, active, badge }: { href: string; icon: ReactNode; label: string; active: boolean; badge?: number }) {
  return (
    <Link
      href={href}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
        padding: "8px 10px",
        borderRadius: 7,
        fontSize: 13.5,
        fontWeight: active ? 600 : 500,
        background: active ? "var(--accent-subtle)" : "transparent",
        color: active ? "var(--accent-subtle-text)" : "var(--text-muted)",
      }}
    >
      <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {icon}
        {label}
      </span>
      {!!badge && (
        <span
          style={{
            minWidth: 17,
            height: 17,
            padding: "0 4px",
            borderRadius: 999,
            background: "var(--red)",
            color: "white",
            fontSize: 10.5,
            fontWeight: 700,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {badge > 9 ? "9+" : badge}
        </span>
      )}
    </Link>
  );
}

export function AppShell({ active, children }: { active: NavKey; children: ReactNode }) {
  const { user, logout } = useAuth();
  const [unread, setUnread] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    notificationsApi
      .list({ is_read: false, page_size: 1 })
      .then((res) => {
        if (!cancelled) setUnread(res.total_items);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useNotificationsSocket(() => setUnread((n) => n + 1), !!user);

  const isAdmin = user?.system_role === "ADMIN";

  return (
    <div style={{ display: "flex", width: "100%", minHeight: "100vh", background: "var(--bg)" }}>
      <div
        style={{
          flex: "0 0 240px",
          background: "var(--bg-subtle)",
          borderRight: "1px solid var(--border)",
          display: "flex",
          flexDirection: "column",
          padding: "20px 14px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "4px 8px 20px 8px" }}>
          <LogoMark />
          <span style={{ fontSize: 15, fontWeight: 600 }}>Taskflow</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <NavItem href="/dashboard" icon={<DashboardIcon />} label="Dashboard" active={active === "dashboard"} />
          <NavItem href="/board" icon={<BoardIcon />} label="Board" active={active === "board"} />
          <NavItem href="/projects" icon={<ProjectsIcon />} label="Projects" active={active === "projects"} />
          <NavItem href="/sprints" icon={<SprintIcon />} label="Sprints" active={active === "sprints"} />
          <NavItem href="/tasks" icon={<TaskIcon />} label="Tasks" active={active === "tasks"} />
          <NavItem
            href="/notifications"
            icon={<BellIcon />}
            label="Notifications"
            active={active === "notifications"}
            badge={unread}
          />
          {isAdmin && (
            <NavItem href="/admin/users" icon={<AdminIcon />} label="Admin" active={active === "admin"} />
          )}
        </div>

        <div style={{ marginTop: "auto", position: "relative" }}>
          <div
            onClick={() => setMenuOpen((v) => !v)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 10px",
              borderRadius: 8,
              border: "1px solid var(--border)",
              background: "var(--surface)",
              cursor: "pointer",
            }}
          >
            <Avatar name={user?.full_name || "?"} size={26} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {user?.full_name}
              </div>
              <div style={{ fontSize: 11, color: "var(--text-faint)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {user?.email}
              </div>
            </div>
          </div>
          {menuOpen && (
            <div
              className="card"
              style={{ position: "absolute", bottom: "calc(100% + 6px)", left: 0, right: 0, padding: 6, zIndex: 10 }}
            >
              <Link
                href="/profile"
                onClick={() => setMenuOpen(false)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 10px",
                  borderRadius: 6,
                  fontSize: 13,
                  color: active === "profile" ? "var(--accent-subtle-text)" : "var(--text)",
                  background: active === "profile" ? "var(--accent-subtle)" : "transparent",
                }}
              >
                <UserIcon />
                Profile
              </Link>
              <button
                onClick={logout}
                style={{
                  width: "100%",
                  textAlign: "left",
                  padding: "8px 10px",
                  borderRadius: 6,
                  fontSize: 13,
                  border: "none",
                  background: "transparent",
                  cursor: "pointer",
                  color: "var(--text)",
                }}
              >
                Log out
              </button>
            </div>
          )}
        </div>
      </div>

      <div style={{ flex: 1, minWidth: 0, padding: "26px 32px" }}>{children}</div>
    </div>
  );
}
