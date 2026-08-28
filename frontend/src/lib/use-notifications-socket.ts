"use client";

import { useEffect, useRef } from "react";
import { WS_BASE_URL } from "./config";
import { tokenStore } from "./token-store";
import type { Notification } from "./types";

// Mirrors src/modules/notifications/router.py's `/ws` endpoint: connect
// with the current access token as a query param (browsers can't set
// custom headers on a WS handshake), receive one JSON Notification object
// per push, and reconnect with backoff on drop — the token can also expire
// mid-connection since the socket outlives a single 30-min access token,
// so a closed/errored socket just retries rather than treating it as fatal.
export function useNotificationsSocket(onNotification: (n: Notification) => void, enabled: boolean) {
  const callbackRef = useRef(onNotification);
  useEffect(() => {
    callbackRef.current = onNotification;
  });

  useEffect(() => {
    if (!enabled) return;
    let socket: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    let attempt = 0;

    function connect() {
      const token = tokenStore.getAccessToken();
      if (!token || stopped) return;
      socket = new WebSocket(`${WS_BASE_URL}/notifications/ws?token=${encodeURIComponent(token)}`);

      socket.onopen = () => {
        attempt = 0;
      };
      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as Notification;
          callbackRef.current(data);
        } catch {
          // ignore malformed frames
        }
      };
      socket.onclose = () => {
        if (stopped) return;
        attempt += 1;
        const delay = Math.min(1000 * 2 ** attempt, 30000);
        retryTimer = setTimeout(connect, delay);
      };
      socket.onerror = () => {
        socket?.close();
      };
    }

    connect();

    return () => {
      stopped = true;
      if (retryTimer) clearTimeout(retryTimer);
      socket?.close();
    };
  }, [enabled]);
}
