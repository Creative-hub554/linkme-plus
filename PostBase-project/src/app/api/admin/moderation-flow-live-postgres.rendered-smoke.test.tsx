// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupSurfaces, mountSurface } from "@/test/render";
import { AdminModeration } from "@/components/admin/admin-moderation";
import { reports, users, posts, comments, moderationActions, auditLogs } from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";

/**
 * The moderation queue, rendered over the live database.
 *
 * The component's own suite answers `fetch` with canned JSON; the fake-based
 * rendered smoke routes the component's calls through the real handlers but
 * stands them on a fake database whose every table is scripted by hand. This
 * one closes the last gap in the chain: the dashboard is mounted in jsdom, its
 * `fetch` is dispatched to the real `GET /api/admin/reports` and
 * `POST /api/admin/moderate`, and *nothing* is scripted — `@/lib/db` is the
 * real module, the reads are Drizzle's own queries and the writes are
 * Postgres executing them. What this pins that no earlier smoke could: the
 * queue the admin sees is the live engine's answer (including `createdAt
 * desc`, whose script touches nothing here), the excerpts on the row are the
 * reported rows' own live words, a decision pressed at the dashboard
 * transactionally lands in `moderation_actions`, and the reload that follows
 * drops the row it resolved from the rendered pending list while the untouched
 * rows ride on.
 *
 * Two run-at-a-time facts are designed in rather than commented in:
 *
 * - The session stays the house seam (`@/lib/auth` mocked, exactly as every
 *   route test does), because auth is a hosted Supabase service, not something
 *   this Postgres branch carries.
 * - This file brings its OWN deterministic ids — one smoke admin, one pending
 *   account report about the seeded member — and deletes every row it made.
 *   The live handler smoke (`src/lib/db/moderation-live-postgres.test.ts`)
 *   drives the *seeded* report ids, and Vitest runs test files in parallel
 *   workers against the same scratch branch; disjoint ids are what let both
 *   run side by side without a shared row resolving under the other's feet.
 *
 * Skipped by default; the live run is
 *
 *   DATABASE_URL=<scratch> SMOKE_LIVE_POSTGRES=1 npx vitest run src/app/api/admin/moderation-flow-live-postgres.rendered-smoke.test.tsx
 */
const LIVE_POSTGRES = process.env.SMOKE_LIVE_POSTGRES === "1" && Boolean(process.env.DATABASE_URL);

const session = vi.hoisted(() => ({ userId: "" as string | null }));

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: async () => (session.userId ? { user: { id: session.userId } } : null),
    },
  },
}));

// Ids owned by this file. The `88000000`/`92000000` blocks are deliberately
// distinct from every other suite's smoke ids: nothing else creates or deletes
// these rows, so concurrent live smokes cannot collide.
const ADMIN_ID = "88000000-0000-4000-8000-000000000001";
const OWN_REPORT_ID = "92000000-0000-4000-8000-000000000001";
// The seeded cast, read-only here: the reported account (the suspension's
// target), and the two seeded content reports whose excerpts the dashboard
// shows. The reports' target ids are read live below, not named here — the
// seed's reply loop maps ids sparse (`commentId(postIndex * 3 +
// replyIndex)`), so which comment ids are written depends on its random
// reply counts. The seed targets only written ones (held by
// `src/test/seed-trust-report-targets.test.ts`), so this smoke reads the
// target's truth either way and asserts the render against whatever the
// database says, without naming it here.
const MEMBER_6 = "10000000-0000-4000-8000-000000000006";
const SEEDED_POST_REPORT_ID = "91000000-0000-4000-8000-000000000001";
const SEEDED_COMMENT_REPORT_ID = "91000000-0000-4000-8000-000000000002";

const REASON = "Confirmed at the dashboard: the pattern is the account itself.";
const DESCRIPTION = "Live rendered smoke: this report exists for the presser to resolve.";

const fetchMock = vi.fn();

function buttonWith(container: HTMLElement, text: string) {
  const button = [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === text);
  if (!button) throw new Error(`no button reading "${text}"`);
  return button;
}

(LIVE_POSTGRES ? describe : describe.skip)("the moderation dashboard against live Postgres", () => {
  // The house teardown convention (`src/test/render.test.ts`'s guard) — even
  // though this file's own `finally` below already cleans up on every path, a
  // mount that somehow outlived it still has its here.
  afterEach(() => {
    cleanupSurfaces();
  });
  it("renders the live queue, records a pressed suspension, and reloads it gone", async () => {
    // Driven dynamically for the same reason the handler smoke is: the default
    // suite's skip must happen without these modules (and their pool) ever loading.
    const dbModule = await import("@/lib/db");
    const db = dbModule.db;
    const { GET: listReports } = await import("@/app/api/admin/reports/route");
    const { POST: moderate } = await import("@/app/api/admin/moderate/route");

    const cleanup: { run: () => Promise<unknown>; note: string }[] = [];
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    try {
      // The grant, then the report this file owns. Both are smoke rows: after
      // the reversed cleanup below, the branch is exactly as the seed made it.
      await db.insert(users).values({
        id: ADMIN_ID,
        email: "smoke.rendered.admin@linkme.plus",
        username: "smoke_rendered_admin",
        role: "admin",
      });
      cleanup.push({ note: "smoke rendered admin", run: async () => db.delete(users).where(eq(users.id, ADMIN_ID)) });
      await db.insert(reports).values({
        id: OWN_REPORT_ID,
        // The reporter is a real seeded member; this file reads the seed and
        // subscribes to no write but its own rows.
        reporterId: MEMBER_6,
        targetType: "user",
        targetId: MEMBER_6,
        reason: "Harassment",
        description: DESCRIPTION,
      });
      cleanup.push({ note: "own report", run: async () => db.delete(reports).where(eq(reports.id, OWN_REPORT_ID)) });
      // `audit_logs.actor_id` has no foreign key, so the audit rows this
      // decision writes are deleted explicitly — they would otherwise be the
      // one thing this file leaves behind it.
      cleanup.push({
        note: "own audit rows",
        run: async () => db.delete(auditLogs).where(eq(auditLogs.actorId, ADMIN_ID)),
      });

      // What the live rows say — the corpus the assertions quote, read before
      // the mount so they are the database's words, not this file's. The
      // seeded reports name their targets; the comments table decides what a
      // comment row can show.
      const [seededPostReport, seededCommentReport] = (
        await db
          .select({ id: reports.id, targetId: reports.targetId })
          .from(reports)
          .where(inArray(reports.id, [SEEDED_POST_REPORT_ID, SEEDED_COMMENT_REPORT_ID]))
      ).sort((a, b) => a.id.localeCompare(b.id));
      const postTargetId = seededPostReport?.targetId;
      const commentTargetId = seededCommentReport?.targetId;
      expect(postTargetId, "the seeded post report this smoke quotes must exist").toBeTruthy();
      expect(commentTargetId, "the seeded comment report this smoke pins must exist").toBeTruthy();

      const [reportedPost] = await db
        .select({ content: posts.content, authorId: posts.authorId })
        .from(posts)
        .where(eq(posts.id, postTargetId as string));
      expect(reportedPost?.content, "the seeded post this smoke quotes must exist").toBeTruthy();
      // May be undefined: the route serves a null summary for any report whose
      // target row is absent — its designed sparse case. The render is
      // asserted against this truth below, whichever way it falls.
      const [reportedComment] = await db
        .select({ content: comments.content })
        .from(comments)
        .where(eq(comments.id, commentTargetId as string));
      const [sofia] = await db.select({ username: users.username }).from(users).where(eq(users.id, MEMBER_6));
      expect(sofia?.username, "the seeded member this smoke reports must exist").toBeTruthy();
      const jordan = reportedPost?.authorId
        ? (
            await db.select({ username: users.username }).from(users).where(eq(users.id, reportedPost.authorId))
          )[0]
        : undefined;
      expect(jordan?.username, "the seeded post author this smoke names must exist").toBeTruthy();

      // The session, once the grant it reads from the database exists.
      session.userId = ADMIN_ID;

      const sofiaHandle = `@${sofia!.username}`;
      const jordanHandle = `@${jordan!.username}`;
      const postWords = reportedPost!.content as string;
      // The comment row's truth, quoted only if the comment exists. When it
      // does not, the route serves null summary fields and the row says so
      // itself — the assertion the fake could never make honest.
      const commentWords = reportedComment?.content ?? null;
      const MISSING_WORDS = "The reported content is no longer available to show.";

      // The dispatch the browser performs: the component's own requests meet
      // the real handlers. A queue GET is served and photographed — the
      // pagination total the component is about to show — and a decision POST
      // goes straight through with the body as sent. Anything else fails
      // loudly: this smoke grew no other request.
      let servedTotal: number | undefined;
      fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input), "http://localhost");
        if (url.pathname === "/api/admin/moderate") {
          return await moderate(
            new Request(url.toString(), {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: init?.body as string,
            }),
          );
        }
        expect(url.pathname).toBe("/api/admin/reports");
        expect(init?.method ?? "GET").toBe("GET");
        const response = await listReports(new Request(url.toString(), { method: "GET" }));
        const payload = (await response.clone().json()) as { pagination?: { total?: number } };
        servedTotal = payload.pagination?.total;
        return response;
      });

      // ── the mount: the queue the live engine serves ─────────────────────
      const surface = mountSurface(<AdminModeration />, { providers: "none" });
      await surface.waitFor(
        () => surface.container.textContent?.includes(DESCRIPTION) ?? false,
        { description: "the rendered queue to show this file's own report" },
      );

      const text = surface.container.textContent ?? "";

      // The content rows carry what the live database has: the post's own
      // words and its author's handle, and either the comment row's words or
      // the row's own admission that the comment behind it is gone — read
      // from the comments table, not assumed from the report.
      expect(text).toContain(postWords);
      expect(text).toContain(jordanHandle);
      if (commentWords) {
        expect(text).toContain(commentWords);
      } else {
        expect(text).toContain(MISSING_WORDS);
      }

      // The account row names the reported account itself — the handle the
      // suspension decision is about.
      expect(text).toContain(sofiaHandle);

      // The dashboard's own split, with each kind's offered actions.
      expect(text).toContain("Reported content — posts and comments");
      expect(text).toContain("Reported accounts");
      expect(buttonWith(surface.container, "Warn")).toBeTruthy();
      expect(buttonWith(surface.container, "Remove content")).toBeTruthy();
      expect(buttonWith(surface.container, "Suspend")).toBeTruthy();
      expect(buttonWith(surface.container, "Ban")).toBeTruthy();

      // The footer tells the truth about the queue it was served: the number
      // it renders is the one its own response carried — computed by the live
      // count query. Read from the captured envelope rather than re-queried
      // here, so the assertion cannot be flattered by whatever a concurrent
      // smoke did to a seeded row between two reads.
      expect(servedTotal, "the dispatch captured the served pagination total").toEqual(expect.any(Number));
      expect(text).toContain(`${Number(servedTotal).toLocaleString()} pending`);

      // Exactly the one request so far: the queue load. The press below sends
      // the second and the reload the third, and the count is asserted again
      // at the end, so a grown request cannot hide inside the total.
      expect(fetchMock.mock.calls).toHaveLength(1);

      // ── the press: this file's own row, Suspend, reason, confirm ────────
      // Scoping to the row's own `li` is what makes the press the right one:
      // the seeded account report is on the same board, as a live row, and
      // reaching across the section would press whichever came first.
      const ownRow = [...surface.container.querySelectorAll("li")].find((li) =>
        li.textContent?.includes(DESCRIPTION),
      );
      if (!ownRow) throw new Error("the rows' list no longer contains this smoke's own report");
      await surface.click(buttonWith(ownRow as HTMLElement, "Suspend"));

      // The reason box opens empty: a stale sentence from the other rows must
      // not ride along, and the decision cannot be recorded without one.
      const field = ownRow.querySelector<HTMLTextAreaElement>("textarea")!;
      expect(field.value).toBe("");
      const record = buttonWith(ownRow as HTMLElement, "Record decision");
      expect(record.hasAttribute("disabled")).toBe(true);
      await surface.type(field, REASON);
      await surface.click(record);

      // The reload the dashboard makes itself: the resolved report leaves the
      // rendered pending list, and the two untouched content rows ride on.
      await surface.waitFor(
        () => surface.container.textContent?.includes(DESCRIPTION) === false,
        { description: "the reload to drop the resolved report" },
      );
      const after = surface.container.textContent ?? "";
      expect(after).not.toContain(DESCRIPTION);
      expect(after).toContain(postWords);
      expect(after).toContain(commentWords ?? MISSING_WORDS);

      // The flow's full request budget, now spent: one queue load, one
      // decision POST, one reload.
      expect(fetchMock.mock.calls).toHaveLength(3);
      const sent = fetchMock.mock.calls
        .map(([, init]) => init as RequestInit | undefined)
        .find((init) => init?.method === "POST");
      expect(JSON.parse(String(sent?.body))).toEqual({
        reportId: OWN_REPORT_ID,
        action: "suspension",
        reason: REASON,
      });

      // What the pressed decision wrote — read back from Postgres, not from
      // any scripted source: the action row (enum-constrained at the
      // database), the audit trail with its metadata, and the report
      // resolved.
      const [liveAction] = await db
        .select({
          actorId: moderationActions.actorId,
          action: moderationActions.action,
          reason: moderationActions.reason,
        })
        .from(moderationActions)
        .where(eq(moderationActions.actorId, ADMIN_ID));
      expect(liveAction).toEqual({
        actorId: ADMIN_ID,
        action: "suspension",
        reason: REASON,
      });
      const [liveAudit] = await db
        .select({ action: auditLogs.action, metadata: auditLogs.metadata })
        .from(auditLogs)
        .where(eq(auditLogs.actorId, ADMIN_ID));
      expect(liveAudit?.action).toBe("moderation.suspension");
      expect(liveAudit?.metadata).toEqual({ reportId: OWN_REPORT_ID, reason: REASON });
      const [reportStatus] = await db
        .select({ status: reports.status })
        .from(reports)
        .where(eq(reports.id, OWN_REPORT_ID));
      expect(reportStatus?.status).toBe("resolved");
    } finally {
      // Reversed, so the admin delete runs last: through its own foreign key
      // it cascades away the action row this decision inserted, while the
      // report row and audit rows go explicitly. Surfaces are the afterEach's
      // job (the house teardown convention); session cleared before the pool
      // ends, so nothing is left to service a late request.
      for (const { run, note } of cleanup.reverse()) {
        try {
          await run();
        } catch (cleanupError) {
          console.error(`rendered live smoke cleanup failed for ${note}:`, cleanupError);
        }
      }
      session.userId = null;
      vi.unstubAllGlobals();
      await dbModule.db.$client.end({ timeout: 5 });
    }
  });
});
