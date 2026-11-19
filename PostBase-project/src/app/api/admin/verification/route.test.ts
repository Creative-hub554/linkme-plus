import { beforeEach, expect, test, vi } from "vitest";
vi.mock("@/lib/db", async () => ({ db: (await import("@/test/fake-db")).fakeDb }));
const auth = vi.hoisted(() => ({ id: "admin" as string | null }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: async () => auth.id ? { user: { id: auth.id } } : null } } }));
import { fakeDb, resetFakeDb } from "@/test/fake-db";
import { users, verificationRequests, privateEvidence } from "@/lib/db/schema";
import { GET, POST } from "./route";
const id = "11111111-1111-4111-8111-111111111111", evidenceId = "22222222-2222-4222-8222-222222222222";
const request = (body: unknown) => new Request("https://app.test/api/admin/verification", { method: "POST", body: JSON.stringify(body) });
beforeEach(() => { resetFakeDb(); auth.id = "admin"; });
test("ordinary members cannot list or approve identity evidence", async () => {
  fakeDb.selectReturns(users, [{ role: "member" }]).selectReturns(users, [{ role: "member" }]);
  expect((await GET(request(null))).status).toBe(403);
  expect((await POST(request({ id, action: "approve", note: "Checked" }))).status).toBe(403);
  expect(fakeDb.writes).toEqual([]);
});
test("administrators cannot verify their own identity", async () => {
  fakeDb.selectReturns(users, [{ role: "admin" }]);
  fakeDb.selectReturns(verificationRequests, [{ id, userId: "admin", verificationKind: "national_id" }]);
  expect((await POST(request({ id, action: "approve", note: "Checked" }))).status).toBe(403);
  expect(fakeDb.writes).toEqual([]);
});
test("a private human review records a decision and 30-day evidence retention", async () => {
  const row = { id, userId: "member", status: "pending", privateEvidenceIds: [evidenceId], verificationKind: "national_id" };
  fakeDb.selectReturns(users, [{ role: "admin" }]).selectReturns(users, [{ id: "member" }]);
  fakeDb.selectReturns(verificationRequests, [row]).selectReturns(verificationRequests, [row]);
  fakeDb.selectReturns(privateEvidence, [{ id: evidenceId }]);
  const before = Date.now();
  expect((await POST(request({ id, action: "approve", note: "Document reviewed privately" }))).status).toBe(200);
  expect(fakeDb.writes.find(write => write.table === "verification_requests")?.values).toMatchObject({ status: "approved", reviewedBy: "admin" });
  const deadline = fakeDb.writes.find(write => write.table === "private_evidence")?.values.deleteAfter as Date;
  expect(deadline.getTime()).toBeGreaterThanOrEqual(before + 30 * 86400000);
  expect(fakeDb.writes.find(write => write.table === "audit_logs")?.values.metadata).not.toHaveProperty("evidenceUrls");
});
