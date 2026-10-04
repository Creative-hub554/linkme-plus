/**
 * Opaque keyset pagination cursors.
 *
 * A cursor points at the last row a client has already seen; the next page is
 * everything that sorts strictly after it. That keeps results stable while rows
 * are being inserted — an offset shifts the whole window when a new row lands,
 * replaying or skipping items at the boundary. The sort key and a unique
 * tiebreaker are encoded together so rows sharing a timestamp still have a
 * deterministic order.
 *
 * The cursor carries the timestamp as *text exactly as Postgres renders it*
 * (the `to_char(...)` key selected alongside each row) rather than a JS Date.
 * `posts.created_at` is a
 * `timestamp without time zone`, and postgres.js reads that back as a local
 * Date while writing params as UTC — round-tripping through a Date would shift
 * the boundary by the machine's UTC offset and silently skip or repeat rows.
 * Sending the database's own text back for an explicit `::timestamp` cast
 * avoids the asymmetry entirely.
 *
 * Cursors are deliberately opaque: clients must pass `pagination.nextCursor`
 * back verbatim rather than constructing their own.
 */

/** Matches `YYYY-MM-DDTHH:MM:SS.ffffff`, the format the key selector produces. */
const TIMESTAMP_KEY = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}$/;
// Ids are compared against uuid columns, so validate the shape here to turn a
// crafted cursor into a 400 rather than a database type error.
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const CURSOR_SEPARATOR = "|";

/** Keyset position: the ordering key plus a unique tiebreaker. */
export interface CursorPosition {
  /** Postgres-formatted timestamp text for the last row of the previous page. */
  key: string;
  id: string;
}

function toBase64Url(value: string): string {
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): string | null {
  const normalised = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalised.length % 4 === 0 ? "" : "=".repeat(4 - (normalised.length % 4));
  try {
    return atob(normalised + padding);
  } catch {
    return null;
  }
}

/** Encodes the last-seen row into a URL-safe opaque cursor. */
export function encodeCursor(key: string, id: string): string {
  return toBase64Url(`${key}${CURSOR_SEPARATOR}${id}`);
}

/**
 * Decodes a client-supplied cursor. Returns null for anything malformed so
 * callers can answer with a clear 400 instead of running an unpredictable
 * query (or leaking a 500 from a bad timestamp).
 */
export function decodeCursor(raw: string | null | undefined): CursorPosition | null {
  if (!raw) return null;

  const decoded = fromBase64Url(raw);
  if (!decoded) return null;

  const separatorIndex = decoded.indexOf(CURSOR_SEPARATOR);
  if (separatorIndex <= 0) return null;

  const key = decoded.slice(0, separatorIndex);
  const id = decoded.slice(separatorIndex + 1);

  // Validate strictly: these values are bound into the query.
  if (!TIMESTAMP_KEY.test(key) || !UUID.test(id)) return null;

  return { key, id };
}

/**
 * True for a value shaped like a uuid. Ids are bound into queries, so callers
 * validate before binding to answer with a 400 rather than a type error.
 */
export function isUuid(value: string): boolean {
  return UUID.test(value);
}

/** Normalises a client limit into a safe page size. */
export function clampLimit(raw: string | null | undefined, fallback = 20, max = 100): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, 1), max);
}
