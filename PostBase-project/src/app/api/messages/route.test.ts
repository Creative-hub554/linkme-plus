import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The messages route: the conversation list and reading one, and sending.
 *
 * `GET` is read as the order it touches tables: a list reads `conversations`, a
 * single conversation reads it, checks membership, then reads `messages` and
 * marks the member read. A conversation the caller is not in is a `403`; one
 * that is not there is a `404`.
 *
 * `POST` is where a block matters, and it is pinned in both directions: the
 * recipient id must be a uuid (it is bound into the block lookup), a card
 * returned by that lookup refuses with `403` and writes nothing, and the
 * find-or-create below runs only when it comes back empty.
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
import { blocks, conversationMembers, conversations, messages } from "@/lib/db/schema";
import { fakeDb, resetFakeDb } from "@/test/fake-db";
import { expectGatedNone, expectGatedSequence } from "@/test/expect-gated";

const RECIPIENT_ID = "22222222-2222-4222-8222-222222222222";
const CONVERSATION_ID = "33333333-3333-4333-8333-333333333333";
const MESSAGE_ID = "44444444-4444-4444-8444-444444444444";
const BLOCK_ID = "55555555-5555-4555-8555-555555555555";

function read(query: string) {
  return new Request(`http://localhost/api/messages${query}`, { method: "GET" });
}

function send(body: unknown) {
  return new Request("http://localhost/api/messages", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  resetFakeDb();
  vi.clearAllMocks();
  session.userId = "sender-1";
});

describe("GET /api/messages", () => {
  it("requires a session before reading anything", async () => {
    session.userId = null;

    const response = await GET(read(""));

    expect(response.status).toBe(401);
    expectGatedNone("reads");
  });

  it("lists the caller's conversations", async () => {
    fakeDb.selectReturns(conversations, []);

    const response = await GET(read(""));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ conversations: [] });
    expectGatedSequence("reads", ["conversations"]);
  });

  it("answers 404 for a conversation that is not there", async () => {
    fakeDb.selectReturns(conversations, []);

    const response = await GET(read(`?id=${CONVERSATION_ID}`));

    expect(response.status).toBe(404);
    expectGatedSequence("reads", ["conversations"]);
  });

  it("answers 403 when the caller is not a member", async () => {
    fakeDb
      .selectReturns(conversations, [{ id: CONVERSATION_ID, createdAt: "2026-01-01T00:00:00Z" }])
      .selectReturns(conversationMembers, []);

    const response = await GET(read(`?id=${CONVERSATION_ID}`));

    expect(response.status).toBe(403);
    expectGatedSequence("reads", ["conversations", "conversation_members"]);
  });

  it("returns the messages and marks the member read", async () => {
    const message = {
      id: MESSAGE_ID,
      content: "hello",
      senderId: "sender-1",
      readAt: null,
      createdAt: "2026-01-02T00:00:00Z",
      sender: { name: "Sender", avatarUrl: null },
    };
    fakeDb
      .selectReturns(conversations, [{ id: CONVERSATION_ID, createdAt: "2026-01-01T00:00:00Z" }])
      .selectReturns(conversationMembers, [{ conversationId: CONVERSATION_ID, userId: "sender-1" }])
      .selectReturns(messages, [message])
      .selectReturns(conversationMembers, [{ userId: RECIPIENT_ID, name: "Bob", avatarUrl: null }]);

    const response = await GET(read(`?id=${CONVERSATION_ID}`));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      conversation: { id: CONVERSATION_ID, createdAt: "2026-01-01T00:00:00Z" },
      messages: [message],
      otherMember: { userId: RECIPIENT_ID, name: "Bob", avatarUrl: null },
    });
    // The read is marked so the unread badge clears.
    expectGatedSequence("reads", [
      "conversations",
      "conversation_members",
      "messages",
      "conversation_members",
    ]);
    expectGatedSequence("writes", [
      { table: "conversation_members", values: { lastReadAt: expect.any(Date) } },
    ]);
  });

  it("answers 500 when the conversation list read fails, recording no read", async () => {
    const silence = vi.spyOn(console, "error").mockImplementation(() => {});
    fakeDb.failNextSelect(conversations, new Error("database unavailable"));
    try {
      const response = await GET(read(""));

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: "Failed to fetch conversations" });
      // The read never resolved, so the fake recorded nothing.
      expectGatedNone("reads");
    } finally {
      silence.mockRestore();
    }
  });
});

describe("POST /api/messages", () => {
  it("requires a session before reading anything", async () => {
    session.userId = null;

    const response = await POST(send({ recipientId: RECIPIENT_ID, content: "hi" }));

    expect(response.status).toBe(401);
    expectGatedNone("reads");
  });

  it("requires a recipient and content, reading nothing", async () => {
    expect((await POST(send({ content: "hi" }))).status).toBe(400);
    expect((await POST(send({ recipientId: RECIPIENT_ID }))).status).toBe(400);
    expect((await POST(send({ recipientId: "", content: "" }))).status).toBe(400);
    expectGatedNone("reads");
  });

  it("refuses a non-uuid recipient before it is bound into the lookup", async () => {
    const response = await POST(send({ recipientId: "not-a-uuid", content: "hi" }));

    expect(response.status).toBe(400);
    expectGatedNone("reads");
  });

  it("refuses when a block stands between the two, in either direction", async () => {
    fakeDb.selectReturns(blocks, [{ id: BLOCK_ID }]);

    const response = await POST(send({ recipientId: RECIPIENT_ID, content: "hi" }));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "You cannot message this member" });
    // The block was consulted first, and nothing was written — not even an empty
    // conversation that would have exposed the pair to each other.
    expectGatedSequence("reads", ["blocks"]);
    expectGatedNone("writes");
    expectGatedNone("deletes");
  });

  it("creates a conversation when none exists and no block stands", async () => {
    const message = {
      id: MESSAGE_ID,
      conversationId: CONVERSATION_ID,
      senderId: "sender-1",
      content: "hi",
    };
    fakeDb
      .selectReturns(blocks, [])
      .selectReturns(conversationMembers, [])
      .insertReturns(conversations, [{ id: CONVERSATION_ID }])
      .insertReturns(messages, [message]);

    const response = await POST(send({ recipientId: RECIPIENT_ID, content: "hi" }));

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ message, conversationId: CONVERSATION_ID });
    expectGatedSequence("writes", [
      { table: "conversations", values: {} },
      {
        table: "conversation_members",
        values: [
          { conversationId: CONVERSATION_ID, userId: "sender-1" },
          { conversationId: CONVERSATION_ID, userId: RECIPIENT_ID },
        ],
      },
      {
        table: "messages",
        values: { conversationId: CONVERSATION_ID, senderId: "sender-1", content: "hi" },
      },
    ]);
  });

  it("sends into the existing conversation instead of creating one", async () => {
    const message = {
      id: MESSAGE_ID,
      conversationId: CONVERSATION_ID,
      senderId: "sender-1",
      content: "hi",
    };
    fakeDb
      .selectReturns(blocks, [])
      .selectReturns(conversationMembers, [{ conversationId: CONVERSATION_ID }])
      .selectReturns(conversationMembers, [
        { conversationId: CONVERSATION_ID, userId: RECIPIENT_ID },
      ])
      .insertReturns(messages, [message]);

    const response = await POST(send({ recipientId: RECIPIENT_ID, content: "hi" }));

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ message, conversationId: CONVERSATION_ID });
    expectGatedSequence("writes", [
      {
        table: "messages",
        values: { conversationId: CONVERSATION_ID, senderId: "sender-1", content: "hi" },
      },
    ]);
  });

  it("answers 500 when the block lookup fails, writing nothing", async () => {
    fakeDb.failNextSelect(blocks);

    const response = await POST(send({ recipientId: RECIPIENT_ID, content: "hi" }));

    expect(response.status).toBe(500);
    expectGatedNone("writes");
  });
});
