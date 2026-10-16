// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act } from "react";
import { cleanupSurfaces, mountSurface, type MountedSurface } from "@/test/render";
import { stubFetch, type FetchRecorder } from "@/test/stub-fetch";

/**
 * What the provider adds over the channel's own tests: the *sharing*.
 *
 * `use-presence-flags.test.tsx` holds the channel to its rules — roster first,
 * socket supersedes, `null` until something answered — for a hook running one
 * channel of its own, which is still what happens with no provider above.
 * What only exists with a provider is the count: several surfaces asking
 * through it are one connection and one roster read, none asking is none of
 * either, and the last one to stop asking is what hangs the page up.
 *
 * That count is the whole point of the provider — three presence connections
 * per page were the bug it exists to end — so these tests read it the way a
 * reader would: sockets constructed, roster requests sent, verdicts on screen.
 * The socket is the same fake the channel's tests drive by hand, because a
 * snapshot arriving on *the one* socket is what proves every surface reads the
 * same channel rather than each quietly keeping its own.
 */
const mocks = vi.hoisted(() => ({ signedIn: true }));

vi.mock("@/lib/auth-client", () => ({
  useSession: () => ({
    session: mocks.signedIn ? { user: { id: "member-1" } } : null,
    loading: false,
  }),
}));

import { PresenceProvider } from "./presence-provider";
import { usePresenceFlags } from "@/hooks/use-presence-flags";

/** The roster as the route answers it: every member flagged either way. */
const roster = {
  users: [
    { userId: "member-1", displayName: "Theo Wu", avatarUrl: null, online: false },
    { userId: "member-2", displayName: "Maya Chen", avatarUrl: null, online: true },
    { userId: "member-3", displayName: "Sam Lee", avatarUrl: null, online: false },
  ],
};

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

  /** The server hanging up — which is what the roster's return path is for. */
  drop() {
    this.readyState = 3;
    this.onclose?.();
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
 * One surface asking: the same verdicts as the channel's own tests read, so a
 * page of these is a strip, a column and a dialog reading one provider.
 */
function Probe({ name, ids, active = true }: { name: string; ids: string[]; active?: boolean }) {
  const { isOnline } = usePresenceFlags(active);
  return (
    <section aria-label={name}>
      <ul>
        {ids.map((id) => (
          <li key={id}>
            {`${id}:${isOnline(id) === null ? "unknown" : isOnline(id) ? "online" : "offline"}`}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** A page under the layout: the provider wrapping whatever asks through it. */
function mountPage(node: React.ReactNode): { ui: MountedSurface; requests: FetchRecorder } {
  const requests = stubFetch({ "/api/presence": roster });
  const ui = mountSurface(node, { providers: "none" });
  return { ui, requests };
}

/** How many times the roster has been read. */
function beats(requests: FetchRecorder): number {
  return requests.calls.filter((call) => call.pathname === "/api/presence").length;
}

/** How often a verdict appears as text — one per surface drawing it. */
function occurrences(text: string, needle: string): number {
  return text.split(needle).length - 1;
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

describe("PresenceProvider", () => {
  test("one socket and one roster read serve every surface asking", async () => {
    const { ui, requests } = mountPage(
      <PresenceProvider>
        <Probe name="strip" ids={["member-2"]} />
        <Probe name="column" ids={["member-2", "member-3"]} />
        <Probe name="shut dialog" ids={["member-9"]} active={false} />
      </PresenceProvider>,
    );

    await ui.waitFor(() => (ui.container.textContent ?? "").includes("member-2:online"), {
      description: "the shared roster's verdict to arrive",
    });

    // One read for the whole page — the beats every asking surface used to
    // send itself — and both asking surfaces answered from it.
    expect(beats(requests)).toBe(1);
    expect(occurrences(ui.container.textContent ?? "", "member-2:online")).toBe(2);
    expect(ui.container.textContent).toContain("member-3:offline");

    // One connection, not one per probe: this is the three-sockets-per-page
    // collapse, read off the constructors.
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(FakeWebSocket.instances[0].url).toContain("room=presence");

    // …and a surface that is not asking still claims nothing of the shared
    // answer: shut, it draws no verdict, whatever the page beside it knows.
    expect(ui.container.textContent).toContain("member-9:unknown");
  });

  test("dials nothing while no surface is asking", async () => {
    const { ui, requests } = mountPage(
      <PresenceProvider>
        <Probe name="shut dialog" ids={["member-2"]} active={false} />
      </PresenceProvider>,
    );

    // Decided at mount, same as the hook's own inactive test: the claim never
    // happens, so the count never leaves zero and the provider never starts
    // its channel. This is what keeps a page with no presence on it — the
    // marketplace, settings — holding no connection at all.
    await ui.waitFor(() => (ui.container.textContent ?? "").includes("member-2"), {
      description: "the probe's rows to render",
    });

    expect(requests.calls).toEqual([]);
    expect(FakeWebSocket.instances).toHaveLength(0);
    expect(ui.container.textContent).toContain("member-2:unknown");
  });

  test("a frame on the one socket reaches every surface reading it", async () => {
    const { ui } = mountPage(
      <PresenceProvider>
        <Probe name="strip" ids={["member-3"]} />
        <Probe name="column" ids={["member-3"]} />
      </PresenceProvider>,
    );

    await ui.waitFor(() => (ui.container.textContent ?? "").includes("member-3:offline"), {
      description: "the roster's verdict to arrive",
    });
    expect(FakeWebSocket.instances).toHaveLength(1);

    // Sam arrives. One frame, one socket — and both surfaces flip, which is
    // the claim a page of separate channels could not make: they read the
    // same channel, so they cannot disagree.
    await act(async () => {
      FakeWebSocket.current.open();
      FakeWebSocket.current.message({ type: "user:online", userId: "member-3" });
    });

    await ui.waitFor(() => occurrences(ui.container.textContent ?? "", "member-3:online") === 2, {
      description: "both surfaces to hear the arrival",
    });
  });

  test("hangs up when the last asking surface stops, and dials when one asks again", async () => {
    const asker = (active: boolean) => (
      <PresenceProvider>
        <Probe name="column" ids={["member-2"]} active={active} />
      </PresenceProvider>
    );

    const { ui, requests } = mountPage(asker(true));
    await ui.waitFor(() => (ui.container.textContent ?? "").includes("member-2:online"), {
      description: "the roster's verdict to arrive",
    });
    expect(FakeWebSocket.instances).toHaveLength(1);

    // The surface stops asking — the dialog shuts, the list unmounts. Its
    // claim is released, the count falls to zero, and with nobody asking the
    // provider lets the connection go rather than idling open.
    await ui.render(asker(false));
    await ui.waitFor(() => FakeWebSocket.instances[0].readyState === 3, {
      description: "the provider's socket to close",
    });

    // Releasing is not a drop: nothing re-reads on the way out — the page is
    // simply not asking — and the surface that stopped draws nothing now,
    // shared answer or not.
    expect(beats(requests)).toBe(1);
    expect(ui.container.textContent).toContain("member-2:unknown");

    // And a claim can be made again. A count that only ever rose once would
    // leave the dialog's second opening on a channel nobody has re-asked:
    // fresh connection, fresh read, answers back.
    await ui.render(asker(true));
    await ui.waitFor(() => beats(requests) === 2, {
      description: "the re-claimed channel to re-read the roster",
    });
    await ui.waitFor(() => FakeWebSocket.instances.length === 2, {
      description: "a fresh connection for the re-claim",
    });
    await ui.waitFor(() => (ui.container.textContent ?? "").includes("member-2:online"), {
      description: "the verdicts to be answering again",
    });
  });
});
