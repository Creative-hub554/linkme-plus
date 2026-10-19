import { describe, expect, it, vi } from "vitest";
import { auditLogs, users, verificationRequests } from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";

/**
 * The verification flow, against live Postgres.
 *
 * The verification suites beside the routes pin the wiring — who may review,
 * what the member submits, what a decision writes — but they stand on the
 * fake, which answers rows without evaluating SQL. This one runs the same
 * flow with the real `db` (no mock of `@/lib/db`), so the reads are the
 * routes' own Drizzle queries and the writes are Postgres executing them: the
 * one-pending-per-user partial index, the queue's `createdAt desc` order with
 * the profiles join behind it, the enum-constrained status update, and the
 * badge flip are all answered by the database engine.
 *
 * The file names no database at run time: the DSN it connects through is the
 * process's own `DATABASE_URL`, which the caller points at a scratch branch
 * that took the migrations and the seed — the queue this smoke drives is the
 * seed's own `verification_requests` fixture (`93000000…1/2`, applications
 * from the two members the moderation queue already exercises).
 *
 * The session remains the house seam (`@/lib/auth` mocked), because auth is a
 * hosted Supabase service, not a Postgres object this branch carries. The
 * default suite skips this file; the live run is
 *
 *   DATABASE_URL=<scratch> SMOKE_LIVE_POSTGRES=1 npx vitest run src/app/api/verification-flow-live-postgres.test.ts
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

// Ids owned by this file: the grant it reads its role from. The `94000000`
// block is deliberately distinct from every other suite's smoke ids, so the
// concurrent live smokes working the same branch cannot collide on a `users`
// row. The rendered verification smoke takes `94000000…2` beside this one.
const ADMIN_ID = "94000000-0000-4000-8000-000000000001";
// Read-only here: the seed's cast. The photographer and the maker whose
// applications the seeded queue holds, and one more member with no
// application at all — the submit path's clean subject.
const MEMBER_6 = "10000000-0000-4000-8000-000000000006";
const MEMBER_3 = "10000000-0000-4000-8000-000000000003";
const MEMBER_5 = "10000000-0000-4000-8000-000000000005";
const SOFIA_REQUEST_ID = "93000000-0000-4000-8000-000000000001";
const JORDAN_REQUEST_ID = "93000000-0000-4000-8000-000000000002";
const SOFIA_URLS = ["https://example.com/sofia-portfolio", "https://example.com/sofia-instagram"];
const JORDAN_URLS = ["https://example.com/jordan-github"];
const REVIEW_NOTE = "Both links resolve to her Verified gallery.";
const SUBMIT_URLS = ["https://example.com/observation-log"];

interface SeededQueueRow {
  id: string;
  userId: string;
  username: string;
  displayName: string;
  evidenceUrls: string[];
  status: string;
}

function memberRequest(method: string, body?: unknown) {
  return new Request("http://localhost/api/verification-requests", {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function reviewRequest(method: string, body?: unknown) {
  return new Request("http://localhost/api/admin/verification-requests", {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

(LIVE_POSTGRES ? describe : describe.skip)("the verification flow against live Postgres", () => {
  it("answers a member's status, submits a fresh application live, and reviews the seeded queue once each way", async () => {
    // Driven dynamically: importing `@/lib/db` (directly or through the route
    // modules) throws when DATABASE_URL is unset, so the default suite's skip
    // must happen without these imports ever running.
    const dbModule = await import("@/lib/db");
    const db = dbModule.db;
    const { GET: memberStatus, POST: submit } = await import("@/app/api/verification-requests/route");
    const { GET: reviewQueue, PATCH: review } = await import("@/app/api/admin/verification-requests/route");

    const cleanup: { run: () => Promise<unknown>; note: string }[] = [];
    try {
      // The grant: the one privilege the routes read out of the database.
      await db.insert(users).values({
        id: ADMIN_ID,
        email: "smoke.verification.admin@linkme.plus",
        username: "smoke_verification_admin",
        role: "admin",
      });
      // Pushed first so the reversed cleanup below deletes it last: the
      // restored rows must not hold a `reviewed_by` that names a deleted
      // account.
      cleanup.push({
        note: "smoke admin",
        run: async () => db.delete(users).where(eq(users.id, ADMIN_ID)),
      });

      // The badge is a decision, so its precondition is read once and left
      // exactly as found.
      const [sofiaBefore] = await db.select({ verified: users.verified }).from(users).where(eq(users.id, MEMBER_6));
      expect(sofiaBefore, "the seeded member this smoke reviews must exist").toBeTruthy();

      // ── 1 — the member route, live ──────────────────────────────────
      // No application of one's own: the queue says pending about two
      // members, and this one is neither.
      session.userId = MEMBER_5;
      const absentStatus = await memberStatus(memberRequest("GET"));
      expect(absentStatus.status).toBe(200);
      expect(await absentStatus.json()).toEqual({ verified: false, request: null });

      // The submit path: the validation gate first — a non-https link is
      // refused before anything is written — then an application the route
      // accepts, whose row is read back live.
      const refused = await submit(
        memberRequest("POST", { evidenceUrls: ["http://insecure.example.com/me"] }),
      );
      expect(refused.status).toBe(400);
      const [refusedRow] = await db
        .select({ id: verificationRequests.id })
        .from(verificationRequests)
        .where(eq(verificationRequests.userId, MEMBER_5));
      expect(refusedRow, "a refused submission must write nothing").toBeUndefined();

      const accepted = await submit(memberRequest("POST", { evidenceUrls: SUBMIT_URLS }));
      expect(accepted.status).toBe(201);
      const submitted = (await accepted.json()) as {
        request: { id: string; status: string; evidenceUrls: string[] };
      };
      expect(submitted.request.status).toBe("pending");
      cleanup.push({
        note: "smoke-submitted request",
        run: async () => db.delete(verificationRequests).where(eq(verificationRequests.id, submitted.request.id)),
      });
      const [freshRow] = await db
        .select({ evidenceUrls: verificationRequests.evidenceUrls, status: verificationRequests.status })
        .from(verificationRequests)
        .where(eq(verificationRequests.id, submitted.request.id));
      expect(freshRow).toEqual({ evidenceUrls: SUBMIT_URLS, status: "pending" });

      // The one-pending-per-user guarantee, both by route and by index: a
      // second submission is refused while one is under review.
      const duplicate = await submit(memberRequest("POST", { evidenceUrls: SUBMIT_URLS }));
      expect(duplicate.status).toBe(409);

      // The queue's subject sees her own application, and only hers.
      session.userId = MEMBER_6;
      const ownStatus = await memberStatus(memberRequest("GET"));
      expect(ownStatus.status).toBe(200);
      const own = (await ownStatus.json()) as {
        verified: boolean;
        request: { id: string; evidenceUrls: string[]; status: string; reviewNote: string | null };
      };
      expect(own).toMatchObject({
        verified: false,
        request: { id: SOFIA_REQUEST_ID, evidenceUrls: SOFIA_URLS, status: "pending", reviewNote: null },
      });

      // ── 2 — the reviewer queue, over the seed's two applications ────
      session.userId = ADMIN_ID;
      const queued = await reviewQueue(reviewRequest("GET"));
      expect(queued.status).toBe(200);
      const queue = (await queued.json()) as { data: SeededQueueRow[]; pagination: { total: number } };
      // The filter that fills the queue is the live engine's: both seeded
      // applications are pending and both are served with the identity the
      // joins attach. Absolute totals are not pinned — this branch runs the
      // concurrent live smokes beside this one, each bringing an application
      // of its own — but the seeded pair's own entries and their order are:
      // the queue reads `createdAt desc`, and the photographer's
      // (8 hours old) sits above the maker's (20 hours old).
      const rows = queue.data.filter((row) => row.id === SOFIA_REQUEST_ID || row.id === JORDAN_REQUEST_ID);
      expect(rows.map((row) => row.id)).toEqual([SOFIA_REQUEST_ID, JORDAN_REQUEST_ID]);
      expect(rows.map((row) => row.status)).toEqual(["pending", "pending"]);
      expect(queue.pagination.total).toBeGreaterThanOrEqual(2);
      const sofiaRow = queue.data.find((row) => row.id === SOFIA_REQUEST_ID)!;
      expect(sofiaRow.username).toBe("sofia_photographs");
      expect(sofiaRow.displayName).toBe("Sofia Marchetti");
      expect(sofiaRow.evidenceUrls).toEqual(SOFIA_URLS);
      const jordanRow = queue.data.find((row) => row.id === JORDAN_REQUEST_ID)!;
      expect(jordanRow.evidenceUrls).toEqual(JORDAN_URLS);

      // ── 3 — approve once, and only from pending ─────────────────────
      const approve = await review(
        reviewRequest("PATCH", { requestId: SOFIA_REQUEST_ID, decision: "approved", reviewNote: REVIEW_NOTE }),
      );
      expect(approve.status).toBe(200);
      expect(((await approve.json()) as { request: { status: string } }).request.status).toBe("approved");

      // Postgres wrote what the flow meant: the badge flipped, the decision
      // and its audit trail are the live rows.
      const [sofiaAfter] = await db.select({ verified: users.verified }).from(users).where(eq(users.id, MEMBER_6));
      expect(sofiaAfter!.verified).toBe(true);
      cleanup.push({
        note: "badge back to seeded",
        run: async () => db.update(users).set({ verified: sofiaBefore!.verified }).where(eq(users.id, MEMBER_6)),
      });
      const [approvedRow] = await db
        .select({ status: verificationRequests.status, reviewNote: verificationRequests.reviewNote })
        .from(verificationRequests)
        .where(eq(verificationRequests.id, SOFIA_REQUEST_ID));
      expect(approvedRow).toEqual({ status: "approved", reviewNote: REVIEW_NOTE });
      cleanup.push({
        note: "photograph's request back to pending",
        run: async () =>
          db
            .update(verificationRequests)
            .set({ status: "pending", reviewNote: null, reviewedBy: null, reviewedAt: null })
            .where(eq(verificationRequests.id, SOFIA_REQUEST_ID)),
      });
      const [approvedAudit] = await db
        .select({ action: auditLogs.action, metadata: auditLogs.metadata })
        .from(auditLogs)
        .where(eq(auditLogs.actorId, ADMIN_ID));
      expect(approvedAudit.action).toBe("verification.approved");
      expect(approvedAudit.metadata).toEqual({ requestId: SOFIA_REQUEST_ID, reviewNote: REVIEW_NOTE });
      cleanup.push({
        note: "smoke audit rows",
        run: async () => db.delete(auditLogs).where(eq(auditLogs.actorId, ADMIN_ID)),
      });

      // An already-decided request cannot be decided again: the pending
      // filter the update is gated on is the live engine's answer.
      const again = await review(
        reviewRequest("PATCH", { requestId: SOFIA_REQUEST_ID, decision: "approved" }),
      );
      expect(again.status).toBe(404);

      // The other way: a rejection writes the decision and the audit, and
      // awards no badge.
      const reject = await review(
        reviewRequest("PATCH", { requestId: JORDAN_REQUEST_ID, decision: "rejected" }),
      );
      expect(reject.status).toBe(200);
      const [jordanAfterBadging] = await db.select({ verified: users.verified }).from(users).where(eq(users.id, MEMBER_3));
      expect(jordanAfterBadging!.verified).toBe(false);
      const rejectedAudit = await db
        .select({ action: auditLogs.action })
        .from(auditLogs)
        .where(eq(auditLogs.actorId, ADMIN_ID));
      expect(rejectedAudit.map((row) => row.action)).toEqual(
        expect.arrayContaining(["verification.approved", "verification.rejected"]),
      );
      cleanup.push({
        note: "maker's request back to pending",
        run: async () =>
          db
            .update(verificationRequests)
            .set({ status: "pending", reviewNote: null, reviewedBy: null, reviewedAt: null })
            .where(inArray(verificationRequests.id, [JORDAN_REQUEST_ID])),
      });

      // The drained queue: both decided rows are out of pending, live.
      const drained = await reviewQueue(reviewRequest("GET"));
      expect(drained.status).toBe(200);
      const left = (await drained.json()) as { data: { id: string }[] };
      const ids = left.data.map((row) => row.id);
      expect(ids).not.toContain(SOFIA_REQUEST_ID);
      expect(ids).not.toContain(JORDAN_REQUEST_ID);
    } finally {
      // Reversed, so the admin delete runs last: the seeded rows it reviewed
      // are restored before the account its `reviewed_by` named is removed.
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
