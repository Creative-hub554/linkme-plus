// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act } from "react";
import { cleanupSurfaces, mountSurface, type MountedSurface } from "@/test/render";
import { stubFetch } from "@/test/stub-fetch";

/**
 * What the provider adds over the socket hook's own tests: the *sharing*.
 *
 * `use-websocket.test.tsx` holds the channel to its rules — dials with a
 * user, idles while disabled, closes on request — for a hook running one
 * channel of its own, which is still what happens with no provider above.
 * What only exists with a provider is the count: several consumers asking
 * through it are one connection, none asking is none of one, and the last to
 * stop asking is what hangs the page up. That count is the whole point —
 * three `global` sockets per signed-in page were the bug this exists to end —
 * so these read it the way a reader would: sockets constructed, frames
 * delivered, verdicts on screen.
 *
 * The socket is the same fake the other realtime tests drive by hand, because
 * one frame on *the* socket reaching every consumer is what proves they read
 * the same channel rather than each quietly keeping its own.
 */
const mocks = vi.hoisted(() => ({ signedIn: true }));

vi.mock("@/lib/auth-client", () => ({
  useSession: () => ({
    session: mocks.signedIn ? { user: { id: "member-1" } } : null,
    loading: false,
  }),
}));

import { useWebSocket } from "@/hooks/use-websocket";
import { RoomProvider } from "./room-provider";

/** The fake socket, with the events the test drives as real methods. */
class FakeWebSocket {
  static OPEN = 1;
  static instances: FakeWebSocket[] = [];

  url: string;
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((error: unknown) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  /** A clean teardown's close: silent, or the hook would reconnect into the next test. */
  close() {
    this.readyState = 3;
  }

  // --- what the test drives ---

  open() {
    this.readyState = 1;
    this.onopen?.();
  }

  message(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }

  /** The provider's socket — there is meant to be exactly one, so it is this. */
  static get current(): FakeWebSocket {
    const socket = FakeWebSocket.instances.at(-1);
    if (!socket) throw new Error("no socket was opened");
    return socket;
  }
}

/**
 * One consumer of the room, shaped like the app's real three: a connection
 * flag and the last frame, read from wherever the hook decides to answer.
 * `options` is how a consumer asks differently — disabled, or configured.
 */
function Probe({ name, options }: { name: string; options?: Parameters<typeof useWebSocket>[0] }) {
  const { isConnected, lastMessage } = useWebSocket(options);
  return (
    <section aria-label={name}>
      <p>{`${name}:${isConnected ? "up" : "down"}`}</p>
      <p>{`${name}:${lastMessage?.type ?? "nothing"}`}</p>
    </section>
  );
}

/** A page under the root layout: the provider wrapping whatever asks through it. */
function mountPage(node: React.ReactNode): { ui: MountedSurface } {
  // Nothing here should fetch — a surprise request answers the empty stub
  // rather than reaching the network, where jsdom would fail it noisily.
  stubFetch({});
  const ui = mountSurface(node, { providers: "none" });
  return { ui };
}

beforeEach(() => {
  mocks.signedIn = true;
  FakeWebSocket.instances.length = 0;
  vi.stubGlobal("WebSocket", FakeWebSocket);
});

afterEach(() => {
  cleanupSurfaces();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("RoomProvider", () => {
  test("one connection serves every consumer asking, and hears one frame together", async () => {
    const { ui } = mountPage(
      <RoomProvider room="global">
        <Probe name="bubble" />
        <Probe name="page" />
        <Probe name="indicator" />
        <Probe name="quiet" options={{ enabled: false }} />
      </RoomProvider>,
    );

    // One socket for the four consumers — and it is the room they asked for.
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(FakeWebSocket.instances[0].url).toContain("room=global");

    // The socket opens and a frame lands on it: every asking consumer flips
    // up and hears the frame through the shared channel — the claim three
    // separate sockets could not make, since they cannot all be *this*
    // connection. The consumer not asking stays down and hears nothing.
    await act(async () => {
      FakeWebSocket.current.open();
      FakeWebSocket.current.message({ type: "typing", conversationId: "c1" });
    });
    await ui.waitFor(() => (ui.container.textContent ?? "").includes("page:typing"), {
      description: "the frame to reach the page's read of the channel",
    });
    expect(ui.container.textContent).toContain("bubble:typing");
    expect(ui.container.textContent).toContain("indicator:typing");
    expect(ui.container.textContent).toContain("quiet:down");
    expect(ui.container.textContent).toContain("quiet:nothing");
  });

  test("dials nothing while no consumer is asking", async () => {
    const { ui } = mountPage(
      <RoomProvider room="global">
        <Probe name="quiet" options={{ enabled: false }} />
      </RoomProvider>,
    );

    // Decided at mount, same as the socket hook's own disabled test: the
    // claim never happens, the count never leaves zero, and the channel never
    // starts. This is what keeps a page with none of these consumers on it —
    // or a signed-out reader — holding no connection at all.
    expect(FakeWebSocket.instances).toHaveLength(0);
    expect(ui.container.textContent).toContain("quiet:down");
    expect(ui.container.textContent).toContain("quiet:nothing");
  });

  test("hangs up when the last consumer stops, and dials when one asks again", async () => {
    const asking = (enabled: boolean) => (
      <RoomProvider room="global">
        <Probe name="page" options={{ enabled }} />
      </RoomProvider>
    );

    const { ui } = mountPage(asking(true));
    await ui.waitFor(() => FakeWebSocket.instances.length === 1, {
      description: "the provider to dial for its one consumer",
    });

    // The consumer stops asking — its `enabled` flips, the release runs, the
    // count falls to zero — and with nobody asking the provider lets the
    // connection go rather than idling open.
    await ui.render(asking(false));
    await ui.waitFor(() => FakeWebSocket.instances[0].readyState === 3, {
      description: "the provider's socket to close",
    });
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(ui.container.textContent).toContain("page:down");

    // And a claim can be made again: a count that only ever rose once would
    // leave the next asker on a channel nobody has re-asked for.
    await ui.render(asking(true));
    await ui.waitFor(() => FakeWebSocket.instances.length === 2, {
      description: "a fresh connection for the re-claim",
    });
    await act(async () => {
      FakeWebSocket.current.open();
    });
    await ui.waitFor(() => (ui.container.textContent ?? "").includes("page:up"), {
      description: "the re-claimed connection to answer",
    });
  });

  test("a consumer that configured the connection, or wants another room, gets its own", async () => {
    const { ui } = mountPage(
      <RoomProvider room="global">
        <Probe name="page" />
        <Probe name="other-room" options={{ room: "presence" }} />
        <Probe name="on-connect" options={{ onConnect: () => {} }} />
        <Probe name="on-disconnect" options={{ onDisconnect: () => {} }} />
        <Probe name="slow-retry" options={{ reconnectInterval: 500 }} />
        <Probe name="few-retries" options={{ maxReconnectAttempts: 3 }} />
      </RoomProvider>,
    );

    // The shared connection, plus one socket per consumer that asked for a
    // connection of its own. Sharing is for consumers who want the room's
    // defaults *together*; anything configured — callbacks, reconnect tuning —
    // or pointed at another room earns a real connection rather than being
    // silently ignored, because a shared channel has one set of each to give.
    await ui.waitFor(() => FakeWebSocket.instances.length === 6, {
      description: "the shared connection and each configured consumer's own",
    });
    const urls = FakeWebSocket.instances.map((socket) => socket.url);
    expect(urls.filter((url) => url.includes("room=global"))).toHaveLength(5);
    expect(urls.filter((url) => url.includes("room=presence"))).toHaveLength(1);
    // The page, still reading the shared one it asked for by default.
    expect(ui.container.textContent).toContain("page:down");
  });
});
