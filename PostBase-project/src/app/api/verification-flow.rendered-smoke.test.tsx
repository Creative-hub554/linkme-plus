// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanupSurfaces, mountSurface } from "@/test/render";
import { VerificationApplication } from "@/components/settings/verification-application";
import { AdminVerificationRequests } from "@/components/admin/admin-verification-requests";

vi.mock("@/lib/db", async () => ({ db: (await import("@/test/fake-db")).fakeDb }));
const session = vi.hoisted(() => ({ userId: "" as string | null }));
vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: async () => session.userId ? { user: { id: session.userId } } : null,
    },
  },
}));

import { GET as getMemberRequest, POST as submitMemberRequest } from "@/app/api/verification-requests/route";
import { GET as getReviewQueue, PATCH as reviewRequest } from "@/app/api/admin/verification-requests/route";
import { auditLogs, users, verificationRequests } from "@/lib/db/schema";
import { fakeDb, resetFakeDb } from "@/test/fake-db";

const MEMBER_ID = "55555555-5555-4555-8555-555555555555";
const ADMIN_ID = "66666666-6666-4666-8666-666666666666";
const REQUEST_ID = "44444444-4444-4444-8444-444444444444";
const EVIDENCE_URL = "https://public.example/author";

const fetchMock = vi.fn();

function routeRequest(input: RequestInfo | URL, init?: RequestInit) {
  const url = new URL(String(input), "http://localhost");
  const request = new Request(url, {
    method: init?.method ?? "GET",
    headers: init?.headers,
    ...(init?.body === undefined ? {} : { body: init.body as BodyInit }),
  });
  if (url.pathname === "/api/verification-requests") {
    return request.method === "POST" ? submitMemberRequest(request) : getMemberRequest(request);
  }
  if (url.pathname === "/api/admin/verification-requests") {
    return request.method === "PATCH" ? reviewRequest(request) : getReviewQueue(request);
  }
  throw new Error(`Unexpected fetch from verification flow: ${url.pathname}`);
}

function scriptDatabaseFlow() {
  // Reads are queued in the order the UI and route handlers make them: member
  // status, submission eligibility, post-submit status, reviewer gate, reviewer
  // gate for approval, then the member's final verified status.
  fakeDb
    .selectReturns(users, [{ verified: false }])
    .selectReturns(users, [{ verified: false }])
    .selectReturns(users, [{ verified: false }])
    .selectReturns(users, [{ role: "admin" }])
    .selectReturns(users, [{ role: "admin" }])
    .selectReturns(users, [{ role: "admin" }])
    .selectReturns(users, [{ verified: true }]);

  // No request before submission, then pending status/queue/decision, then an
  // empty pending queue and the approved status on the member's final reload.
  fakeDb
    .selectReturns(verificationRequests, [])
    .selectReturns(verificationRequests, [])
    .selectReturns(verificationRequests, [{
      id: REQUEST_ID,
      evidenceUrls: [EVIDENCE_URL],
      status: "pending",
      reviewNote: null,
      createdAt: new Date("2026-10-17T12:00:00.000Z"),
    }])
    .selectReturns(verificationRequests, [{
      id: REQUEST_ID,
      userId: MEMBER_ID,
      username: "maya",
      displayName: "Maya Chen",
      evidenceUrls: [EVIDENCE_URL],
      status: "pending",
      createdAt: new Date("2026-10-17T12:00:00.000Z"),
    }])
    .selectReturns(verificationRequests, [{ total: 1 }])
    .selectReturns(verificationRequests, [{ id: REQUEST_ID, userId: MEMBER_ID }])
    .selectReturns(verificationRequests, [])
    .selectReturns(verificationRequests, [{ total: 0 }])
    .selectReturns(verificationRequests, [{
      id: REQUEST_ID,
      evidenceUrls: [EVIDENCE_URL],
      status: "approved",
      reviewNote: null,
      createdAt: new Date("2026-10-17T12:00:00.000Z"),
    }]);

  fakeDb
    .insertReturns(verificationRequests, [{ id: REQUEST_ID, status: "pending", createdAt: new Date("2026-10-17T12:00:00.000Z") }])
    .updateReturns(verificationRequests, [{ id: REQUEST_ID, userId: MEMBER_ID, status: "approved" }])
    .updateReturns(users, [{ id: MEMBER_ID, verified: true }])
    .insertReturns(auditLogs, [{ id: "audit-1" }]);
}

beforeEach(() => {
  resetFakeDb();
  scriptDatabaseFlow();
  session.userId = MEMBER_ID;
  fetchMock.mockReset();
  fetchMock.mockImplementation(routeRequest);
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanupSurfaces();
  vi.unstubAllGlobals();
});

test("an authenticated member submits public evidence and an admin approves it", async () => {
  const member = mountSurface(<VerificationApplication />, { providers: "none" });
  await member.waitFor(
    () => member.container.querySelector('input[aria-label="Public verification link 1"]') !== null,
    { description: "the member application form" },
  );
  const evidenceInput = member.container.querySelector<HTMLInputElement>(
    'input[aria-label="Public verification link 1"]',
  );
  if (!evidenceInput) throw new Error("The member application form did not render");
  await member.type(evidenceInput, EVIDENCE_URL);
  const submit = [...member.container.querySelectorAll("button")]
    .find((button) => button.textContent?.includes("Submit for review"));
  if (!submit) throw new Error("The member application submit button did not render");
  await member.click(submit);
  await member.waitFor(
    () => member.container.textContent?.includes("under review") === true,
    { description: "the submitted application status" },
  );
  expect(member.container.querySelector(`a[href="${EVIDENCE_URL}"]`)).not.toBeNull();
  expect(fakeDb.writes[0]).toEqual({
    table: "verification_requests",
    values: { userId: MEMBER_ID, evidenceUrls: [EVIDENCE_URL], status: "pending" },
  });

  member.unmount();
  session.userId = ADMIN_ID;
  const admin = mountSurface(<AdminVerificationRequests />, { providers: "none" });
  await admin.waitFor(
    () => admin.container.textContent?.includes("Maya Chen") === true,
    { description: "the applicant in the admin review queue" },
  );
  expect(admin.container.querySelector(`a[href="${EVIDENCE_URL}"]`)).not.toBeNull();
  const approve = [...admin.container.querySelectorAll("button")]
    .find((button) => button.textContent?.trim() === "Approve verification");
  if (!approve) throw new Error("The admin approval control did not render");
  await admin.click(approve);
  await admin.waitFor(
    () => admin.container.textContent?.includes("No verification requests are waiting for review.") === true,
    { description: "the approved request to leave the pending queue" },
  );
  expect(fakeDb.writes.map(({ table }) => table)).toEqual([
    "verification_requests",
    "verification_requests",
    "users",
    "audit_logs",
  ]);
  expect(fakeDb.writes[1]).toMatchObject({
    table: "verification_requests",
    values: { status: "approved", reviewedBy: ADMIN_ID },
  });
  expect(fakeDb.writes[2]).toEqual({ table: "users", values: { verified: true } });
  expect(fakeDb.writes[3]).toMatchObject({
    table: "audit_logs",
    values: { actorId: ADMIN_ID, action: "verification.approved", targetId: MEMBER_ID },
  });

  admin.unmount();
  session.userId = MEMBER_ID;
  const approvedStatus = mountSurface(<VerificationApplication />, { providers: "none" });
  await approvedStatus.waitFor(
    () => approvedStatus.container.textContent?.includes("Your account is verified.") === true,
    { description: "the member's approved verified status" },
  );
  expect(approvedStatus.container.querySelector("form")).toBeNull();
  expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
    "/api/verification-requests",
    "/api/verification-requests",
    "/api/verification-requests",
    "/api/admin/verification-requests",
    "/api/admin/verification-requests",
    "/api/admin/verification-requests",
    "/api/verification-requests",
  ]);
});
