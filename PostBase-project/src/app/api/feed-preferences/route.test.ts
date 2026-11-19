import { beforeEach, expect, test, vi } from "vitest";
vi.mock("@/lib/db", async () => ({ db: (await import("@/test/fake-db")).fakeDb, withDbRetry: (work: () => unknown) => work() }));
vi.mock("@/lib/db/ensure-profile", () => ({ ensureLocalUserProfile: vi.fn() }));
const auth = vi.hoisted(() => ({ signedIn: true }));
vi.mock("@/lib/api-helpers", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/api-helpers")>(),
  requireAuth: async () => auth.signedIn ? { session: { user: { id: "member-1" } }, error: null } : { session: null, error: new Response(null, { status: 401 }) },
}));
import { fakeDb, resetFakeDb } from "@/test/fake-db";
import { profiles } from "@/lib/db/schema";
import { GET, PUT } from "./route";
beforeEach(() => { resetFakeDb(); auth.signedIn = true; });
const request = (body: unknown) => new Request("https://example.com/api/feed-preferences", { method: "PUT", body: JSON.stringify(body) });
test("signed-out callers cannot read or change preferences", async () => {
  auth.signedIn = false;
  expect((await GET(request(null))).status).toBe(401);
  expect((await PUT(request({ topics: [], format: "all" }))).status).toBe(401);
  expect(fakeDb.writes).toEqual([]);
});
test("reads the caller's persisted preferences and bilingual catalog", async () => {
  fakeDb.selectReturns(profiles, [{ appearance: { accent: "blue", feed: { topics: ["news"], format: "posts" } } }]);
  const response = await GET(request(null));
  const body = await response.json();
  expect(body.preferences).toEqual({ topics: ["news"], format: "posts" });
  expect(body.topics).toHaveLength(10);
  expect(fakeDb.selectParams).toContainEqual(["member-1"]);
});
test("rejects invalid topics without writes", async () => {
  expect((await PUT(request({ topics: ["invented"], format: "all" }))).status).toBe(400);
  expect(fakeDb.writes).toEqual([]);
});
test("updates only the caller and atomically merges the feed key", async () => {
  const response = await PUT(request({ topics: ["news", "comedy"], format: "posts" }));
  expect(response.status).toBe(200);
  expect(fakeDb.updateParams).toContainEqual(["member-1"]);
  expect(fakeDb.writes).toHaveLength(1);
  expect(fakeDb.writes[0].table).toBe("profiles");
});
