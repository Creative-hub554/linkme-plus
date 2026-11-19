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
import { accountRestrictions, users } from "@/lib/db/schema";
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
const asAdmin = () => fakeDb.selectReturns(users, [{ role: "admin" }]);
/** Issues one PUT as an administrator; the role read is scripted per request. */
async function putAsAdmin(payload: unknown) {
  asAdmin();
  const response = await PUT(request(payload));
  return { status: response.status, body: await response.json() };
}
test("refuses a missing, malformed, or self-directed target by name", async () => {
  const targets: [string, unknown][] = [
    ["absent", { action: "ban", reason: "spam" }],
    ["not a string", { userId: 42, action: "ban", reason: "spam" }],
    ["not a uuid", { userId: "not-a-uuid", action: "ban", reason: "spam" }],
    [
      "the caller themself",
      { userId: session.id, action: "ban", reason: "spam" },
    ],
  ];
  for (const [label, payload] of targets) {
    const { status, body } = await putAsAdmin(payload);
    expect(status, label).toBe(400);
    expect(body, label).toEqual({ error: "Select another valid member" });
  }
  // Every refusal happened before the transaction: no target read, no write.
  expect(fakeDb.reads).toEqual(["users", "users", "users", "users"]);
  expect(fakeDb.writes).toEqual([]);
});
test("refuses an action outside the three or an unusable reason", async () => {
  const payloads: [string, unknown][] = [
    [
      "unknown action",
      { userId: target, action: "promote", reason: "spam" },
    ],
    ["missing action", { userId: target, reason: "spam" }],
    ["missing reason", { userId: target, action: "ban" }],
    ["blank reason", { userId: target, action: "ban", reason: "   " }],
    ["non-string reason", { userId: target, action: "ban", reason: 7 }],
    [
      "overlong reason",
      { userId: target, action: "ban", reason: "x".repeat(2001) },
    ],
  ];
  for (const [label, payload] of payloads) {
    const { status, body } = await putAsAdmin(payload);
    expect(status, label).toBe(400);
    expect(body, label).toEqual({
      error: "A valid action and reason are required",
    });
  }
  expect(fakeDb.reads).toEqual(new Array(payloads.length).fill("users"));
  expect(fakeDb.writes).toEqual([]);
});
test("refuses a suspension whose days are not a whole 1..365", async () => {
  for (const days of [0, 366, 7.5, "7", undefined, null]) {
    const { status, body } = await putAsAdmin({
      userId: target,
      action: "suspend",
      days,
      reason: "repeated abuse",
    });
    expect(status, String(days)).toBe(400);
    expect(body, String(days)).toEqual({
      error: "Suspension must be between 1 and 365 days",
    });
  }
  // The target is never read, so a day count cannot reach a write.
  expect(fakeDb.reads).toEqual(new Array(6).fill("users"));
  expect(fakeDb.writes).toEqual([]);
});
test("answers 404 for a target that is no longer there", async () => {
  asAdmin().selectReturns(users, []);
  const response = await PUT(
    request({ userId: target, action: "ban", reason: "spam" }),
  );
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ error: "Member not found" });
  // No restriction cleared, none written, no audit row.
  expect(fakeDb.deletes).toEqual([]);
  expect(fakeDb.writes).toEqual([]);
});
test("answers 500 when the member directory cannot be read", async () => {
  fakeDb.failNextSelect(users, new Error("database unavailable"));
  const response = await GET(new Request("http://localhost/api/admin/users"));
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: "Unable to load members" });
});
test("answers 500 when a restriction cannot be written", async () => {
  fakeDb
    .selectReturns(users, [{ role: "admin" }])
    .selectReturns(users, [{ role: "member" }])
    .failNextInsert(accountRestrictions, new Error("database unavailable"));
  const response = await PUT(
    request({ userId: target, action: "ban", reason: "spam" }),
  );
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({
    error: "Unable to update account restriction",
  });
  // The failed insert was not recorded; no audit row followed it.
  expect(fakeDb.writes).toEqual([]);
});
