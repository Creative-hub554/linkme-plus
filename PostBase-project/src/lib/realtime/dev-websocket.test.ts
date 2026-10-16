import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocket } from "ws";
import { afterEach, describe, expect, test, vi } from "vitest";
import { devWebSocketPlugin } from "./dev-websocket";
import type { WsSessionAuthenticator } from "./ws-session";

/**
 * The development side of `/ws`, exercised through a real HTTP server rather
 * than a mocked socket: the door's whole job happens on the wire — an HTTP
 * status line before any socket exists, the hub's `connected` frame after —
 * and a mock would assert neither.
 *
 * The session check is injected (one fake, no auth server in the suite); what
 * is under test is the door's half of the contract: hand the upgrade's cookies
 * and claimed id to the check, refuse with the status it decides, and only
 * then let the shared hub speak — under the *session's* id.
 */

interface Door {
  url: string;
  close: () => Promise<void>;
}

const doors: Server[] = [];

/** Wire the plugin onto a throwaway HTTP server and start listening. */
async function startDoor(authenticate: WsSessionAuthenticator): Promise<Door> {
  const plugin = devWebSocketPlugin({ authenticate });
  const httpServer = createServer((_request, response) => {
    response.statusCode = 404;
    response.end();
  });
  (plugin.configureServer as unknown as (server: { httpServer: Server }) => void)({
    httpServer,
  });
  doors.push(httpServer);

  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const { port } = httpServer.address() as AddressInfo;
  return {
    url: `ws://127.0.0.1:${port}`,
    close: () =>
      new Promise((resolve) => {
        httpServer.closeAllConnections?.();
        httpServer.close(() => resolve());
      }),
  };
}

/** Connect and require the door to refuse with exactly this status. */
function expectRefusal(url: string, headers?: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, { headers });
    socket.on("open", () => reject(new Error("the door opened when it should have refused")));
    socket.on("error", (error) => reject(error));
    socket.on("unexpected-response", (_request, response) => {
      response.resume();
      resolve(response.statusCode ?? 0);
    });
    setTimeout(() => reject(new Error("the refusal never arrived")), 3000);
  });
}

/** Connect and require the hub's first frame to arrive. */
function firstFrame(url: string, headers?: Record<string, string>): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, { headers });
    socket.on("error", (error) => reject(error));
    socket.on("message", (data) => {
      socket.close();
      try {
        resolve(JSON.parse(data.toString()));
      } catch (error) {
        reject(error);
      }
    });
    setTimeout(() => reject(new Error("the hub never spoke")), 3000);
  });
}

afterEach(async () => {
  await Promise.all(
    doors.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections?.();
          server.close(() => resolve());
        }),
    ),
  );
  vi.restoreAllMocks();
});

const refuse = (status: 401 | 403): WsSessionAuthenticator => async () => ({
  ok: false,
  status,
  message: status === 401 ? "Unauthorized" : "Session does not match the requested user",
});

describe("the development /ws door", () => {
  test("answers an unauthenticated handshake with 401, before any socket exists", async () => {
    const door = await startDoor(refuse(401));

    await expect(expectRefusal(`${door.url}/ws?userId=user-7`)).resolves.toBe(401);
  });

  test("answers a claim on someone else's id with 403", async () => {
    const door = await startDoor(refuse(403));

    await expect(expectRefusal(`${door.url}/ws?userId=user-9`)).resolves.toBe(403);
  });

  test("hands the upgrade's cookies and claimed id to the check", async () => {
    const authenticate = vi.fn<WsSessionAuthenticator>(async () => ({
      ok: false,
      status: 401,
      message: "Unauthorized",
    }));
    const door = await startDoor(authenticate);

    await expectRefusal(`${door.url}/ws?userId=user-7`, { Cookie: "sid=session-cookie" });

    expect(authenticate).toHaveBeenCalledWith({
      cookieHeader: "sid=session-cookie",
      claimedUserId: "user-7",
      config: undefined,
    });
  });

  test("opens on a verified session under the session's id, not the query's", async () => {
    const authenticate = vi.fn<WsSessionAuthenticator>(async () => ({
      ok: true,
      userId: "session-user",
    }));
    const door = await startDoor(authenticate);

    // No claimed id at all: the door must present as the session's user anyway.
    const frame = await firstFrame(`${door.url}/ws`, { Cookie: "sid=session-cookie" });

    expect(frame).toMatchObject({ type: "connected", userId: "session-user" });
    expect(authenticate).toHaveBeenCalledWith(
      expect.objectContaining({ cookieHeader: "sid=session-cookie", claimedUserId: null }),
    );
  });

  test("closes the socket when the check itself crashes", async () => {
    const door = await startDoor(async () => {
      throw new Error("auth exploded");
    });

    await expect(expectRefusal(`${door.url}/ws`)).rejects.toThrow();
  });
});
