import { describe, expect, it, vi } from "vitest";
import { reports, users, posts, moderationActions, auditLogs } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

/**
 * The moderation flow, against live Postgres.
 *
 * The route-level smoke and the rendered smoke pin the wiring — who a decision
 * is allowed to come from and what the routes decide from a scripted read — but
 * they stand on the fake, which answers rows without evaluating SQL. This one
 * runs the same flow with the real `db` (no mock of `@/lib/db`), so the reads
 * are the routes' own Drizzle queries and the writes are Postgres executing
 * them: the `pending` filter, the batched enrichment, the enum-constrained
 * action insert, and the report's `resolved` update are all answered by the
 * database engine.
 *
 * The file names no database at run time: the DSN it connects through is the
 * process's own `DATABASE_URL`, which the caller points at a scratch branch —
 * the same migration set and the same `npm run db:seed` a real environment
 * gets, and nothing the app owns but a disposable copy. In this run that branch
 * took the migrations through `psql` directly, because `drizzle-kit migrate`
 * dies silently on plain Postgres, and three supabase-only seams in migration
 * 0004 were given local stand-ins: the `anon`/`authenticated` roles, an empty
 * `supabase_realtime` publication, and an `auth.uid()` stub whose only reader
 * is the RLS policy — the app connects as table owner, which bypasses RLS.
 *
 * The session remains the house seam (`@/lib/auth` mocked), because auth is a
 * hosted Supabase service, not a Postgres object this branch carries. The
 * default suite skips this file; the live run is
 *
 *   DATABASE_URL=<scratch> SMOKE_LIVE_POSTGRES=1 npx vitest run src/lib/db/moderation-live-postgres.test.ts
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

(LIVE_POSTGRES ? describe : describe.skip)("the moderation flow against live Postgres", () => {
  const ADMIN_ID = "77000000-0000-4000-8000-000000000001";
  const ACCOUNT_REPORT_ID = "91000000-0000-4000-8000-000000000003";
  const MEMBER_6 = "10000000-0000-4000-8000-000000000006";
  const REASON = "Confirmed: the pattern holds across messages, not one post.";

  it("seats the seeded queue, records a live suspension, and drains it", async () => {
    // Driven dynamically: importing `@/lib/db` (directly or through the route
    // modules) throws when DATABASE_URL is unset, so the default suite's skip
    // must happen without these imports ever running.
    const dbModule = await import("@/lib/db");
    const db = dbModule.db;
    const { GET: listReports } = await import("@/app/api/admin/reports/route");
    const { POST: moderate } = await import("@/app/api/admin/moderate/route");

    const cleanup: { run: () => Promise<unknown>; note: string }[] = [];
    try {
      // The grant: the one privilege the routes read out of the database.
      await db.insert(users).values({
        id: ADMIN_ID,
        email: "smoke.admin@linkme.plus",
        username: "smoke_admin",
        role: "admin",
      });
      cleanup.push({
        note: "smoke admin",
        run: async () => db.delete(users).where(eq(users.id, ADMIN_ID)),
      });
      session.userId = ADMIN_ID;

      // 1 — the pending queue, read and filtered by the live engine. The
      // seeded pending rows are fixed by the seed's deterministic ids; the
      // handles below are the demo cast's, and the queue's accounting of them
      // is the live query's own answer.
      const seated = await listReports(list("/api/admin/reports?status=pending"));
      expect(seated.status).toBe(200);
      const queue = (await seated.json()) as {
        data: { id: string; targetType: string; targetId: string; reason: string; targetContent: string | null; targetAuthor: string | null }[];
        pagination: { total: number };
      };
      expect(queue.pagination.total).toBe(3);
      // The route serves the queue newest first (`createdAt desc`), and live
      // Postgres is what evaluates that order — the seeded account report (26
      // hours old) first, then the comment report, then the post report.
      expect(queue.data.map((row) => row.id)).toEqual([
        "91000000-0000-4000-8000-000000000003",
        "91000000-0000-4000-8000-000000000002",
        "91000000-0000-4000-8000-000000000001",
      ]);
      expect(queue.data.map((row) => row.targetType)).toEqual(["user", "comment", "post"]);
      // The enrichment is the live database's answer: the excerpt is the
      // reported row's own words, the handle is a member that exists. Pin the
      // account row — the one whose target has no content — and the handle
      // the decision is about.
      const accountRow = queue.data.find((row) => row.id === ACCOUNT_REPORT_ID)!;
      expect(accountRow.targetContent).toBeNull();
      expect(accountRow.targetAuthor).toBe("@sofia_photographs");
      const postRow = queue.data.find((row) => row.id === "91000000-0000-4000-8000-000000000001")!;
      expect(postRow.targetContent).not.toBeNull();
      // The excerpt is the reported post's own words as they stand in this
      // database, whatever the seed corpus wrote there.
      const [reportedPost] = await db
        .select({ content: posts.content })
        .from(posts)
        .where(eq(posts.id, postRow.targetId ?? ""));
      expect(postRow.targetContent).toBe(reportedPost?.content ?? null);
      expect(postRow.targetAuthor).toBe("@jordan_builds");
      // The target the excerpt came from is the report's own target, live.

      // 2 — the suspension, sent as the dashboard sends it.
      const decision = await moderate(
        decide({ reportId: ACCOUNT_REPORT_ID, action: "suspension", reason: REASON }),
      );
      expect(decision.status).toBe(201);
      const decisionBody = (await decision.json()) as { action: { action: string; targetId: string } };
      expect(decisionBody.action).toMatchObject({ action: "suspension", targetId: MEMBER_6 });

      // 3 — Postgres wrote what the flow meant: the action row, the audit
      // trail, and the report resolved. Read back by SQL, not by a scripted
      // queue.
      const [liveAction] = await db
        .select({ actorId: moderationActions.actorId, action: moderationActions.action, reason: moderationActions.reason })
        .from(moderationActions)
        .where(eq(moderationActions.targetId, MEMBER_6));
      expect(liveAction).toMatchObject({ actorId: ADMIN_ID, action: "suspension", reason: REASON });
      const [liveAudit] = await db
        .select({ action: auditLogs.action, metadata: auditLogs.metadata })
        .from(auditLogs)
        .where(eq(auditLogs.targetId, MEMBER_6));
      expect(liveAudit.action).toBe("moderation.suspension");
      expect(liveAudit.metadata).toEqual({ reportId: ACCOUNT_REPORT_ID, reason: REASON });
      cleanup.push({
        note: "action and audit rows",
        run: async () => {
          await db.delete(moderationActions).where(eq(moderationActions.actorId, ADMIN_ID));
          await db.delete(auditLogs).where(eq(auditLogs.actorId, ADMIN_ID));
        },
      });

      const [reportStatus] = await db
        .select({ status: reports.status })
        .from(reports)
        .where(eq(reports.id, ACCOUNT_REPORT_ID));
      expect(reportStatus.status).toBe("resolved");
      cleanup.push({
        note: "report back to pending",
        run: async () => db.update(reports).set({ status: "pending" }).where(eq(reports.id, ACCOUNT_REPORT_ID)),
      });

      // 4 — the drained queue: the resolved account report is out of
      // pending, live.
      const drained = await listReports(list("/api/admin/reports?status=pending"));
      expect(drained.status).toBe(200);
      const left = (await drained.json()) as { data: { id: string }[]; pagination: { total: number } };
      expect(left.pagination.total).toBe(2);
      expect(left.data.map((row) => row.id)).not.toContain(ACCOUNT_REPORT_ID);
    } finally {
      for (const { run, note } of cleanup.reverse()) {
        try {
          await run();
        } catch (cleanupError) {
          console.error(`live smoke cleanup failed for ${note}:`, cleanupError);
        }
      }
      session.userId = null;
      await dbModule.db.$client.end({ timeout: 5 });
    }
  });
});
