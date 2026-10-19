// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanupSurfaces, mountSurface } from "@/test/render";
import { AdminModeration } from "@/components/admin/admin-moderation";

/**
 * The moderation queue rendered over the rows the demo seed holds.
 *
 * The component's own suite stubs the queue with canned JSON (and the decision
 * with a canned 201), so what it pins is what the component does with envelopes
 * nobody computed. This one closes that gap: the real `GET /api/admin/reports`
 * *and* the real `POST /api/admin/moderate` sit behind the component's `fetch`,
 * over a fake database scripted with the seed's demo reports
 * (`src/lib/db/seed.ts`, `trustReportRows`), so what renders — and what a
 * decision changes — is what the *routes* do with the *seed's* rows: the
 * excerpt each reported post and comment carries, the handle each row names,
 * and the reload that follows a suspension, in which the account row is gone
 * from the pending queue because the routes resolved it.
 *
 * The exposed seam is deliberately narrow: the session stub is the same
 * `/lib/auth` seam every route test uses, the fetch dispatch is what the
 * browser does with the page's own requests, and nothing is asserted against
 * canned data.
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
import { POST as moderate } from "@/app/api/admin/moderate/route";
import { reports, users, posts, comments, moderationActions } from "@/lib/db/schema";
import { fakeDb, resetFakeDb } from "@/test/fake-db";
import { expectGatedRead, expectGatedSequence, expectGatedUpdate } from "@/test/expect-gated";

/** The account the console grant elevated — the session's one id. */
const ADMIN_ID = "77000000-0000-4000-8000-000000000001";

// The seeded queue, exactly as `trustReportRows` writes it: a post report and a
// comment report judged as content — its target is commentId(10, one of the
// replies the seed's reply loop writes — and the account report the queue renders
// with Suspend and Ban. The ids are the seed's deterministic ones, so the words
// below are the row's words.
const pendingRows = [
  {
    id: "91000000-0000-4000-8000-000000000001",
    reporterId: "10000000-0000-4000-8000-000000000006",
    targetType: "post",
    targetId: "31000000-0000-4000-8000-000000000002",
    reason: "Spam",
    description: "Pushes crypto links that keep returning under new names.",
    status: "pending",
    createdAt: "2026-10-10T17:00:00.000Z",
  },
  {
    id: "91000000-0000-4000-8000-000000000002",
    reporterId: "10000000-0000-4000-8000-000000000004",
    targetType: "comment",
    targetId: "33000000-0000-4000-8000-000000000010",
    reason: "Harassment",
    description: "Keeps hounding the author from thread to thread.",
    status: "pending",
    createdAt: "2026-10-12T17:00:00.000Z",
  },
  {
    id: "91000000-0000-4000-8000-000000000003",
    reporterId: "10000000-0000-4000-8000-000000000005",
    targetType: "user",
    targetId: "10000000-0000-4000-8000-000000000006",
    reason: "Harassment",
    description: "The account itself: a pattern across messages, not one post.",
    status: "pending",
    createdAt: "2026-10-15T15:00:00.000Z",
  },
];

const POST_TARGET = pendingRows[0].targetId;
const POST_AUTHOR = "10000000-0000-4000-8000-000000000003";
const COMMENT_TARGET = pendingRows[1].targetId;
const MEMBER_6 = pendingRows[2].targetId;
const ACCOUNT_REPORT_ID = pendingRows[2].id;

const fetchMock = vi.fn();

/** The sentence the reason box is filled with before the decision is sent. */
const REASON = "Confirmed: the pattern holds across messages, not one post.";

/**
 * The one queue load the mount makes, scripted at the table the way the fake
 * answers: the role read, the pending filter, its count, and the enrichment —
 * the reported post, the reported reply, then the two members the summaries
 * name (the reported account, and the author both rows' content carries).
 */
function scriptFlow() {
  const role = [{ id: ADMIN_ID, role: "admin" }];
  const names = [
    { id: MEMBER_6, username: "sofia_photographs" },
    { id: POST_AUTHOR, username: "jordan_builds" },
  ];
  const postRow = [{ id: POST_TARGET, content: "Same coin links in every thread today.", authorId: POST_AUTHOR }];
  const commentRow = [{ id: COMMENT_TARGET, content: "Reply guy again, thread after thread.", authorId: POST_AUTHOR }];
  fakeDb
    .selectReturns(users, role)
    .selectReturns(reports, pendingRows)
    .selectReturns(reports, [{ total: 3 }])
    .selectReturns(posts, postRow)
    .selectReturns(comments, commentRow)
    .selectReturns(users, names)
    // The suspension: the role read, the report it judges, the action row the
    // route makes out of it.
    .selectReturns(users, role)
    .selectReturns(reports, [pendingRows[2]])
    .insertReturns(moderationActions, [{ id: "action-1", action: "suspension", targetType: "user", targetId: MEMBER_6 }])
    // The reload the dashboard makes after its decision: two rows, because the
    // account report was just resolved.
    .selectReturns(users, role)
    .selectReturns(reports, [pendingRows[0], pendingRows[1]])
    .selectReturns(reports, [{ total: 2 }])
    .selectReturns(posts, postRow)
    .selectReturns(comments, commentRow)
    .selectReturns(users, names);
}

beforeEach(() => {
  resetFakeDb();
  scriptFlow();
  session.userId = ADMIN_ID;
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    // A decision goes to the moderate route with the body as it was sent —
    // the real handler reads it, writes it, resolves the report, via the
    // same scripting the reload is answered from.
    if (url.pathname === "/api/admin/moderate") {
      return await moderate(
        new Request(url.toString(), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: init?.body as string,
        }),
      );
    }
    // The queue's own request; anything else is a fetch the component has
    // grown, and this suite wants to hear about it.
    expect(url.pathname).toBe("/api/admin/reports");
    expect(init?.method ?? "GET").toBe("GET");
    return await listReports(new Request(url.toString(), { method: "GET" }));
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanupSurfaces();
  vi.unstubAllGlobals();
});

test("renders the seeded queue with the route's excerpts and author handles", async () => {
  const ui = mountSurface(<AdminModeration />, { providers: "none" });
  await ui.waitFor(
    () => ui.container.textContent?.includes("sofia_photographs") === true,
    { description: "the account row to name its member" },
  );

  const text = ui.container.textContent ?? "";

  // The reported posts' and comment's words — the excerpts the route plucked
  // from the rows behind the report — sit inside the row's quote, and both
  // content rows name the author the route resolved.
  expect(text).toContain("Same coin links in every thread today.");
  expect(text).toContain("Reply guy again, thread after thread.");
  expect(text).toContain("@jordan_builds");

  // The account row has no target text to quote (nothing is written on it),
  // and carries the account itself as the handle the decision is about.
  expect(text).toContain("The account itself: a pattern across messages, not one post.");
  expect(text).toContain("@sofia_photographs");

  // The dashboards' own split: the two content rows under the content
  // section's offer (Warn and Remove content), the account under its section
  // with Suspend and Ban.
  expect(text).toContain("Reported content — posts and comments");
  expect(text).toContain("Reported accounts");
  const buttons = [...ui.container.querySelectorAll("button")].map((b) => b.textContent?.trim());
  expect(buttons).toContain("Warn");
  expect(buttons).toContain("Remove content");
  expect(buttons).toContain("Suspend");
  expect(buttons).toContain("Ban");

  // Nothing else fetched: the mount made exactly the one queue request.
  expect(fetchMock.mock.calls).toHaveLength(1);

  // …and that request was the pending filter, not the whole table.
  expectGatedRead(reports, { where: '"status" = $1', params: ["pending"] });
});

test("records a suspension through the dashboard, and the reload drops the account row", async () => {
  const ui = mountSurface(<AdminModeration />, { providers: "none" });
  await ui.waitFor(
    () => ui.container.textContent?.includes("sofia_photographs") === true,
    { description: "the account row to name its member" },
  );

  // The account row's decision buttons live in the accounts section; the
  // presser opens the reason box by choosing Suspend, exactly a moderator's
  // click-through does.
  const banSection = [...ui.container.querySelectorAll("section")].find((section) =>
    section.textContent?.includes("Reported accounts"),
  )!;
  const suspend = [...banSection.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Suspend")!;
  await ui.click(suspend);

  // The reason box opens empty: a stale sentence from the previous row must
  // not ride along, and the decision cannot be recorded without a reason.
  const field = banSection.querySelector<HTMLTextAreaElement>("textarea")!;
  expect(field.value).toBe("");
  const record = [...banSection.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Record decision")!;
  expect(record.hasAttribute("disabled")).toBe(true);

  await ui.type(field, REASON);
  await ui.click(record);

  // The decision is sent, the queue is re-fetched, and the account row is
  // gone from the rendered pending list — the resolved report no longer
  // rides in a list that says pending.
  await ui.waitFor(
    () => ui.container.textContent?.includes("No pending account reports.") === true,
    { description: "the reload to show the accounts section emptied" },
  );
  const text = ui.container.textContent ?? "";
  expect(text).not.toContain("The account itself: a pattern across messages, not one post.");
  expect(text).not.toContain("@sofia_photographs");
  // The two content rows the suspension did not touch still sit in the queue.
  expect(text).toContain("Same coin links in every thread today.");
  expect(text).toContain("Reply guy again, thread after thread.");

  // The dashboard's own honesty about what it sends: the account report's id,
  // the suspension its kind offers, and the sentence typed — nothing more.
  const sent = fetchMock.mock.calls
    .map(([, init]) => init as RequestInit | undefined)
    .find((init) => init?.method === "POST");
  expect(JSON.parse(String(sent?.body))).toEqual({
    reportId: ACCOUNT_REPORT_ID,
    action: "suspension",
    reason: REASON,
  });

  // And the chain the sent decision made, read back through the routes: the
  // action row naming the member, the report resolved, the audit trail —
  // exactly what the route-level smoke pins, now reached from the presser's
  // click instead of a scripted call.
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
  expectGatedUpdate(reports, { where: '"reports"."id" = $1', params: [ACCOUNT_REPORT_ID] });
});
