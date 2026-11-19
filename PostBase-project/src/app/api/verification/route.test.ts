import { beforeEach, expect, test, vi } from "vitest";
vi.mock("@/lib/db", async () => ({ db: (await import("@/test/fake-db")).fakeDb }));
const auth = vi.hoisted(() => ({ id: "member" as string | null }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: async () => auth.id ? { user: { id: auth.id } } : null } } }));
import { fakeDb, resetFakeDb } from "@/test/fake-db";
import { users, verificationRequests, privateEvidence } from "@/lib/db/schema";
import { GET, POST } from "./route";
const request = (body: unknown) => new Request("https://app.test/api/verification", { method: "POST", body: JSON.stringify(body) });
beforeEach(() => { resetFakeDb(); auth.id = "member"; });
test("identity submissions require an authenticated account", async () => {
  auth.id = null;
  expect((await GET(request(null))).status).toBe(401);
  expect((await POST(request({ evidenceIds: [] }))).status).toBe(401);
});
test("status reads are scoped to the member and do not select public evidence URLs", async () => {
  fakeDb.selectReturns(verificationRequests, []);
  expect((await GET(request(null))).status).toBe(200);
  expect(fakeDb.selectParams).toContainEqual(["member", "national_id"]);
});
test("an unowned or missing private document cannot be submitted", async () => {
  fakeDb.selectReturns(users, [{ id: "member" }]).selectReturns(verificationRequests, []).selectReturns(privateEvidence, []);
  expect((await POST(request({ evidenceIds: ["11111111-1111-4111-8111-111111111111"] }))).status).toBe(422);
  expect(fakeDb.writes).toEqual([]);
  expect(fakeDb.selectParams.some(params => params.includes("member") && params.includes("national_id"))).toBe(true);
});
