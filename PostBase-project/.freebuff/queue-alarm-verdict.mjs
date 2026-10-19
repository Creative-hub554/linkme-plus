/**
 * The verification queue's alarm verdict, as one shared seam.
 *
 * The night's armed suite may red — a reviewer is owed an application — and the
 * run page is where the paging names who. The failure *message* carries the
 * sentence, but the sentence arrives through the assertion machinery wrapped in
 * vitest's own punctuation (`AssertionError: … : expected … to deeply equal []`),
 * where parsing prose to unwind it would be the runner reaching into test style
 * it does not own. So the armed test also publishes this run's judgment as data
 * beside the suite it ran — the structured rows a reader of the run page wants
 * (the handles owed, each with the hours it has waited, oldest first) — and the
 * runner folds it into the `--json` report for `.freebuff/nightly-report.mjs` to
 * render, exactly the way the collect-time reporter's sidecars ride.
 *
 * One file owns the path and the shape, so the writer and the two readers cannot
 * drift apart, and a stray file at that path is not a verdict — the shape check
 * is the same fail-silent read the readings and the run report take: an absent,
 * unreadable or wrong-shape file is no verdict, which every consumer omits
 * rather than rendering as an empty alarm.
 */

import { isAbsolute, join } from "node:path";
export const QUEUE_ALARM_FILE = ".ci-queue-alarm-verdict.json";

/** The env seam the runner's own tests redirect the sidecar through, for the same reason
 * every reading's path has one: a suite that spawns the runner must be able to point the
 * clear-and-read at scratch, so it can never delete the real sidecar an armed alarm test
 * wrote while it ran. A relative value resolves against the root; the real checkout never
 * sets this — which is how the writer and the reader agree about a file whose name is
 * declared once, here. */
export const QUEUE_ALARM_ENV = "CI_QUEUE_ALARM_FILE";

/** The sidecar's absolute path for the root a consumer runs in — the env override when one
 * is set, the declared dot-file of the checkout otherwise. */
export function queueAlarmPath(root) {
  const override = process.env[QUEUE_ALARM_ENV];
  if (override !== undefined && override !== "") {
    return isAbsolute(override) ? override : join(root, override);
  }
  return join(root, ".freebuff", QUEUE_ALARM_FILE);
}

/**
 * The verdict as the test wrote it: the threshold the queue was judged against,
 * the moment the rows were judged (ISO — a stale sidecar a later run never reads,
 * because the runner clears the path per attempt), the number of applications
 * the suite judged — `pending`, the queue's *settled size*, everything in the
 * window as well as past it, so a night's quiet queue is a number rather than
 * an empty list — and the applications past the window, oldest first — the
 * order the suite judged them in and the order the page should name them in.
 *
 * A healthy armed run uses the same shape with an empty `overdue`, so the page
 * can say the queue is inside its window *on an armed connection* — and an
 * unarmed one never writes the file at all, which is the difference an alarm on
 * duty makes visible.
 */
export function parseQueueAlarmVerdict(text) {
  if (typeof text !== "string") return null;
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    return null;
  }
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) return null;
  const overdue = overdueRows(payload.overdue);
  const maxAgeHours = requirePositiveNumber(payload.maxAgeHours);
  const pending = requireNonNegativeInteger(payload.pending);
  if (maxAgeHours === null || pending === null || overdue === null) return null;
  if (typeof payload.judgedAt !== "string" || payload.judgedAt.trim() === "") return null;
  // One number must not be asked to describe a queue smaller than its own red:
  // nothing can be owed past the window without being one of the applications
  // the suite judged, so a verdict whose rows exceed its own total is not a
  // verdict either — the same fail-silent answer every wrong shape takes.
  if (overdue.length > pending) return null;
  return { maxAgeHours, judgedAt: payload.judgedAt, pending, overdue };
}

/** The rows, oldest first, each with a named handle and a non-negative wait. */
function overdueRows(rows) {
  if (!Array.isArray(rows)) return null;
  const entries = [];
  for (const row of rows) {
    if (row === null || typeof row !== "object" || Array.isArray(row)) return null;
    if (typeof row.id !== "string" || row.id.trim() === "") return null;
    if (typeof row.username !== "string" || row.username.trim() === "") return null;
    const waitHours = requireNonNegativeNumber(row.waitHours);
    if (waitHours === null) return null;
    entries.push({ id: row.id, username: row.username, waitHours });
  }
  // The order is a promise the alarm test makes (oldest first); the page keeps it.
  entries.sort((a, b) => b.waitHours - a.waitHours);
  return entries;
}

function requirePositiveNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function requireNonNegativeNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function requireNonNegativeInteger(value) {
  const number = requireNonNegativeNumber(value);
  return Number.isInteger(number) ? number : null;
}
