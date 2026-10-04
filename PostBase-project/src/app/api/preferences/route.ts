import { db, withDbRetry } from "@/lib/db";
import { ensureLocalUserProfile } from "@/lib/db/ensure-profile";
import { profiles } from "@/lib/db/schema";
import { requireAuth, successResponse, errorResponse } from "@/lib/api-helpers";
import { isAccent } from "@/lib/theme";
import { eq, sql } from "drizzle-orm";

/**
 * The signed-in member's display preferences.
 *
 * The accent is the only one today, and it is here rather than in the settings
 * form because it is not part of the profile: the settings page's `PUT
 * /api/users` writes the fields a reader sees on a public profile, and this
 * writes a choice that belongs to the account privately. Keeping them apart
 * also keeps this endpoint small enough to call from every page — the sync that
 * adopts an accent on a new device runs once per session, and `GET
 * /api/users` answers with three counts and a follow check beside the profile.
 *
 * Only the accent is stored, not the light/dark choice: that one belongs to the
 * device — the light you are reading in — and stays in the browser. See the
 * runbook's dark-mode section.
 *
 * No value is ever *read* from the client to be merged. `PUT /api/users` takes
 * `currentContactPreferences` from the caller because it sits on JSONB it is
 * editing, and that is a lost update waiting to happen; here the merge is one
 * statement in the database (`appearance || '{"accent": …}'`), so two devices
 * cannot clobber each other's keys and no previous state has to be trusted from
 * outside.
 */

interface Appearance {
  accent?: string;
}

export async function GET(request: Request) {
  const { session, error } = await requireAuth(request);
  if (error) return error;

  try {
    await withDbRetry(() => ensureLocalUserProfile(session.user));

    const [row] = await db
      .select({ appearance: profiles.appearance })
      .from(profiles)
      .where(eq(profiles.userId, session.user.id));

    return successResponse({ appearance: (row?.appearance as Appearance | null) ?? {} });
  } catch (err) {
    // An honest failure rather than an invented empty preference: the caller
    // keeps what the device already has and tries again later. The same answer
    // covers the window before this feature's migration has been applied, where
    // the column does not exist yet.
    console.error("Read preferences error:", err);
    return errorResponse("Preferences are temporarily unavailable", 503);
  }
}

export async function PUT(request: Request) {
  const { session, error } = await requireAuth(request);
  if (error) return error;

  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    return errorResponse("Expected a JSON body", 400);
  }

  const accent = (body as { accent?: unknown } | null)?.accent;
  // Validated against the one list of accents the picker offers, so an accent
  // added to the picker is accepted here without a second list to update.
  if (!isAccent(accent)) {
    return errorResponse("Unknown accent", 400);
  }

  try {
    await withDbRetry(() => ensureLocalUserProfile(session.user));

    const [updated] = await db
      .update(profiles)
      .set({
        // `||` merges the key into whatever is already there and leaves every
        // other key alone, in one statement.
        appearance: sql`coalesce(${profiles.appearance}, '{}'::jsonb) || ${JSON.stringify({ accent })}::jsonb`,
      })
      .where(eq(profiles.userId, session.user.id))
      .returning({ appearance: profiles.appearance });

    return successResponse({ appearance: (updated?.appearance as Appearance | null) ?? { accent } });
  } catch (err) {
    // The accent has already been applied in this browser (the picker is
    // optimistic and local-first); only the cross-device copy is lost, and the
    // next change or sign-in tries again.
    console.error("Update preferences error:", err);
    return errorResponse("Preferences are temporarily unavailable", 503);
  }
}
