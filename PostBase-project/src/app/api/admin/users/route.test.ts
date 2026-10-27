import { beforeEach, expect, test, vi } from "vitest";
vi.mock("@/lib/db", async () => ({
  db: (await import("@/test/fake-db")).fakeDb,
}));
const session = vi.hoisted(() => ({
  id: "11111111-1111-4111-8111-111111111111" as string | null,
}));
vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: async () =>
        session.id ? { user: { id: session.id } } : null,
    },
  },
}));
import { GET, PUT } from "./route";
import { users } from "@/lib/db/schema";
import { fakeDb, resetFakeDb } from "@/test/fake-db";
const target = "22222222-2222-4222-8222-222222222222";
const request = (body: unknown) =>
  new Request("http://localhost/api/admin/users", {
    method: "PUT",
    body: JSON.stringify(body),
  });

test("the searchable member directory is admin-only and bounds its read", async () => {
  resetFakeDb();
  fakeDb.selectReturns(users, [{ role: "member" }]);
  expect(
    (await GET(new Request("http://localhost/api/admin/users?q=ada"))).status,
  ).toBe(403);
  resetFakeDb();
  fakeDb
    .selectReturns(users, [{ role: "admin" }])
    .selectReturns(users, [
      { id: target, username: "ada", role: "member", restrictionKind: "ban" },
    ]);
  const response = await GET(
    new Request("http://localhost/api/admin/users?q=ada&limit=999999"),
  );
  expect(response.status).toBe(200);
  expect(fakeDb.selectParams[1]).toContain("%ada%");
  expect((await response.json()).data[0].restrictionKind).toBe("ban");
});
beforeEach(() => {
  resetFakeDb();
  session.id = "11111111-1111-4111-8111-111111111111";
});
test("ordinary members and signed-out visitors cannot restrict anyone", async () => {
  session.id = null;
  expect((await PUT(request({}))).status).toBe(401);
  session.id = "member";
  fakeDb.selectReturns(users, [{ role: "member" }]);
  expect(
    (await PUT(request({ userId: target, action: "ban", reason: "spam" })))
      .status,
  ).toBe(403);
  expect(fakeDb.writes).toEqual([]);
});
test("an admin can suspend a member with an expiring audited restriction", async () => {
  fakeDb
    .selectReturns(users, [{ role: "admin" }])
    .selectReturns(users, [{ role: "member" }]);
  expect(
    (
      await PUT(
        request({
          userId: target,
          action: "suspend",
          days: 7,
          reason: "repeated abuse",
        }),
      )
    ).status,
  ).toBe(200);
  expect(fakeDb.writes[0]).toMatchObject({
    table: "account_restrictions",
    values: { userId: target, kind: "suspension", until: expect.any(Date) },
  });
  expect(fakeDb.writes[1]).toMatchObject({
    table: "audit_logs",
    values: { action: "account.suspend", targetId: target },
  });
});
test("administrator accounts cannot be banned here", async () => {
  fakeDb
    .selectReturns(users, [{ role: "admin" }])
    .selectReturns(users, [{ role: "admin" }]);
  expect(
    (await PUT(request({ userId: target, action: "ban", reason: "test" })))
      .status,
  ).toBe(403);
  expect(fakeDb.writes).toEqual([]);
});
