import { beforeEach, expect, test, vi } from "vitest";
vi.mock("@/lib/db", async () => ({ db: (await import("@/test/fake-db")).fakeDb }));
const auth = vi.hoisted(() => ({ id: "employer" as string | null }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: async () => auth.id ? { user: { id: auth.id } } : null } } }));
import { fakeDb, resetFakeDb } from "@/test/fake-db";
import { jobPublications } from "@/lib/db/schema";
import { GET } from "./route";
beforeEach(() => { resetFakeDb(); auth.id = "employer"; });
test("job quotas cannot be inspected while signed out", async () => { auth.id = null; expect((await GET(new Request("https://app.test/api/jobs/entitlements"))).status).toBe(401); });
test("ten lifetime approvals exhaust free publications without paid access", async () => {
  fakeDb.selectReturns(jobPublications, [{ total: 10 }]);
  const response = await GET(new Request("https://app.test/api/jobs/entitlements"));
  expect((await response.json())).toMatchObject({ freeRemaining: 0, paidRemaining: 0, paidPeriodActive: false });
  expect(fakeDb.selectParams.some(params => params.includes("employer"))).toBe(true);
});
