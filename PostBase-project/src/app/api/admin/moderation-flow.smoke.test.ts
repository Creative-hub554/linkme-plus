import { beforeEach, expect, it, vi } from "vitest";

/**
 * The moderation flow, end to end, against the rows the demo seed holds.
 *
 * This is the walk a real admin takes and the other two suites only stand
 * beside: the reports route (`GET /api/admin/reports`) and the moderate route
 * (`POST /api/admin/moderate`) are the real handlers, chained in one flow —
 * list the pending queue, read it as the dashboard would, record a suspension
 * on the account report, and list the queue again to see the decision move the
 * report out of it.
 *
 * The rows handed to the fake are the seed's own demo shapes (`src/lib/db/
 * seed.ts` holds them under `trustReportRows`): three pending reports — a post,
 * a comment, and the account report the queue renders with Suspend and Ban —
 * named by their seeded ids. `npm run admin:grant -- <email>` is the only thing
 * that makes an account an admin, and the smoke scripts exactly that outcome:
 * the session belongs to a granted account, whose `users` row carries
 * `role: "admin"`.
 *
 * The fake `@/lib/db` answers reads in the order the routes make them, so the
 * queue is scripted across the whole flow — three reads return the seated
 * queue's rows and count, the fourth returns only the two the suspension left
 * — and the writes are read back as the full chain one suspension makes: the
 * action row naming the demo member, the report resolved, the audit row.
 */
vi.mock("@/lib/db", async () => {
  const { fakeDb } = await import("@/test/fake-db");
  return {
    db: fakeDb,
    withDbRetry: (operation: () => unknown) => operation(),
  };
});

const session = vi.hoisted(() => ({ userId: "" as string | null }));

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: async () => (session.userId ? { user: { id: session.userId } } : null),
    },
  },
}));

import { GET as listReports } from "@/app/api/admin/reports/route";
import { POST as moderate } from "./moderate/route";
import { reports, users, posts, comments, moderationActions } from "@/lib/db/schema";
import { fakeDb, resetFakeDb } from "@/test/fake-db";
import { expectGatedNone, expectGatedRead, expectGatedSequence, expectGatedUpdate } from "@/test/expect-gated";

/** The account the console grant elevated — the session's one id throughout. */
const ADMIN_ID = "77000000-0000-4000-8000-000000000001";

// The seeded queue's three pending rows, exactly as `trustReportRows` holds
// them: the post and comment reports judged as content, the account report
// judged as a member. The member ids are the demo cast's, the target ids the
// seed's deterministic edges — the comment report names commentId(10), one of
// the replies the seed's reply loop writes — so the words `@sofia_photographs`
// below are the same handle the queue shows on a seeded database.
const POST_REPORT_ID = "91000000-0000-4000-8000-000000000001";
const COMMENT_REPORT_ID = "91000000-0000-4000-8000-000000000002";
const ACCOUNT_REPORT_ID = "91000000-0000-4000-8000-000000000003";

/** The reported account: the demo member the seeded account report names. */
const MEMBER_6 = "10000000-0000-4000-8000-000000000006";
const MEMBER_3_POST = "31000000-0000-4000-8000-000000000002";
const MEMBER_3_ID = "10000000-0000-4000-8000-000000000003";
const REPLIED_COMMENT = "33000000-0000-4000-8000-000000000010";

const pendingRows = [
  {
    id: POST_REPORT_ID,
    reporterId: MEMBER_6,
    targetType: "post",
    targetId: MEMBER_3_POST,
    reason: "Spam",
    description: "Pushes crypto links that keep returning under new names.",
    status: "pending",
    createdAt: "2026-10-10T17:00:00.000Z",
  },
  {
    id: COMMENT_REPORT_ID,
    reporterId: "10000000-0000-4000-8000-000000000004",
    targetType: "comment",
    targetId: REPLIED_COMMENT,
    reason: "Harassment",
    description: "Keeps hounding the author from thread to thread.",
    status: "pending",
    createdAt: "2026-10-12T17:00:00.000Z",
  },
  {
    id: ACCOUNT_REPORT_ID,
    reporterId: "10000000-0000-4000-8000-000000000005",
    targetType: "user",
    targetId: MEMBER_6,
    reason: "Harassment",
    description: "The account itself: a pattern across messages, not one post.",
    status: "pending",
    createdAt: "2026-10-15T15:00:00.000Z",
  },
];

const REASON = "Confirmed: the pattern holds across messages, not one post.";

function list(path: string) {
  return new Request(`http://localhost${path}`, { method: "GET" });
}

function decide(body: unknown) {
  return new Request("http://localhost/api/admin/moderate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/**
 * Scripts the whole flow's reads in the order the two routes make them:
 * the seated queue, its count, the suspension's reads, then the queue as the
 * dashboard re-fetches it — two rows, because one was just resolved.
 */
function scriptFlow() {
  const role = [{ id: ADMIN_ID, role: "admin" }];
  fakeDb
    .selectReturns(users, role)
    .selectReturns(reports, pendingRows)
    .selectReturns(reports, [{ total: 3 }])
    .selectReturns(posts, [{ id: MEMBER_3_POST, content: "Same coin links in every thread today.", authorId: MEMBER_3_ID }])
    .selectReturns(comments, [{ id: REPLIED_COMMENT, content: "Reply guy again, thread after thread.", authorId: MEMBER_3_ID }])
    .selectReturns(users, [
      { id: MEMBER_6, username: "sofia_photographs" },
      { id: MEMBER_3_ID, username: "jordan_builds" },
    ])
    // The suspension: the role read, then the report it judges, and the action
    // row the route makes out of it.
    .selectReturns(users, role)
    .selectReturns(reports, [pendingRows[2]])
    .insertReturns(moderationActions, [{ id: "action-1", action: "suspension", targetType: "user", targetId: MEMBER_6 }])
    // The re-fetched queue: the account row is out of it, resolved.
    .selectReturns(users, role)
    .selectReturns(reports, [pendingRows[0], pendingRows[1]])
    .selectReturns(reports, [{ total: 2 }])
    .selectReturns(posts, [{ id: MEMBER_3_POST, content: "Same coin links in every thread today.", authorId: MEMBER_3_ID }])
    .selectReturns(comments, [{ id: REPLIED_COMMENT, content: "Reply guy again, thread after thread.", authorId: MEMBER_3_ID }])
    .selectReturns(users, [
      { id: MEMBER_6, username: "sofia_photographs" },
      { id: MEMBER_3_ID, username: "jordan_builds" },
    ]);
}

beforeEach(() => {
  resetFakeDb();
  scriptFlow();
  session.userId = ADMIN_ID;
});

/** The queue as the dashboard reads it: fields it does not render stay out of the claim. */
function expectQueueRows(
  payload: { data: Record<string, unknown>[]; pagination: { total: number } },
  rows: { id: string; targetType: string; reason: string; status: string; targetContent: string | null; targetAuthor: string | null }[],
) {
  expect(
    payload.data.map((row) => ({
      id: row["id"],
      targetType: row["targetType"],
      reason: row["reason"],
      status: row["status"],
      targetContent: row["targetContent"] ?? null,
      targetAuthor: row["targetAuthor"] ?? null,
    })),
  ).toEqual(rows);
}

it("asks who is calling before it opens the queue", async () => {
  session.userId = null;

  const response = await listReports(list("/api/admin/reports?status=pending"));

  expect(response.status).toBe(401);
  expectGatedNone("reads");
  expectGatedNone("writes");
});

it("walks the queue, records a suspension on the account report, and drains it", async () => {
  // 1 — the pending queue, exactly as the seeded database seats it.
  const before = await listReports(list("/api/admin/reports?status=pending"));
  expect(before.status).toBe(200);
  const queue = (await before.json()) as { data: Record<string, unknown>[]; pagination: { total: number } };
  expect(queue.pagination).toEqual({ total: 3, page: 1, limit: 20, totalPages: 1, hasMore: false });
  expectQueueRows(queue, [
    { id: POST_REPORT_ID, targetType: "post", reason: "Spam", status: "pending", targetContent: "Same coin links in every thread today.", targetAuthor: "@jordan_builds" },
    { id: COMMENT_REPORT_ID, targetType: "comment", reason: "Harassment", status: "pending", targetContent: "Reply guy again, thread after thread.", targetAuthor: "@jordan_builds" },
    { id: ACCOUNT_REPORT_ID, targetType: "user", reason: "Harassment", status: "pending", targetContent: null, targetAuthor: "@sofia_photographs" },
  ]);
  // The pending filter — a suspended or dismissed report does not ride along.
  expectGatedRead(reports, { where: '"status" = $1', params: ["pending"] });

  // 2 — the decision, made on the account report exactly as the dashboard
  // sends it: the report's id, the action its kind offers, and the reason the
  // presser wrote.
  const decision = await moderate(
    decide({ reportId: ACCOUNT_REPORT_ID, action: "suspension", reason: REASON }),
  );
  expect(decision.status).toBe(201);
  expect(await decision.json()).toEqual({
    action: { id: "action-1", action: "suspension", targetType: "user", targetId: MEMBER_6 },
  });

  // The full chain one suspension writes, in one order: the action row naming
  // the demo member and the session actor (the granted admin), the report
  // resolved, and the audit trail `moderation.suspension`.
  expectGatedSequence("writes", [
    {
      table: "moderation_actions",
      values: {
        targetType: "user",
        targetId: MEMBER_6,
        actorId: ADMIN_ID,
        action: "suspension",
        reason: REASON,
      },
    },
    { table: "reports", values: { status: "resolved" } },
    {
      table: "audit_logs",
      values: {
        actorId: ADMIN_ID,
        action: "moderation.suspension",
        targetType: "user",
        targetId: MEMBER_6,
        metadata: { reportId: ACCOUNT_REPORT_ID, reason: REASON },
      },
    },
  ]);
  // The status change is the report's own row, and only a still-pending one.
  expectGatedUpdate(reports, { where: '"reports"."id" = $1', params: [ACCOUNT_REPORT_ID] });

  // 3 — the queue, re-fetched as the dashboard reloads it: the suspended
  // report is gone from pending, and the two content reports remain.
  const after = await listReports(list("/api/admin/reports?status=pending"));
  expect(after.status).toBe(200);
  const drained = (await after.json()) as { data: Record<string, unknown>[]; pagination: { total: number } };
  expect(drained.pagination).toEqual({ total: 2, page: 1, limit: 20, totalPages: 1, hasMore: false });
  expectQueueRows(drained, [
    { id: POST_REPORT_ID, targetType: "post", reason: "Spam", status: "pending", targetContent: "Same coin links in every thread today.", targetAuthor: "@jordan_builds" },
    { id: COMMENT_REPORT_ID, targetType: "comment", reason: "Harassment", status: "pending", targetContent: "Reply guy again, thread after thread.", targetAuthor: "@jordan_builds" },
  ]);
});
