// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupSurfaces, mountSurface } from "@/test/render";
import { AdminReports } from "@/components/admin/admin-reports";
import { reports, users } from "@/lib/db/schema";
import { eq, count } from "drizzle-orm";

/**
 * The reports board, rendered over the live database.
 *
 * The moderation dashboard's live smoke pins the queue a decision is made
 * against; the reports board is the other half of the admin surface — the
 * truthful map of everything the platform has received, keyed by a status
 * filter. Its component suite answers `fetch` with canned JSON, so nothing
 * about the *filters themselves* was ever exercised against an engine. This
 * one mounts `AdminReports` in jsdom, dispatches its `fetch` to the real
 * `GET /api/admin/reports`, and presses four status filters besides the
 * initial board — Resolved, Reviewing, Dismissed, All — so what each press
 * asserts is the live engine's answer to *that* status: the request the
 * board made carries the pressed filter under a reset page, the rows
 * rendered are exactly the rows that answer served (their reasons and
 * descriptions quoted back into the list), and the totals come from the
 * captured envelope rather than from a re-query that could answer a later
 * queue. Where the state is stable under the concurrent smokes, the pin is
 * exact: the Dismissed board's served total equals the database's own count,
 * and Reviewing — a status the app's flows never write and the seed never
 * seeds — renders its empty state against a genuinely empty read.
 *
 * Two run-at-a-time facts are designed in rather than commented in:
 *
 * - The session stays the house seam (`@/lib/auth` mocked, exactly as every
 *   route test does), because auth is a hosted Supabase service, not
 *   something this Postgres branch carries.
 * - This file brings its OWN deterministic ids — one smoke admin, one
 *   pending account report — and deletes every row it made. The moderation
 *   live smokes run side by side in separate workers against the same
 *   scratch branch and move the seeded *pending* board under this one's
 *   feet (one resolves a seeded report and puts it back; the other resolves
 *   its own row before deleting it), so the Pending and All boards are
 *   asserted on what their own envelopes carried, never on absolute totals.
 *
 * Skipped by default; the live run is
 *
 *   DATABASE_URL=<scratch> SMOKE_LIVE_POSTGRES=1 npx vitest run src/app/api/admin/reports-board-live-postgres.rendered-smoke.test.tsx
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

// Ids owned by this file: the `88000000` admin block's second member and the
// `92000000` report block's second row — the moderation rendered smoke owns
// the `…000001` of each, so parallel live workers never share a row.
const ADMIN_ID = "88000000-0000-4000-8000-000000000002";
const OWN_REPORT_ID = "92000000-0000-4000-8000-000000000002";
// The seeded cast, read-only: the reported account, the way the moderation
// smoke's own report names one.
const MEMBER_6 = "10000000-0000-4000-8000-000000000006";

const OWN_REASON = "Harassment";
const OWN_DESCRIPTION = "Reports board smoke: this pending row is the presser's own.";

/** One row of the queue, as the live route serves it to the board. */
interface ServedRow {
  id: string;
  targetType: string;
  targetId: string;
  reason: string;
  description: string | null;
  status: string;
  createdAt: string;
}

interface ServedPayload {
  data: ServedRow[];
  pagination: { total: number; page: number; totalPages: number; hasMore: boolean };
}

/** The board's last served answer, photographed with the filter that asked. */
let served: { status: string; payload: ServedPayload } | undefined;

const fetchMock = vi.fn();

function buttonWith(container: HTMLElement, text: string) {
  const button = [...container.querySelectorAll("button")].find(
    (b) => (b.textContent ?? "").trim() === text,
  );
  if (!button) throw new Error(`no button reading "${text}"`);
  return button;
}

(LIVE_POSTGRES ? describe : describe.skip)("the reports board against live Postgres", () => {
  // The house teardown convention (`src/test/render.test.ts`'s guard even
  // though this file's own `finally` cleans its own rows up): a mount that
  // somehow outlived this fixture still has its here.
  afterEach(() => {
    cleanupSurfaces();
  });

  it("renders the live queue under every status filter press", async () => {
    // Driven dynamically for the same reason the moderation live smokes are:
    // the default suite's skip must happen without these modules (and their
    // pool) ever loading.
    const dbModule = await import("@/lib/db");
    const db = dbModule.db;
    const { GET: listReports } = await import("@/app/api/admin/reports/route");

    const cleanup: { run: () => Promise<unknown>; note: string }[] = [];
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    try {
      // The grant, then the report this file owns — both smoke rows, gone by
      // the reversed cleanup below, leaving the branch as the seed made it.
      await db.insert(users).values({
        id: ADMIN_ID,
        email: "smoke.reports.admin@linkme.plus",
        username: "smoke_reports_admin",
        role: "admin",
      });
      cleanup.push({ note: "smoke reports admin", run: async () => db.delete(users).where(eq(users.id, ADMIN_ID)) });
      await db.insert(reports).values({
        id: OWN_REPORT_ID,
        reporterId: MEMBER_6,
        targetType: "user",
        targetId: MEMBER_6,
        reason: OWN_REASON,
        description: OWN_DESCRIPTION,
      });
      cleanup.push({
        note: "own reports-board report",
        run: async () => db.delete(reports).where(eq(reports.id, OWN_REPORT_ID)),
      });

      // What the live database holds about two filters before the mount:
      // `reviewing`, because every flow the app writes is pending → resolved
      // and nothing this file or the concurrent smokes write lands there;
      // `dismissed`, which only the seed writes. No smoke in this run
      // touches either status, so the totals the board shows can be pinned
      // against the tables rather than merely against their own envelopes.
      const [reviewingLive] = await db.select({ total: count() }).from(reports).where(eq(reports.status, "reviewing"));
      const [dismissedLive] = await db.select({ total: count() }).from(reports).where(eq(reports.status, "dismissed"));
      expect(reviewingLive.total, "a reviewer status written before the mount cannot be pinned").toBe(0);

      // The session, once the grant it reads from the database exists.
      session.userId = ADMIN_ID;

      // The dispatch the browser performs: every board request meets the
      // real handler, and the answer is photographed with the filter that
      // asked for it — the assertions below quote what a press served, not
      // what a script would have said. Anything but a GET of
      // /api/admin/reports fails loudly: the board makes no other request.
      fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input), "http://localhost");
        if (url.pathname !== "/api/admin/reports") {
          throw new Error(`the board requested ${url.pathname}, only /api/admin/reports is accounted for`);
        }
        if ((init?.method ?? "GET") !== "GET") {
          throw new Error(`the board's request must be a GET, saw ${init?.method ?? "GET"}`);
        }
        const response = await listReports(new Request(url.toString(), { method: "GET" }));
        if (!response.ok) {
          throw new Error(`the live queue answered ${response.status} to the board`);
        }
        served = {
          status: url.searchParams.get("status") ?? "",
          payload: (await response.clone().json()) as ServedPayload,
        };
        return response;
      });

      // ── the mount: the pending board the live engine serves ────────────
      const surface = mountSurface(<AdminReports />, { providers: "none" });
      await surface.waitFor(
        () => surface.container.textContent?.includes(OWN_DESCRIPTION) ?? false,
        { description: "the rendered pending board to show this file's own report" },
      );

      // The board asked for its initial filter exactly as its code renders
      // it: pending, page one, the board's page limit, no-store — the
      // freshness contract the board's own fetch names.
      expect(fetchMock.mock.calls, "one queue load on the mount").toHaveLength(1);
      expect((fetchMock.mock.calls[0][1] as RequestInit | undefined)?.cache).toBe("no-store");
      expect(served?.status).toBe("pending");
      expect(served?.payload.pagination.page).toBe(1);

      // The pending rows are exactly what that answer served: nothing more
      // rendered than the envelope carried, nothing carried left
      // unrendered — each row's own reason quoted back into the list. Under
      // the concurrent moderation smokes the pending set moves, which is
      // exactly why the claim is against this envelope and not a total.
      const rows = () => surface.container.querySelectorAll("li");
      expect(rows().length).toBe(served!.payload.data.length);
      for (const row of served!.payload.data) {
        expect(surface.container.textContent).toContain(row.reason);
      }

      // ── the presses: one request each, page reset to one ───────────────
      // Pressing Resolved asks the route for resolved reports; the board
      // shows only those, so this file's own pending row leaves the render.
      await surface.click(buttonWith(surface.container, "Resolved"));
      await surface.waitFor(
        () => served?.status === "resolved" && !surface.container.textContent?.includes(OWN_DESCRIPTION),
        { description: "the resolved press to swap the board" },
      );
      // Whatever the concurrent smokes transiently resolve into this status,
      // the board shows the route's whole answer: every served row rendered,
      // with its description — the row's own words, live.
      expect(served!.payload.data.length, "the seed's resolved report to be on its board").toBeGreaterThanOrEqual(1);
      expect(served!.payload.pagination.page).toBe(1);
      expect(rows().length).toBe(served!.payload.data.length);
      for (const row of served!.payload.data) {
        expect(surface.container.textContent).toContain(row.reason);
        if (row.description) expect(surface.container.textContent).toContain(row.description);
      }

      // Reviewing: a status no flow writes and no smoke moves — the empty
      // state against a genuinely empty live read, pinned exactly.
      await surface.click(buttonWith(surface.container, "Reviewing"));
      await surface.waitFor(
        () =>
          served?.status === "reviewing" &&
          (surface.container.textContent?.includes("No reviewing reports.") ?? false),
        { description: "the reviewing empty state" },
      );
      expect(served!.payload.data).toHaveLength(0);
      expect(served!.payload.pagination.total).toBe(0);
      expect(rows().length).toBe(0);

      // Dismissed: pinned exactly against the database's own count — no
      // writer in this run touches dismissed rows.
      await surface.click(buttonWith(surface.container, "Dismissed"));
      await surface.waitFor(
        () => served?.status === "dismissed" && rows().length === Number(dismissedLive.total),
        { description: "the dismissed board to agree with the database" },
      );
      expect(served!.payload.pagination.total).toBe(Number(dismissedLive.total));
      for (const row of served!.payload.data) {
        expect(surface.container.textContent).toContain(row.reason);
        if (row.description) expect(surface.container.textContent).toContain(row.description);
      }

      // All: the unfiltered listing. The press resets the page again, and
      // everything the answer carried is rendered — including this file's
      // own pending row. The concurrent smokes' transient rows may ride on
      // this board, which is why the total is self-consistent rather than
      // fixed: what was served is what was rendered, envelope against list.
      await surface.click(buttonWith(surface.container, "All"));
      await surface.waitFor(
        () => served?.status === "all" && (surface.container.textContent?.includes(OWN_DESCRIPTION) ?? false),
        { description: "the all board to include this file's own report" },
      );
      expect(served!.payload.pagination.total).toBe(served!.payload.data.length);
      expect(rows().length).toBe(served!.payload.data.length);
      for (const row of served!.payload.data) {
        expect(surface.container.textContent).toContain(row.reason);
      }

      // The pressed button reads as the pressed one: the filters are named
      // as one choice in the markup's own contract (aria-pressed), verified
      // on the live render.
      expect(buttonWith(surface.container, "All").getAttribute("aria-pressed")).toBe("true");
      expect(buttonWith(surface.container, "Pending").getAttribute("aria-pressed")).toBe("false");

      // The flow's full request budget, now spent: the mount's one load, and
      // exactly one per press — the board grown nothing else.
      expect(fetchMock.mock.calls).toHaveLength(5);
    } finally {
      for (const { run, note } of cleanup.reverse()) {
        try {
          await run();
        } catch (cleanupError) {
          console.error(`reports board live smoke cleanup failed for ${note}:`, cleanupError);
        }
      }
      session.userId = null;
      vi.unstubAllGlobals();
      await dbModule.db.$client.end({ timeout: 5 });
    }
  });
});
