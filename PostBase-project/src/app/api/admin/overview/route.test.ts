import { beforeEach, expect, test, vi } from "vitest";
vi.mock("@/lib/db", async () => ({
  db: (await import("@/test/fake-db")).fakeDb,
}));
const auth = vi.hoisted(() => ({ id: "member" as string | null }));
vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: async () => (auth.id ? { user: { id: auth.id } } : null),
    },
  },
}));
import { GET } from "./route";
import { fakeDb, resetFakeDb } from "@/test/fake-db";
import { users, posts, reports, moderationActions } from "@/lib/db/schema";
beforeEach(() => {
  resetFakeDb();
  auth.id = "member";
});
const request = () => new Request("http://localhost/api/admin/overview");
test("does not expose member data to visitors or ordinary members", async () => {
  auth.id = null;
  expect((await GET(request())).status).toBe(401);
  expect(fakeDb.reads).toEqual([]);
  auth.id = "member";
  fakeDb.selectReturns(users, [{ role: "member" }]);
  expect((await GET(request())).status).toBe(403);
  expect(fakeDb.reads).toEqual(["users"]);
});
test("returns database totals and recent decisions for an administrator", async () => {
  fakeDb
    .selectReturns(users, [{ role: "admin" }])
    .selectReturns(users, [{ total: 3 }])
    .selectReturns(users, [{ username: "ada", role: "member" }])
    .selectReturns(posts, [{ total: 7 }])
    .selectReturns(reports, [{ total: 2 }])
    .selectReturns(moderationActions, [{ action: "removal" }]);
  const response = await GET(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    stats: { users: 3, posts: 7, pendingReports: 2 },
    users: [{ username: "ada", role: "member" }],
    actions: [{ action: "removal" }],
  });
});
test("answers 500 when one of the overview reads fails", async () => {
  // The role read, then the user count; the post count is the read that fails,
  // so the failure lands after the admin gate rather than at it.
  fakeDb
    .selectReturns(users, [{ role: "admin" }])
    .selectReturns(users, [{ total: 3 }])
    .failNextSelect(posts, new Error("database unavailable"));
  const response = await GET(request());
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({
    error: "Unable to load admin overview",
  });
});
