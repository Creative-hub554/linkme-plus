// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupSurfaces, mountSurface } from "@/test/render";
import { AdminVerificationRequests } from "@/components/admin/admin-verification-requests";
import { auditLogs, profiles, users, verificationRequests } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

/**
 * The verification queue, rendered over the live database.
 *
 * The component's own suite answers `fetch` with canned JSON; the fake-based
 * rendered smoke routes the component's calls through the real handlers but
 * stands them on a fake database whose every table is scripted by hand. This
 * one closes the last gap in the chain: the reviewer queue is mounted in
 * jsdom, its `fetch` is dispatched to the real
 * `GET /api/admin/verification-requests` and `PATCH` review, and *nothing* is
 * scripted — `@/lib/db` is the real module, the reads are Drizzle's own
 * queries and the writes are Postgres executing them. What this pins that no
 * earlier smoke could: the queue the reviewer sees is the live engine's
 * answer (including `createdAt desc` and the `profiles` join the fake's
 * scripted answer cannot evaluate), the identity on the row is the member's
 * own live record, an approval pressed at the queue transactionally flips
 * `users.verified`, and the reload that follows drops the row it approved.
 *
 * Two run-at-a-time facts are designed in rather than commented in:
 *
 * - The session stays the house seam (`@/lib/auth` mocked, exactly as every
 *   route test does), because auth is a hosted Supabase service, not
 *   something this Postgres branch carries.
 * - This file brings its OWN deterministic ids — one smoke admin, one
 *   pending application from a seeded member — and deletes every row it
 *   made. The live handler smoke
 *   (`src/app/api/verification-flow-live-postgres.test.ts`) drives the
 *   *seeded* application ids, and Vitest runs test files in parallel workers
 *   against the same scratch branch; disjoint ids are what let both run side
 *   by side without a shared row resolving under the other's feet.
 *
 * Skipped by default; the live run is
 *
 *   DATABASE_URL=<scratch> SMOKE_LIVE_POSTGRES=1 npx vitest run src/app/api/verification-flow-live-postgres.rendered-smoke.test.tsx
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

// Ids owned by this file. Both blocks are deliberately distinct from every
// other suite's smoke ids: nothing else creates or deletes these rows, so
// concurrent live smokes cannot collide.
const ADMIN_ID = "94000000-0000-4000-8000-000000000002";
const OWN_REQUEST_ID = "95000000-0000-4000-8000-000000000001";
// Read-only here: the seeded cast member whose application this file brings
// and approves. The member's badge is flipped by the pressed approval, so its
// seeded value is read first and restored.
const MEMBER_ID = "10000000-0000-4000-8000-000000000004";
const OWN_URL = "https://example.com/amara-case-study";

const fetchMock = vi.fn();

function buttonWith(container: HTMLElement, text: string) {
  const button = [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === text);
  if (!button) throw new Error(`no button reading "${text}"`);
  return button;
}

(LIVE_POSTGRES ? describe : describe.skip)("the verification queue against live Postgres", () => {
  // The house teardown convention (`src/test/render.test.tsx`'s guard) — even
  // though this file's own `finally` below already cleans up on every path, a
  // mount that somehow outlived it still has its here.
  afterEach(() => {
    cleanupSurfaces();
  });

  it("renders the live queue, awards the badge on a pressed approval, and reloads it gone", async () => {
    // Driven dynamically for the same reason the handler smoke is: the default
    // suite's skip must happen without these modules (and their pool) ever loading.
    const dbModule = await import("@/lib/db");
    const db = dbModule.db;
    const { GET: reviewQueue, PATCH: review } = await import("@/app/api/admin/verification-requests/route");

    const cleanup: { run: () => Promise<unknown>; note: string }[] = [];
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    try {
      // The grant, then the application this file owns: a real seeded member's
      // pending request. After the reversed cleanup below, the branch is
      // exactly as the seed made it.
      await db.insert(users).values({
        id: ADMIN_ID,
        email: "smoke.verification.rendered@linkme.plus",
        username: "smoke_verification_rendered",
        role: "admin",
      });
      cleanup.push({ note: "smoke rendered admin", run: async () => db.delete(users).where(eq(users.id, ADMIN_ID)) });
      await db.insert(verificationRequests).values({
        id: OWN_REQUEST_ID,
        userId: MEMBER_ID,
        evidenceUrls: [OWN_URL],
        status: "pending",
      });
      cleanup.push({
        note: "own application",
        run: async () => db.delete(verificationRequests).where(eq(verificationRequests.id, OWN_REQUEST_ID)),
      });
      // `audit_logs.actor_id` has no foreign key, so the audit rows a pressed
      // approval writes are deleted explicitly — they would otherwise be the
      // one thing this file leaves behind it.
      cleanup.push({
        note: "own audit rows",
        run: async () => db.delete(auditLogs).where(eq(auditLogs.actorId, ADMIN_ID)),
      });

      // The badge this file's decision is about, read before anything presses
      // it, so the restore below puts back the seeded truth either way.
      const [memberBefore] = await db
        .select({ verified: users.verified, username: users.username })
        .from(users)
        .where(eq(users.id, MEMBER_ID));
      expect(memberBefore, "the seeded member this smoke reviews must exist").toBeTruthy();
      expect(memberBefore!.verified, "the seeded member this smoke reviews must not already carry the badge").toBe(false);
      const [profile] = await db
        .select({ displayName: profiles.displayName })
        .from(profiles)
        .where(eq(profiles.userId, MEMBER_ID));
      expect(profile?.displayName, "the profile the queue's join serves must exist").toBeTruthy();

      // The session, once the grant it reads from the database exists.
      session.userId = ADMIN_ID;

      const handle = `@${memberBefore!.username}`;
      const displayName = profile!.displayName;
      expect(displayName, "the profile this smoke names must exist").toBeTruthy();

      // The dispatch the browser performs: the component's own requests meet
      // the real handlers. A queue GET is served whole, and a review PATCH
      // goes straight through with the body as sent. Anything else fails
      // loudly: this smoke grew no other request.
      fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input), "http://localhost");
        expect(url.pathname).toBe("/api/admin/verification-requests");
        if ((init?.method ?? "GET") === "PATCH") {
          return await review(
            new Request(url.toString(), {
              method: "PATCH",
              headers: { "content-type": "application/json" },
              body: init?.body as string,
            }),
          );
        }
        expect(init?.method ?? "GET").toBe("GET");
        return await reviewQueue(new Request(url.toString(), { method: "GET" }));
      });

      // ── the mount: the queue the live engine serves ─────────────────────
      const surface = mountSurface(<AdminVerificationRequests />, { providers: "none" });
      await surface.waitFor(
        () => surface.container.textContent?.includes(OWN_URL) ?? false,
        { description: "the rendered queue to show this file's own application" },
      );

      const text = surface.container.textContent ?? "";

      // The row carries what the live joins make of it: the account's
      // username, and the display name the profiles join serves — read from
      // the tables, not assumed from the fixture.
      expect(text).toContain(displayName);
      expect(text).toContain(handle);
      const ownRow = [...surface.container.querySelectorAll("li")].find((li) =>
        li.textContent?.includes(OWN_URL),
      );
      if (!ownRow) throw new Error("the queue no longer contains this smoke's own application");
      expect([...(ownRow as HTMLElement).querySelectorAll("a")].some((a) => a.getAttribute("href") === OWN_URL)).toBe(
        true,
      );
      expect(buttonWith(ownRow as HTMLElement, "Approve verification")).toBeTruthy();
      expect(buttonWith(ownRow as HTMLElement, "Reject request")).toBeTruthy();

      // Exactly the one request so far: the queue load. The press below sends
      // the second and the reload the third, and the count is asserted again
      // at the end, so a grown request cannot hide inside the budget.
      expect(fetchMock.mock.calls).toHaveLength(1);

      // ── the press: Approve verification on this row ────────────────────
      await surface.click(buttonWith(ownRow as HTMLElement, "Approve verification"));

      // The reload the queue makes itself: the approved application leaves
      // the rendered pending list. Whatever concurrent smokes hold pending
      // beside it rides on or falls out on its own account — this smoke
      // claims only its own row.
      await surface.waitFor(
        () => surface.container.textContent?.includes(OWN_URL) === false,
        { description: "the reload to drop the approved application" },
      );

      // The flow's full request budget, now spent: one queue load, one
      // review PATCH, one reload.
      expect(fetchMock.mock.calls).toHaveLength(3);
      const sent = fetchMock.mock.calls
        .map(([, init]) => init as RequestInit | undefined)
        .find((init) => init?.method === "PATCH");
      expect(JSON.parse(String(sent?.body))).toEqual({
        requestId: OWN_REQUEST_ID,
        decision: "approved",
      });

      // What the pressed decision wrote — read back from Postgres, not from
      // any scripted source: the badge flipped, the audit trail with its
      // metadata, and the application approved with the reviewer named.
      const [memberAfter] = await db
        .select({ verified: users.verified })
        .from(users)
        .where(eq(users.id, MEMBER_ID));
      expect(memberAfter, "the pressed decision must be readable").toBeTruthy();
      expect(memberAfter!.verified).toBe(true);
      cleanup.push({
        note: "member's badge back to seeded",
        run: async () =>
          db.update(users).set({ verified: memberBefore.verified }).where(eq(users.id, MEMBER_ID)),
      });
      const [liveAudit] = await db
        .select({ action: auditLogs.action, metadata: auditLogs.metadata })
        .from(auditLogs)
        .where(eq(auditLogs.actorId, ADMIN_ID));
      expect(liveAudit.action).toBe("verification.approved");
      expect(liveAudit.metadata).toEqual({ requestId: OWN_REQUEST_ID, reviewNote: null });
      const [requestStatus] = await db
        .select({ status: verificationRequests.status, reviewedBy: verificationRequests.reviewedBy })
        .from(verificationRequests)
        .where(eq(verificationRequests.id, OWN_REQUEST_ID));
      expect(requestStatus).toEqual({ status: "approved", reviewedBy: ADMIN_ID });
    } finally {
      // Reversed, so the admin delete runs last: the request's `reviewed_by`
      // points at it until the restore below has cleared its decision, and
      // the audit rows it named the actor of go explicitly. Surfaces are the
      // afterEach's job (the house teardown convention); session cleared
      // before the pool ends, so nothing is left to service a late request.
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
