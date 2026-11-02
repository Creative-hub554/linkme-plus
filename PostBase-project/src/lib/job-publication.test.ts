import { beforeEach, expect, test, vi } from "vitest";
vi.mock("@/lib/db", async () => ({ db: (await import("@/test/fake-db")).fakeDb }));
import { monthlyBillingPeriod, jobReviewFlags, approveJob } from "./job-publication";
import { fakeDb, resetFakeDb } from "@/test/fake-db";
import { jobs, jobPublications, privateEvidence, accountSubscriptions } from "@/lib/db/schema";
beforeEach(resetFakeDb);
const job = () => ({ id: "11111111-1111-4111-8111-111111111111", publisherId: "publisher", deadline: new Date(Date.now() + 86400000), officeEvidenceIds: ["22222222-2222-4222-8222-222222222222"], firstPublishedAt: null } as typeof jobs.$inferSelect);
const tx = () => fakeDb as unknown as Parameters<typeof approveJob>[0];
function evidence() { fakeDb.selectReturns(privateEvidence, [{ id: "22222222-2222-4222-8222-222222222222", width: 500, height: 500 }]); }
test("monthly credits follow the original billing day, including shorter months", () => {
  const anchor = new Date("2026-01-31T10:00:00Z");
  expect(monthlyBillingPeriod(anchor, new Date("2026-02-28T12:00:00Z"))).toEqual({ start: new Date("2026-02-28T10:00:00Z"), end: new Date("2026-03-31T10:00:00Z") });
  expect(monthlyBillingPeriod(anchor, new Date("2026-03-30T10:00:00Z")).start).toEqual(new Date("2026-02-28T10:00:00Z"));
});
test("identity verification does not bypass missing information, links, or duplicates", () => {
  const flags = jobReviewFlags({ title: "Work", description: "Apply https://example.com", location: "", deadline: new Date("2020-01-01"), duplicate: true });
  expect(flags).toContain("Confirm the employer's job location");
  expect(flags).toContain("A similar active job exists for this company");
  expect(flags).toContain("Review contact links and external destinations");
  expect(jobReviewFlags({ title: "Engineer", description: "Build useful products with our engineering team", location: "Phnom Penh", deadline: new Date(Date.now() + 86400000), duplicate: false })).toEqual([]);
});
test("the tenth approval consumes the last free lifetime credit", async () => {
  evidence(); fakeDb.selectReturns(jobPublications, []).selectReturns(jobPublications, [{ total: 9 }]);
  fakeDb.updateReturns(jobs, [{ id: job().id, status: "active" }]);
  await approveJob(tx(), job(), "reviewer", "Checked");
  expect(fakeDb.writes.find(write => write.table === "job_publications")?.values).toMatchObject({ allowance: "free", publisherId: "publisher" });
});
test("an eleventh unpaid job cannot be published", async () => {
  evidence(); fakeDb.selectReturns(jobPublications, []).selectReturns(jobPublications, [{ total: 10 }]);
  await expect(approveJob(tx(), job(), "reviewer", "Checked")).rejects.toThrow("free job allowance is exhausted");
  expect(fakeDb.writes).toEqual([]);
});
test.each([29, 30])("paid monthly boundary with %s prior paid approvals", async prior => {
  evidence(); fakeDb.selectReturns(jobPublications, []).selectReturns(jobPublications, [{ total: 10 }]).selectReturns(jobPublications, [{ total: prior }]);
  fakeDb.selectReturns(accountSubscriptions, [{ startsAt: new Date(Date.now() - 86400000), expiresAt: new Date(Date.now() + 30 * 86400000) }]);
  if (prior === 30) {
    await expect(approveJob(tx(), job(), "reviewer", "Checked")).rejects.toThrow("available credits"); expect(fakeDb.writes).toEqual([]);
  } else {
    await approveJob(tx(), job(), "reviewer", "Checked");
    expect(fakeDb.writes.find(write => write.table === "job_publications")?.values.allowance).toBe("paid");
  }
});
test("reopening an already published job does not consume another credit", async () => {
  evidence(); fakeDb.selectReturns(jobPublications, [{ id: "publication" }]).selectReturns(jobPublications, [{ total: 10 }]);
  await approveJob(tx(), job(), "reviewer", "Reopened");
  expect(fakeDb.writes.filter(write => write.table === "job_publications")).toEqual([]);
});
