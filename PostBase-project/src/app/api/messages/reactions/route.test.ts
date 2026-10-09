import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The chat reactions route: the toggle and its counters, gated on the thread.
 *
 * The shape is the posts reactions route's — one press adds, replaces or
 * removes depending on the row the caller already owns, and `GET` counts what
 * the rows say — but the gate is a message's own: every read and every write
 * passes the message first and the caller's seat in its conversation second, so
 * naming a message id is not enough. A message that is not there is a `404`,
 * one whose thread the caller is not in is a `403`, and neither leaves a
 * reaction row read or written. The vocabulary is the other refusal: a type the
 * picker cannot offer is a `400` before anything is looked up.
 */
vi.mock("@/lib/db", async () => {
  const { fakeDb } = await import("@/test/fake-db");
  return {
    db: fakeDb,
    withDbRetry: (operation: () => unknown) => operation(),
  };
});

const session = vi.hoisted(() => ({ userId: "sender-1" as string | null }));

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: async () => (session.userId ? { user: { id: session.userId } } : null),
    },
  },
}));

import { GET, POST } from "./route";
import { conversationMembers, messages, reactions } from "@/lib/db/schema";
import { fakeDb, resetFakeDb } from "@/test/fake-db";
import { expectGatedNone, expectGatedSequence } from "@/test/expect-gated";

const MESSAGE_ID = "44444444-4444-4444-8444-444444444444";
const CONVERSATION_ID = "33333333-3333-4333-8333-333333333333";
const REACTION_ID = "77777777-7777-4777-8777-777777777777";

const messageRow = {
  id: MESSAGE_ID,
  conversationId: CONVERSATION_ID,
  senderId: "user-2",
};
const memberRow = { conversationId: CONVERSATION_ID, userId: "sender-1" };

function jsonRequest(method: string, path: string, body?: unknown) {
  return new Request(`http://localhost${path}`, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  });
}

const press = { targetId: MESSAGE_ID, type: "heart" };

beforeEach(() => {
  resetFakeDb();
  vi.clearAllMocks();
  session.userId = "sender-1";
});

describe("POST /api/messages/reactions", () => {
  it("requires a session before reading anything", async () => {
    session.userId = null;

    const response = await POST(jsonRequest("POST", "/api/messages/reactions", press));

    expect(response.status).toBe(401);
    expectGatedNone("reads");
  });

  it("requires a message id and a type, reading nothing", async () => {
    // The bodies matter as much as the status: the checks below this one would
    // also answer 400 for a missing field (an id that is not a uuid, a type the
    // vocabulary does not know), and a test that only counted statuses could
    // not tell this guard's answer from theirs — which is exactly how a guard
    // survives the sweep.
    const missingId = await POST(jsonRequest("POST", "/api/messages/reactions", { type: "heart" }));
    expect(missingId.status).toBe(400);
    expect(await missingId.json()).toEqual({ error: "Message ID and reaction type are required" });

    const missingType = await POST(jsonRequest("POST", "/api/messages/reactions", { targetId: MESSAGE_ID }));
    expect(missingType.status).toBe(400);
    expect(await missingType.json()).toEqual({ error: "Message ID and reaction type are required" });
    expectGatedNone("reads");
  });

  it("refuses a non-uuid message id before it is bound into the lookup", async () => {
    const response = await POST(
      jsonRequest("POST", "/api/messages/reactions", { targetId: "not-a-uuid", type: "heart" }),
    );

    expect(response.status).toBe(400);
    expectGatedNone("reads");
  });

  it("refuses a type the vocabulary cannot draw, before anything is looked up", async () => {
    const response = await POST(
      jsonRequest("POST", "/api/messages/reactions", { targetId: MESSAGE_ID, type: "shrug" }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Unknown reaction type" });
    expectGatedNone("reads");
    expectGatedNone("writes");
  });

  it("answers 404 for a message that is not there, reading no reactions", async () => {
    fakeDb.selectReturns(messages, []);

    const response = await POST(jsonRequest("POST", "/api/messages/reactions", press));

    expect(response.status).toBe(404);
    expectGatedSequence("reads", ["messages"]);
    expectGatedNone("writes");
  });

  it("answers 403 for a message whose thread the caller is not in", async () => {
    fakeDb
      .selectReturns(messages, [messageRow])
      .selectReturns(conversationMembers, []);

    const response = await POST(jsonRequest("POST", "/api/messages/reactions", press));

    expect(response.status).toBe(403);
    // The gate is the caller's seat in the message's conversation — the same
    // read the thread itself is gated on — and no reaction row was touched.
    expectGatedSequence("reads", ["messages", "conversation_members"]);
    expectGatedNone("writes");
  });

  it("adds the caller's reaction when they had none", async () => {
    fakeDb
      .selectReturns(messages, [messageRow])
      .selectReturns(conversationMembers, [memberRow])
      .selectReturns(reactions, [])
      .insertReturns(reactions, [{ id: REACTION_ID, type: "heart" }]);

    const response = await POST(jsonRequest("POST", "/api/messages/reactions", press));

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ reacted: true, type: "heart" });
    // The row is written as the session's, on the message named in the body —
    // `targetType: "message"` is what keeps it in the chat's half of the table.
    expectGatedSequence("writes", [
      {
        table: "reactions",
        values: {
          targetType: "message",
          targetId: MESSAGE_ID,
          userId: "sender-1",
          type: "heart",
        },
      },
    ]);
  });

  it("replaces the caller's held type rather than stacking a second row", async () => {
    fakeDb
      .selectReturns(messages, [messageRow])
      .selectReturns(conversationMembers, [memberRow])
      .selectReturns(reactions, [{ id: REACTION_ID, type: "thumbs" }])
      .updateReturns(reactions, [{ id: REACTION_ID, type: "heart" }]);

    const response = await POST(jsonRequest("POST", "/api/messages/reactions", press));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ reacted: true, type: "heart" });
    expectGatedSequence("writes", [{ table: "reactions", values: { type: "heart" } }]);
  });

  it("takes the same press again as a removal", async () => {
    fakeDb
      .selectReturns(messages, [messageRow])
      .selectReturns(conversationMembers, [memberRow])
      .selectReturns(reactions, [{ id: REACTION_ID, type: "heart" }]);

    const response = await POST(jsonRequest("POST", "/api/messages/reactions", press));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ reacted: false, type: null });
    // The delete is the caller's own row, found by its id from the scoped read
    // above — not by anything the body claimed.
    expectGatedSequence("deletes", ["reactions"]);
    expectGatedNone("writes");
  });

  it("answers 500 when the message lookup fails, writing nothing", async () => {
    const silence = vi.spyOn(console, "error").mockImplementation(() => {});
    fakeDb.failNextSelect(messages, new Error("database unavailable"));
    try {
      const response = await POST(jsonRequest("POST", "/api/messages/reactions", press));

      expect(response.status).toBe(500);
      expectGatedNone("writes");
    } finally {
      silence.mockRestore();
    }
  });
});

describe("GET /api/messages/reactions", () => {
  it("requires a session before reading anything", async () => {
    session.userId = null;

    const response = await GET(jsonRequest("GET", `/api/messages/reactions?targetId=${MESSAGE_ID}`));

    expect(response.status).toBe(401);
    expectGatedNone("reads");
  });

  it("requires a message id, and refuses one that is not a uuid", async () => {
    // Pinned by body, not only by status: the uuid check below would also
    // answer 400 for an absent id, so a status-only test cannot tell the two
    // guards apart.
    const absent = await GET(jsonRequest("GET", "/api/messages/reactions"));
    expect(absent.status).toBe(400);
    expect(await absent.json()).toEqual({ error: "Message ID is required" });

    const malformed = await GET(
      jsonRequest("GET", "/api/messages/reactions?targetId=not-a-uuid"),
    );
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toEqual({ error: "Invalid message id" });
    expectGatedNone("reads");
  });

  it("answers 404 for a message that is not there", async () => {
    fakeDb.selectReturns(messages, []);

    const response = await GET(jsonRequest("GET", `/api/messages/reactions?targetId=${MESSAGE_ID}`));

    expect(response.status).toBe(404);
    expectGatedSequence("reads", ["messages"]);
  });

  it("answers 403 for a thread the caller is not in — the counters are as private as the thread", async () => {
    fakeDb
      .selectReturns(messages, [messageRow])
      .selectReturns(conversationMembers, []);

    const response = await GET(jsonRequest("GET", `/api/messages/reactions?targetId=${MESSAGE_ID}`));

    expect(response.status).toBe(403);
    expectGatedSequence("reads", ["messages", "conversation_members"]);
  });

  it("answers 500 when the message lookup fails", async () => {
    const silence = vi.spyOn(console, "error").mockImplementation(() => {});
    fakeDb.failNextSelect(messages, new Error("database unavailable"));
    try {
      const response = await GET(
        jsonRequest("GET", `/api/messages/reactions?targetId=${MESSAGE_ID}`),
      );

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: "Failed to fetch reactions" });
      // The read never resolved, so the fake recorded nothing.
      expectGatedNone("reads");
    } finally {
      silence.mockRestore();
    }
  });

  it("counts each type and names the caller's own", async () => {
    fakeDb
      .selectReturns(messages, [messageRow])
      .selectReturns(conversationMembers, [memberRow])
      .selectReturns(reactions, [
        { userId: "sender-1", type: "heart" },
        { userId: "user-2", type: "heart" },
        { userId: "user-2", type: "fire" },
      ]);

    const response = await GET(jsonRequest("GET", `/api/messages/reactions?targetId=${MESSAGE_ID}`));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      counts: { heart: 2, fire: 1 },
      total: 3,
      userReaction: "heart",
    });
  });
});
