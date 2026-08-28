"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { CenteredSpinner, EmptyState, ErrorBanner, NOTIFICATION_LABEL, PageHeader } from "@/components/ui";
import { CheckIcon } from "@/components/icons";
import { notificationsApi } from "@/lib/endpoints";
import { useNotificationsSocket } from "@/lib/use-notifications-socket";
import { useAuth } from "@/lib/auth-context";
import type { Notification } from "@/lib/types";
import { ApiError } from "@/lib/api";

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 2) return "Yesterday";
  return `${days} days ago`;
}

export default function NotificationsPage() {
  const { user } = useAuth();
  const [items, setItems] = useState<Notification[]>([]);
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function load(f: "all" | "unread") {
    setLoading(true);
    notificationsApi
      .list({ is_read: f === "unread" ? false : undefined, page_size: 50 })
      .then((res) => setItems(res.items))
      .catch((e) => setError(e instanceof ApiError ? e.message : "Failed to load notifications."))
      .finally(() => setLoading(false));
  }

  // eslint-disable-next-line react-hooks/set-state-in-effect -- load() sets loading/error state before its fetch starts
  useEffect(() => load(filter), [filter]);

  useNotificationsSocket((n) => {
    setItems((prev) => (filter === "unread" ? [n, ...prev] : [n, ...prev]));
  }, !!user);

  async function markRead(id: string) {
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)));
    try {
      await notificationsApi.markRead(id);
    } catch {
      // non-fatal — the row will just look read until next refresh
    }
  }

  async function markAllRead() {
    try {
      await notificationsApi.markAllRead();
      setItems((prev) => prev.map((n) => ({ ...n, is_read: true })));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't mark all as read.");
    }
  }

  const unreadCount = items.filter((n) => !n.is_read).length;

  return (
    <AppShell active="notifications">
      <div style={{ maxWidth: 640 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
          <PageHeader title="Notifications" />
          <button onClick={markAllRead} style={{ fontSize: 12.5, background: "none", border: "none", color: "var(--accent)", cursor: "pointer" }}>
            Mark all as read
          </button>
        </div>

        <div style={{ display: "flex", gap: 6, marginBottom: 20 }}>
          <button
            onClick={() => setFilter("all")}
            className="btn"
            style={{
              height: 28,
              padding: "0 12px",
              borderRadius: 999,
              background: filter === "all" ? "var(--text)" : "transparent",
              color: filter === "all" ? "white" : "var(--text-muted)",
              border: filter === "all" ? "none" : "1px solid var(--border-strong)",
              fontSize: 12,
            }}
          >
            All
          </button>
          <button
            onClick={() => setFilter("unread")}
            className="btn"
            style={{
              height: 28,
              padding: "0 12px",
              borderRadius: 999,
              background: "transparent",
              color: "var(--text-muted)",
              border: "1px solid var(--border-strong)",
              fontSize: 12,
            }}
          >
            Unread{unreadCount > 0 ? ` · ${unreadCount}` : ""}
          </button>
        </div>

        {error && (
          <div style={{ marginBottom: 16 }}>
            <ErrorBanner message={error} />
          </div>
        )}

        {loading ? (
          <CenteredSpinner />
        ) : items.length === 0 ? (
          <EmptyState title="You're all caught up" hint="New notifications will show up here in realtime." />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {items.map((n) => (
              <div
                key={n.id}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 14,
                  padding: "14px 12px",
                  borderRadius: 10,
                  background: n.is_read ? "transparent" : "var(--accent-subtle)",
                  color: "var(--text)",
                }}
              >
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13.5, lineHeight: 1.5 }}>
                    <span style={{ fontWeight: 600 }}>{NOTIFICATION_LABEL[n.type]}:</span> {n.message}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-faint)", marginTop: 3 }}>{timeAgo(n.created_at)}</div>
                </div>
                {!n.is_read && (
                  <button
                    onClick={() => markRead(n.id)}
                    title="Mark as read"
                    style={{ background: "none", border: "none", cursor: "pointer", color: "var(--accent)", padding: 4 }}
                  >
                    <CheckIcon width={15} height={15} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
