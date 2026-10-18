import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAX_AGE_HOURS,
  alarmMessage,
  overdueApplications,
  type PendingApplication,
} from "@/lib/verification-queue";

/**
 * The verification queue's nightly alarm.
 *
 * The product rules pin the queue's *shape* — one pending application per
 * member, an administrator's decision is the only award — but nothing so far
 * pins the queue's *age*: verification is never self-awarded, so a queue nobody
 * is watching is the one state the admin surface cannot rescue by itself. This
 * file is that watch.
 *
 * Two halves, deliberately split by what they need to be true:
 *
 * - The **pure half** runs everywhere, always: the threshold arithmetic
 *   (strictly past the window — exactly 48h is still inside it) and the red
 *   sentence itself, including the promise that a healthy queue gets a message
 *   that says so rather than a misleading one.
 * - The **live half** is the gate's own read, and it is skip-gated by the same
 *   pair of facts the live-Postgres smokes skip on (`QUEUE_ALARM=1` and a
 *   `DATABASE_URL` to read through): the hosted nightly runs it when the
 *   repository defines `NIGHTLY_QUEUE_DATABASE_URL` — that is the paging: the
 *   gate goes red, the run page names the queue and the oldest application,
 *   and `src/lib/verification-queue.ts`'s message is the sentence a paged
 *   reader acts on. The runbook's "The verification queue's nightly alarm"
 *   holds the wiring.
 *
 * The flag without a database is refused rather than silently enjoyed as a
 * skip: an alarm asked to page someone must not read as green because it
 * cannot see.
 */

const HOURS = 3_600_000;
const NOW = new Date("2026-10-18T12:00:00.000Z");

function application(id: string, username: string, ageHours: number): PendingApplication {
  return {
    id,
    username,
    createdAt: new Date(NOW.getTime() - ageHours * HOURS),
  };
}

describe("the verification queue's alarm arithmetic", () => {
  it("holds nobody owed while every application is inside the window", () => {
    expect(overdueApplications([application("a", "sofia", 1), application("b", "kenji", 47)], NOW)).toEqual([]);
  });

  it("flags an application the moment it is past the window, oldest first", () => {
    // Strictly past: exactly the threshold is the boundary the application is
    // still inside, not the first hour it is overdue.
    expect(
      overdueApplications(
        [application("a", "sofia", DEFAULT_MAX_AGE_HOURS), application("b", "kenji", DEFAULT_MAX_AGE_HOURS + 25)],
        NOW,
      ),
    ).toEqual([application("b", "kenji", DEFAULT_MAX_AGE_HOURS + 25)]);
  });

  it("answers an empty queue with an empty list and a sentence that says so", () => {
    const overdue = overdueApplications([], NOW);
    expect(overdue).toEqual([]);
    expect(alarmMessage(overdue, DEFAULT_MAX_AGE_HOURS, NOW)).toContain(
      "No pending verification application has exceeded its review window.",
    );
  });

  it("writes the red sentence a paged reader acts on: who, how long, where, and the grant", () => {
    const overdue = overdueApplications(
      [application("a", "sofia", 50), application("b", "kenji", 73), application("c", "amara", 12)],
      NOW,
    );
    const message = alarmMessage(overdue, DEFAULT_MAX_AGE_HOURS, NOW);
    expect(message).toContain("2 pending verification application(s)");
    expect(message).toContain("the oldest, @kenji, for 73 hours");
    expect(message).toContain("at /admin → Verification");
    expect(message).toContain("npm run admin:grant -- <email>");
    // The healthy application is nobody's alarm: the message names only the
    // ones past the window.
    expect(message).not.toContain("@amara");
  });

  it("refuses a flag pointed at nothing rather than answering a queue it cannot read", () => {
    // If the operator asks the gate to page them, the alarm must never read
    // as pass by skipping: a flag without a database is a misconfiguration, and
    // this one line goes red wherever it happens.
    if (process.env.QUEUE_ALARM === "1" && !process.env.DATABASE_URL) {
      throw new Error(
        "QUEUE_ALARM=1 without DATABASE_URL: the alarm would read nothing. " +
          "Set DATABASE_URL (a read-only connection is enough — the alarm only reads " +
          "verification_requests and users) or drop the flag.",
      );
    }
  });
});

const LIVE_ALARM = process.env.QUEUE_ALARM === "1" && Boolean(process.env.DATABASE_URL);

/** The threshold the gate is being run at, validated rather than trusted blind. */
function hoursLimit(): number {
  const raw = process.env.QUEUE_ALARM_MAX_HOURS;
  const parsed = raw === undefined ? DEFAULT_MAX_AGE_HOURS : Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`QUEUE_ALARM_MAX_HOURS must be a positive number of hours, got "${raw ?? ""}"`);
  }
  return parsed;
}

(LIVE_ALARM ? describe : describe.skip)("the verification queue, read live", () => {
  it("judges the pending queue and hands the gate the red sentence when a reviewer is owed", async () => {
    // Driven dynamically for the same reason the live smokes are: the default
    // suite's skip must happen without the module (and its pool) ever loading.
    const dbModule = await import("@/lib/db");
    const db = dbModule.db;
    const { users, verificationRequests } = await import("@/lib/db/schema");
    const { eq } = await import("drizzle-orm");

    try {
      const pending = await db
        .select({
          id: verificationRequests.id,
          username: users.username,
          createdAt: verificationRequests.createdAt,
        })
        .from(verificationRequests)
        .innerJoin(users, eq(verificationRequests.userId, users.id))
        .where(eq(verificationRequests.status, "pending"));

      const now = new Date();
      const overdue = overdueApplications(pending, now, hoursLimit());
      // The gate's red is this expectation's failure message: the sentence the
      // paging reader acts on — who is owed, how long, and where to act —
      // rendered from the same moment the rows were judged against.
      expect(overdue, alarmMessage(overdue, hoursLimit(), now)).toEqual([]);
    } finally {
      // The house convention for every live read: end the pool before the
      // process can be left holding one.
      await dbModule.db.$client.end({ timeout: 5 });
    }
  });
});
