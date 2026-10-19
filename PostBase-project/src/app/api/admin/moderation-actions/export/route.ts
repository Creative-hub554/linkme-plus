import { db } from "@/lib/db";
import { moderationActions, users } from "@/lib/db/schema";
import { requireAuth, errorResponse } from "@/lib/api-helpers";
import { desc, eq } from "drizzle-orm";

/**
 * The moderation record, handed over in full.
 *
 * The list route serves the record paged for reading; a trust-and-safety
 * review needs the whole ledger in one hand — every action ever recorded,
 * with who made it, what it was about, why, and when — as a file an owner
 * can attach. This is that file: the same admin gate, the same rows the
 * history shows, no page limit (a handover is exactly the moment an
 * unexported page would be the one that mattered).
 *
 * The response is `text/csv` with an attachment's disposition headers, so a
 * plain link downloads it — no JavaScript, no fetch, no client-side assembly.
 * Fields are RFC-quoted so a reason holding a comma, a quote, or a newline
 * lands in one cell, not three.
 */

/**
 * Cells are written so a reviewer's spreadsheet reads them as data.
 *
 * RFC 4180 quotes: a field holding `"` is doubled, and any field holding a
 * delimiter, quote, or line break is wrapped in quotes. On top of that, a
 * value whose *first character* is a formula starter — `=`, `+`, `-`, `@` —
 * is prefixed with a literal apostrophe, so a reason like `=HYPERLINK(...)`
 * stays inert text rather than running when the CSV is opened. CSV quotes
 * alone are not sufficient because spreadsheets remove them before evaluating
 * a cell.
 *
 * Written with `includes` and a set of first characters rather than regular
 * expressions: this module `route.ts` is read by the source-scan guards, whose
 * scanner deliberately treats a regex literal as division, and a regex here
 * would swallow the exports the route-coverage guard reads. (That guard is
 * what makes this a named red rather than a silent miss.)
 */

/** The characters RFC 4180 says force quoting. */
const FORCES_QUOTE = ["\"", ",", "\r", "\n"];
/** The first characters a spreadsheet might read as a formula. */
const FORMULA_STARTERS = ["=", "+", "-", "@"];

function csvField(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  const startsLikeFormula = FORMULA_STARTERS.includes(text.slice(0, 1));
  // CSV quotes only delimit a cell; spreadsheet programs remove them before
  // deciding whether its contents are a formula.  A literal apostrophe is the
  // spreadsheet escape that survives CSV parsing and makes the value text.
  const safeText = startsLikeFormula ? `'${text}` : text;
  const holdsForcedCharacters = FORCES_QUOTE.some((character) => safeText.includes(character));
  if (!holdsForcedCharacters) return safeText;
  return `"${safeText.split('"').join('""')}"`;
}

function csvHeader(columns: string[]) {
  return columns.join(",");
}

export async function GET(request: Request) {
  const { session, error } = await requireAuth(request);
  if (error) return error;

  const [user] = await db.select().from(users).where(eq(users.id, session.user.id));

  if (!user || user.role !== "admin") {
    return errorResponse("Unauthorized", 403);
  }

  try {
    const actions = await db
      .select({
        id: moderationActions.id,
        action: moderationActions.action,
        targetType: moderationActions.targetType,
        targetId: moderationActions.targetId,
        reason: moderationActions.reason,
        createdAt: moderationActions.createdAt,
        actorUsername: users.username,
      })
      .from(moderationActions)
      .innerJoin(users, eq(moderationActions.actorId, users.id))
      .orderBy(desc(moderationActions.createdAt));

    const columns = ["id", "action", "targetType", "targetId", "reason", "createdAt", "actor"];
    const lines =
      csvHeader(columns) +
      "\r\n" +
      actions
        .map((row) =>
          [row.id, row.action, row.targetType, row.targetId, row.reason, row.createdAt?.toISOString() ?? "", row.actorUsername]
            .map(csvField)
            .join(","),
        )
        .join("\r\n");

    const date = new Date().toISOString().slice(0, 10);
    return new Response(lines, {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="moderation-history-${date}.csv"`,
      },
    });
  } catch (err) {
    console.error("Export moderation actions error:", err);
    return errorResponse("Failed to export moderation history", 500);
  }
}
