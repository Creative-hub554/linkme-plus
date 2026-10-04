// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { cleanupSurfaces, mountSurface } from "@/test/render";

/**
 * The notification bell's whole state lives here: an inbox read over the API, a
 * live feed over Supabase Realtime, and the actions that mark things read.
 *
 * Supabase and the session are mocked; `fetch` is stubbed so the inbox read and
 * the read-receipts are observable. The provider's realtime callback is captured
 * through the mock so a test can deliver an INSERT by hand and watch the bell
 * update — the behaviour a socket delivers in production.
 */
const realtime = vi.hoisted(() => ({
  insert: null as ((payload: { new: Record<string, unknown> }) => void) | null,
  removed: 0,
}));

vi.mock("@/utils/supabase/client", () => {
  const channel = {
    on(_event: string, _filter: unknown, handler: (payload: { new: Record<string, unknown> }) => void) {
      realtime.insert = handler;
      return channel;
    },
    subscribe(callback: (status: string) => void) {
      callback("SUBSCRIBED");
      return channel;
    },
  };
  return {
    createClient: () => ({
      channel: () => channel,
      removeChannel: async () => {
        realtime.removed += 1;
      },
    }),
  };
});

const auth = vi.hoisted(() => ({ user: { id: "u1" } as { id: string } | null }));
vi.mock("@/components/auth-provider", () => ({
  useAuth: () => ({ user: auth.user }),
}));

import { NotificationProvider, useNotifications, type Notification } from "./notification-provider";

type Api = ReturnType<typeof useNotifications>;
let api: Api | null = null;

function Reader() {
  api = useNotifications();
  return null;
}

function render() {
  return mountSurface(
    <NotificationProvider>
      <Reader />
    </NotificationProvider>,
    { providers: "none" },
  );
}

function storedNotification(overrides: Partial<Notification> = {}): Notification {
  return {
    id: "n1",
    type: "like",
    message: "someone liked your post",
    userId: "u1",
    read: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function stubNotifications(handler: (url: string, init: RequestInit) => Response) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => handler(String(input), init)),
  );
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function call<T>(fn: (current: Api) => T): Promise<T> {
  let result!: T;
  await act(async () => {
    result = fn(api as Api);
  });
  return result;
}

afterEach(() => {
  cleanupSurfaces();
  vi.unstubAllGlobals();
  realtime.insert = null;
  realtime.removed = 0;
  auth.user = { id: "u1" };
  api = null;
});

describe("NotificationProvider", () => {
  it("loads the inbox and the authoritative unread total on mount", async () => {
    stubNotifications(() => json({ notifications: [storedNotification()], unreadCount: 3 }));

    const ui = render();
    await ui.waitFor(() => api?.notifications.length === 1, { description: "the inbox to load" });

    expect(api?.unreadCount).toBe(3);
    expect(api?.isConnected).toBe(true);
  });

  it("adds a local notification to the top and counts it unread", async () => {
    stubNotifications(() => json({ notifications: [], unreadCount: 0 }));
    const ui = render();
    await ui.waitFor(() => api !== null);
    // Let the mount read settle before adding: its response replaces the list,
    // so a notification added first would be the one it overwrites.
    await ui.settle();

    await call((current) => current.addNotification({ type: "system", message: "hi", userId: "u1" }));

    expect(api?.notifications[0].message).toBe("hi");
    expect(api?.notifications[0].read).toBe(false);
    expect(api?.unreadCount).toBe(1);
  });

  it("clears a notification locally", async () => {
    stubNotifications(() => json({ notifications: [storedNotification()], unreadCount: 1 }));
    const ui = render();
    await ui.waitFor(() => api?.notifications.length === 1);

    await call((current) => current.clearNotification("n1"));
    expect(api?.notifications).toHaveLength(0);
  });

  it("marks one read, decrements optimistically, and posts a receipt", async () => {
    const requests: { method: string; body: unknown }[] = [];
    stubNotifications((_url, init) => {
      requests.push({ method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : undefined });
      return init.method === "POST"
        ? json({ unreadCount: 0 })
        : json({ notifications: [storedNotification()], unreadCount: 1 });
    });
    const ui = render();
    await ui.waitFor(() => api?.notifications.length === 1);

    await call((current) => current.markAsRead("n1"));

    expect(api?.notifications[0].read).toBe(true);
    expect(requests.some((r) => r.method === "POST" && (r.body as { id?: string })?.id === "n1")).toBe(true);
  });

  it("marks everything read and zeroes the badge", async () => {
    stubNotifications((_url, init) =>
      init.method === "POST"
        ? json({ unreadCount: 0 })
        : json({ notifications: [storedNotification(), storedNotification({ id: "n2" })], unreadCount: 2 }),
    );
    const ui = render();
    await ui.waitFor(() => api?.notifications.length === 2);

    await call((current) => current.markAllAsRead());

    expect(api?.notifications.every((n) => n.read)).toBe(true);
    expect(api?.unreadCount).toBe(0);
  });

  it("clears the inbox when the reader signs out", async () => {
    stubNotifications(() => json({ notifications: [storedNotification()], unreadCount: 1 }));
    const ui = render();
    await ui.waitFor(() => api?.notifications.length === 1);

    auth.user = null;
    await ui.render(
      <NotificationProvider>
        <Reader />
      </NotificationProvider>,
    );

    expect(api?.notifications).toHaveLength(0);
    expect(api?.unreadCount).toBe(0);
  });

  it("appends a Realtime INSERT and bumps the count", async () => {
    stubNotifications(() => json({ notifications: [], unreadCount: 0 }));
    const ui = render();
    await ui.waitFor(() => api !== null);
    await ui.settle();

    await act(async () => {
      realtime.insert?.({
        new: {
          id: "live-1",
          type: "follow",
          message: "you have a new follower",
          user_id: "u1",
          read_at: null,
          created_at: "2026-09-23 09:20:00.123456",
        },
      });
    });

    expect(api?.notifications[0]).toMatchObject({ id: "live-1", type: "follow", read: false });
    // The bare timestamp is normalised to UTC rather than read as local time.
    expect(api?.notifications[0].createdAt).toBe("2026-09-23T09:20:00.123456Z");
    expect(api?.unreadCount).toBe(1);
  });
});

describe("useNotifications", () => {
  it("throws outside a provider", () => {
    // Rendered to a string rather than mounted: the throw happens during the
    // render, so a DOM mount would leave its container behind with nothing left
    // to unmount it.
    expect(() => renderToStaticMarkup(<Reader />)).toThrow(
      "useNotifications must be used within NotificationProvider",
    );
  });
});
