import { beforeEach, expect, test, vi } from "vitest";
vi.mock("@/lib/db", async () => ({ db: (await import("@/test/fake-db")).fakeDb }));
const auth = vi.hoisted(() => ({ id: "admin" as string | null }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: async () => auth.id ? { user: { id: auth.id } } : null } } }));
import { fakeDb, resetFakeDb } from "@/test/fake-db";
import { users, jobs } from "@/lib/db/schema";
import { GET, POST } from "./route";
const id = "11111111-1111-4111-8111-111111111111";
const request = (body: unknown) => new Request("https://app.test/api/admin/jobs", { method: "POST", body: JSON.stringify(body) });
beforeEach(() => { resetFakeDb(); auth.id = "admin"; });
test("ordinary members cannot read the review queue or approve jobs", async () => {
  fakeDb.selectReturns(users, [{ role: "member" }]).selectReturns(users, [{ role: "member" }]);
  expect((await GET(request(null))).status).toBe(403);
  expect((await POST(request({ id, action: "approve", note: "Checked" }))).status).toBe(403);
  expect(fakeDb.writes).toEqual([]);
});
test("repeating an already completed approval does not reserve another credit", async () => {
  const row = { id, publisherId: "publisher", reviewStatus: "approved", pendingRevision: null };
  fakeDb.selectReturns(users, [{ role: "admin" }]).selectReturns(users, [{ id: "publisher" }]);
  fakeDb.selectReturns(jobs, [row]).selectReturns(jobs, [row]);
  const response = await POST(request({ id, action: "approve", note: "Checked" }));
  expect(response.status).toBe(200);
  expect((await response.json()).alreadyApproved).toBe(true);
  expect(fakeDb.writes).toEqual([]);
});
test("rejecting an unpublished job records the reason and audit without publication", async () => {
  const row = { id, publisherId: "publisher", reviewStatus: "pending_review", firstPublishedAt: null };
  fakeDb.selectReturns(users, [{ role: "admin" }]).selectReturns(users, [{ id: "publisher" }]);
  fakeDb.selectReturns(jobs, [row]).selectReturns(jobs, [row]);
  expect((await POST(request({ id, action: "reject", note: "Office evidence did not match employer" }))).status).toBe(200);
  expect(fakeDb.writes.find(write => write.table === "jobs")?.values).toMatchObject({ status: "draft", reviewStatus: "rejected" });
  expect(fakeDb.writes.some(write => write.table === "job_publications")).toBe(false);
});
