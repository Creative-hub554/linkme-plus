import { isAccent, type Accent } from "@/lib/theme";

/**
 * The account half of the accent.
 *
 * The browser half (the stored value, the applied class) is `ThemeProvider`'s;
 * this module is the two calls that put the same fact on the member's profile
 * so it follows them to another machine. Kept apart from the provider because
 * they answer to different things: the provider owns *where the choice comes
 * from on this device*, and this owns *what the account says*, which two
 * different components need — the sync below, and the picker that writes.
 *
 * Both calls fail quietly and report it in their return value. Nothing here is
 * worth an error banner: an accent that cannot be saved to the account is still
 * saved to the browser and still on screen, and the next change tries again.
 */

export interface AccountAppearance {
  accent?: Accent;
}

/** The account's appearance, or `null` when it could not be read. */
export async function fetchAccountAppearance(): Promise<AccountAppearance | null> {
  try {
    const response = await fetch("/api/preferences", { cache: "no-store" });
    if (!response.ok) return null;
    const payload = (await response.json()) as { appearance?: unknown };
    const appearance = payload?.appearance;
    if (!appearance || typeof appearance !== "object") return {};
    // Anything the picker does not know is dropped rather than applied, so an
    // accent renamed on the server cannot paint an undefined accent on a page.
    const accent = (appearance as { accent?: unknown }).accent;
    return { accent: isAccent(accent) ? accent : undefined };
  } catch {
    return null;
  }
}

/** Writes the accent to the account. `false` means "keep it on this device only". */
export async function saveAccountAccent(accent: Accent): Promise<boolean> {
  try {
    const response = await fetch("/api/preferences", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accent }),
    });
    return response.ok;
  } catch {
    return false;
  }
}
