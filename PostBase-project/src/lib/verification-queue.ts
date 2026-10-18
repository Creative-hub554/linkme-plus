/**
 * The verification queue's own alarm arithmetic, pure so any caller can be
 * tested without a database.
 *
 * The nightly gate is where the alarm runs (see `.freebuff/run.md`'s
 * "The verification queue's nightly alarm"), but deciding *which* pending
 * application a human is now owed by, and writing the one sentence that says
 * what to do about it, is independent of where the rows come from: the same
 * held-out shape serves the suite's fake-driven tests and the gate's live
 * read alike. Verification is never self-awarded — an application sits
 * `pending` until an administrator decides it — so a queue nobody is watching
 * is the one state the admin surface cannot rescue by itself.
 */

/** A pending application as the alarm reads it: the queue row joined to its owner's handle. */
export interface PendingApplication {
  id: string;
  username: string;
  createdAt: Date;
}

/** How long an application may sit before the night it is judged goes red. */
export const DEFAULT_MAX_AGE_HOURS = 48;

/** The reviewer is owed an application that has waited more than the threshold. */
export function isOverdue(application: PendingApplication, now: Date, maxAgeHours: number): boolean {
  return (now.getTime() - application.createdAt.getTime()) / 3_600_000 > maxAgeHours;
}

/** The pending applications a reviewer is now owed, oldest first. */
export function overdueApplications(
  applications: PendingApplication[],
  now: Date,
  maxAgeHours: number = DEFAULT_MAX_AGE_HOURS,
): PendingApplication[] {
  return applications
    .filter((application) => isOverdue(application, now, maxAgeHours))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

/**
 * The one red sentence the gate carries: who is owed, how long, and where the
 * judgment happens — so a paged reader acts rather than looks things up.
 * `now` is the caller's clock, the same one `overdueApplications` took: the
 * sentence's ages must be computed from the same moment the rows were judged
 * against, not from whenever the message was rendered.
 */
export function alarmMessage(overdue: PendingApplication[], maxAgeHours: number, now: Date): string {
  if (overdue.length === 0) {
    return "No pending verification application has exceeded its review window.";
  }
  const oldest = overdue[0];
  const oldestAgeHours = Math.floor((now.getTime() - oldest.createdAt.getTime()) / 3_600_000);
  const handles = overdue
    .slice(0, 5)
    .map((application) => `@${application.username}`)
    .join(", ");
  const more = overdue.length > 5 ? ` (and ${overdue.length - 5} more)` : "";
  return (
    `${overdue.length} pending verification application(s) have waited longer than ${maxAgeHours} hours ` +
    `— the oldest, @${oldest.username}, for ${Math.max(oldestAgeHours, 0)} hours (${handles}${more}). ` +
    `Page a reviewer: the queue is at /admin → Verification, and approval there is what sets the badge. ` +
    `If nobody holds the role, grant one: npm run admin:grant -- <email>.`
  );
}
