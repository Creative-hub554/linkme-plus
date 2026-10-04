"use client";

import { createContext, useContext, useEffect, useCallback, useRef, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { useAuth } from "@/components/auth-provider";

export interface Notification {
  id: string;
  type: string;
  message: string;
  userId: string;
  sourceUserId?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  read: boolean;
  createdAt: string;
}

interface NotificationContextType {
  notifications: Notification[];
  unreadCount: number;
  isConnected: boolean;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  clearNotification: (id: string) => void;
  addNotification: (notification: Omit<Notification, "id" | "read" | "createdAt">) => void;
}

const NotificationContext = createContext<NotificationContextType | null>(null);

/** The bell renders a window of history, not all of it. */
const MAX_NOTIFICATIONS = 50;

/** Raw `notifications` row as Realtime pushes it, in the table's own snake_case. */
interface RealtimeNotificationRow {
  id?: string | null;
  type?: string | null;
  message?: string | null;
  user_id?: string | null;
  source_user_id?: string | null;
  target_type?: string | null;
  target_id?: string | null;
  read_at?: string | null;
  created_at?: string | null;
}

/**
 * `notifications.created_at` is `timestamp without time zone` holding UTC, and
 * Realtime sends that column as its own text (`2026-09-23 09:20:00.123456`).
 * Parsing that bare string in JavaScript would read it as *local* time, so the
 * UTC marker is put back. The API returns the same instant already marked.
 */
function normaliseTimestamp(value: string | null | undefined): string {
  if (!value) return new Date().toISOString();
  if (/Z$|[+-]\d{2}:?\d{2}$/.test(value)) return value;
  return `${value.replace(" ", "T")}Z`;
}

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  // Rides the app's existing auth subscription rather than opening a second one.
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [notifications, setNotifications] = useState<Notification[]>([]);
  /** The server's total, not the length of the capped list above. */
  const [unreadCount, setUnreadCount] = useState(0);
  const [isConnected, setIsConnected] = useState(false);
  const mountedRef = useRef(true);
  /**
   * Bumped whenever the signed-in user changes, so a response that arrives after
   * a sign-out is discarded instead of painting the previous person's inbox.
   */
  const sessionTokenRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const showBrowserNotification = useCallback((message: string) => {
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification("LinkMe+", { body: message, icon: "/icon.png" });
    }
  }, []);

  const addNotification = useCallback(
    (notification: Omit<Notification, "id" | "read" | "createdAt">) => {
      const local: Notification = {
        ...notification,
        id: `local-${Math.random().toString(36).slice(2, 9)}`,
        read: false,
        createdAt: new Date().toISOString(),
      };
      setNotifications((previous) => [local, ...previous].slice(0, MAX_NOTIFICATIONS));
      setUnreadCount((count) => count + 1);
      showBrowserNotification(notification.message);
    },
    [showBrowserNotification],
  );

  /** Reads the viewer's inbox and the authoritative unread total. */
  const loadNotifications = useCallback(async () => {
    if (!userId) return;
    const token = sessionTokenRef.current;
    try {
      const response = await fetch("/api/notifications", { cache: "no-store" });
      if (!response.ok) return;
      const payload = await response.json();
      if (!mountedRef.current || sessionTokenRef.current !== token) return;
      setNotifications(Array.isArray(payload.notifications) ? payload.notifications : []);
      setUnreadCount(typeof payload.unreadCount === "number" ? payload.unreadCount : 0);
    } catch {
      // A background read is never worth an error banner: the bell keeps what it
      // has, and the next event or reconnect reconciles it.
    }
  }, [userId]);

  // The badge lives in the nav, outside any auth gate, so a sign-out must clear
  // it — otherwise the next person to use the browser sees the last user's count.
  useEffect(() => {
    sessionTokenRef.current += 1;
    setNotifications([]);
    setUnreadCount(0);
    void loadNotifications();
  }, [userId, loadNotifications]);

  // Live notifications. Realtime evaluates this table's row-level security as
  // the signed-in user, so the socket receives only rows addressed to them —
  // the protection is the database policy, not a filter sent by the client.
  useEffect(() => {
    if (!userId) return;

    const supabase = createClient();
    let disposed = false;
    let subscribedOnce = false;

    const channel = supabase
      .channel(`notifications:${userId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications" },
        (payload: { new: RealtimeNotificationRow }) => {
          const row = payload?.new;
          if (!row?.id || !row.message) return;
          setNotifications((previous) => {
            if (previous.some((item) => item.id === row.id)) return previous;
            return [
              {
                id: row.id as string,
                type: row.type ?? "system",
                message: row.message as string,
                userId: row.user_id ?? userId,
                sourceUserId: row.source_user_id ?? null,
                targetType: row.target_type ?? null,
                targetId: row.target_id ?? null,
                read: Boolean(row.read_at),
                createdAt: normaliseTimestamp(row.created_at),
              },
              ...previous,
            ].slice(0, MAX_NOTIFICATIONS);
          });
          // Incremented optimistically; a reconnect re-reads the real total.
          setUnreadCount((count) => count + 1);
          showBrowserNotification(row.message as string);
        },
      )
      .subscribe((status: string) => {
        if (disposed) return;
        setIsConnected(status === "SUBSCRIBED");
        if (status === "SUBSCRIBED") {
          // Realtime never replays what was missed while the socket was down, so
          // a reconnect re-reads the list and the unread total.
          if (subscribedOnce) void loadNotifications();
          subscribedOnce = true;
        }
      });

    return () => {
      disposed = true;
      setIsConnected(false);
      void supabase.removeChannel(channel);
    };
  }, [userId, loadNotifications, showBrowserNotification]);

  const settleUnread = useCallback(
    (payload: unknown) => {
      const next = (payload as { unreadCount?: unknown } | null)?.unreadCount;
      if (typeof next === "number") setUnreadCount(next);
    },
    [],
  );

  const markAsRead = useCallback(
    (id: string) => {
      setNotifications((previous) =>
        previous.map((item) => (item.id === id ? { ...item, read: true } : item)),
      );
      // Optimistic: an already-read notification is a no-op server-side, and the
      // response's recomputed total corrects the count either way.
      setUnreadCount((count) => Math.max(0, count - 1));
      void fetch("/api/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      })
        .then((response) => (response.ok ? response.json() : null))
        .then(settleUnread)
        .catch(() => {});
    },
    [settleUnread],
  );

  const markAllAsRead = useCallback(() => {
    setNotifications((previous) => previous.map((item) => ({ ...item, read: true })));
    setUnreadCount(0);
    void fetch("/api/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ all: true }),
    })
      .then((response) => (response.ok ? response.json() : null))
      .then(settleUnread)
      .catch(() => {});
  }, [settleUnread]);

  // Dismissal is local only: the row stays in the viewer's inbox history.
  const clearNotification = useCallback((id: string) => {
    setNotifications((previous) => previous.filter((item) => item.id !== id));
  }, []);

  // Request notification permission
  useEffect(() => {
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }, []);

  return (
    <NotificationContext.Provider
      value={{
        notifications,
        unreadCount,
        isConnected,
        markAsRead,
        markAllAsRead,
        clearNotification,
        addNotification,
      }}
    >
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error("useNotifications must be used within NotificationProvider");
  }
  return context;
}
