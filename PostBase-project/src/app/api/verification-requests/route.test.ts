import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", async () => ({ db: (await import("@/test/fake-db")).fakeDb }));
const session = vi.hoisted(() => ({ userId: "member-1" as string | null }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: async () => session.userId ? { user: { id: session.userId } } : null } } }));

import { GET, POST } from "./route";
import { users, verificationRequests } from "@/lib/db/schema";
import { fakeDb, resetFakeDb } from "@/test/fake-db";

function request(method: string, body?: unknown) {
  return new Request("http://localhost/api/verification-requests", {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

beforeEach(() => { resetFakeDb(); session.userId = "member-1"; });

describe("member verification requests", () => {
  it("requires authentication before reads or writes", async () => {
    session.userId = null;
    expect((await POST(request("POST", { evidenceUrls: ["https://example.com"] }))).status).toBe(401);
    expect((await GET(request("GET"))).status).toBe(401);
    expect(fakeDb.reads).toEqual([]);
    expect(fakeDb.writes).toEqual([]);
  });

  it.each(["http://example.com", "javascript:alert(1)", "https://user:pass@example.com", "not a url"])("refuses non-public or malformed link %s", async (url) => {
    const response = await POST(request("POST", { evidenceUrls: [url] }));
    expect(response.status).toBe(400);
    expect(fakeDb.reads).toEqual([]);
  });

  it("creates a request for the session user with normalized HTTPS links", async () => {
    fakeDb.selectReturns(users, [{ verified: false }]);
    fakeDb.selectReturns(verificationRequests, []);
    fakeDb.insertReturns(verificationRequests, [{ id: "request-1", status: "pending", createdAt: new Date() }]);
    const response = await POST(request("POST", { evidenceUrls: [" https://example.com/about "] }));
    expect(response.status).toBe(201);
    expect(fakeDb.writes).toEqual([{ table: "verification_requests", values: { userId: "member-1", evidenceUrls: ["https://example.com/about"], status: "pending" } }]);
  });

  it("does not accept an application from an already verified account", async () => {
    fakeDb.selectReturns(users, [{ verified: true }]);
    const response = await POST(request("POST", { evidenceUrls: ["https://example.com"] }));
    expect(response.status).toBe(409);
    expect(fakeDb.writes).toEqual([]);
  });

  it("maps a concurrent pending-request uniqueness conflict to 409", async () => {
    fakeDb.selectReturns(users, [{ verified: false }]);
    fakeDb.selectReturns(verificationRequests, []);
    fakeDb.failNextInsert(verificationRequests, Object.assign(new Error("duplicate"), { code: "23505" }));
    const response = await POST(request("POST", { evidenceUrls: ["https://example.com"] }));
    expect(response.status).toBe(409);
    expect(fakeDb.writes).toEqual([]);
  });

  it("does not allow duplicate pending applications", async () => {
    fakeDb.selectReturns(users, [{ verified: false }]);
    fakeDb.selectReturns(verificationRequests, [{ id: "existing" }]);
    const response = await POST(request("POST", { evidenceUrls: ["https://example.com"] }));
    expect(response.status).toBe(409);
    expect(fakeDb.writes).toEqual([]);
  });

  it("returns only the signed-in member's status and links", async () => {
    fakeDb.selectReturns(users, [{ verified: false }]);
    fakeDb.selectReturns(verificationRequests, [{ id: "own", evidenceUrls: ["https://example.com"], status: "pending", reviewNote: null, createdAt: new Date() }]);
    const response = await GET(request("GET"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ verified: false, request: { id: "own", status: "pending" } });
    expect(fakeDb.selectParams[1]).toContain("member-1");
  });
});
