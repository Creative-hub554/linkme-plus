/**
 * The Google Drive side of the media archive: refresh-token auth, resumable
 * upload, and the URL forms an archived object is served from afterwards.
 *
 * Drive is not a CDN and this module does not pretend otherwise — it is the
 * cold tier the archive pass moves media into once its three days of hot
 * hosting are up. The client is deliberately small: upload a stream, make a
 * file world-readable, delete a file. No listing, no search, no downloads —
 * the pass never needs them, and an archive tool with more surface than that
 * is a tool that eventually deletes the wrong thing.
 *
 * Three facts about Drive shape every function below; all three were verified
 * against current documentation rather than memory (sources live in
 * `docs/GOOGLE-DRIVE-ARCHIVE.md`):
 *
 * 1. Uploads are resumable: metadata is POSTed to start a session, which
 *    answers with a session URI; chunks are then PUT to that URI with a
 *    `Content-Range` header. Every chunk before the last one reports progress
 *    with a `308 Resume Incomplete` and a `Range` header naming the bytes the
 *    server holds so far.
 * 2. Nothing is publicly readable by default. A file becomes servable to an
 *    anonymous `<img>` tag only after `permissions.create` with
 *    `type: "anyone", role: "reader"` — the archive pass calls it after every
 *    upload and before any Drive URL is written into the database.
 * 3. There is no documented stable URL that serves a file's raw bytes to an
 *    unauthenticated browser for every media type. `drivePublicUrl` picks the
 *    best-known form per type and the doc records which ones are documented
 *    and which are long-standing convention.
 *
 * Auth is a refresh token, not a user session: `scripts/gdrive-auth.mjs`
 * performs the one-time consent dance and hands back the token, which this
 * module exchanges for short-lived access tokens on demand. A token issued to
 * an OAuth app still in *Testing* status expires after seven days — publishing
 * the consent screen (even just for yourself) is part of the setup, and the
 * error message below says so when the refresh starts failing.
 */

/** Drive's resumable upload endpoint, and the API root every call shares. */
const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

/**
 * The scope: full Drive access, deliberately not `drive.file`.
 *
 * `drive.file` would only see files this app created, which sounds like the
 * least privilege worth taking — until the operator points the archive at a
 * folder they already keep, which `drive.file` cannot see, or wants the app to
 * clean up a file by hand. This is a personal automation logged in with one
 * Google account; the narrower scope would buy little and cost support.
 */
export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";

/**
 * Chunk size for resumable uploads: 8 MiB.
 *
 * Google requires every non-final chunk to be a multiple of 256 KiB, and 8 MiB
 * keeps a stalled upload's wasted work bounded while staying far below the
 * request-body limits that would force the session to restart.
 */
export const DRIVE_UPLOAD_CHUNK = 8 * 1024 * 1024;

/** How many times a `308` that confirmed nothing is answered with the same chunk. */
const MAX_EMPTY_CONFIRMATIONS = 3;

export interface DriveConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  /** When set, uploaded files land in this folder instead of My Drive's root. */
  folderId?: string;
}

/**
 * Reads the config out of an environment record, or `null` when any of the
 * three required pieces is missing.
 *
 * The three are all-or-nothing on purpose: a half-configured archive (client
 * id but no token) must read as "not configured" rather than failing at upload
 * time — the scheduled pass logs one line and does nothing until the operator
 * finishes the setup.
 */
export function driveConfigFromEnv(
  env: Record<string, string | undefined> = globalThis.process?.env ?? {},
): DriveConfig | null {
  const clientId = env.GDRIVE_CLIENT_ID?.trim();
  const clientSecret = env.GDRIVE_CLIENT_SECRET?.trim();
  const refreshToken = env.GDRIVE_REFRESH_TOKEN?.trim();
  if (!clientId || !clientSecret || !refreshToken) return null;
  const folderId = env.GDRIVE_FOLDER_ID?.trim();
  return { clientId, clientSecret, refreshToken, folderId: folderId || undefined };
}

/**
 * The URL an archived file is served from, chosen by what the file is.
 *
 * - Images: `lh3.googleusercontent.com/d/{id}` returns the raw bytes to
 *   anyone who asks. This is the form Drive's own previews use; it is not
 *   documented as a public-serving API, but it is long-standing, widely
 *   relied upon, and the only form that works inside an `<img>` tag without a
 *   signed-in session.
 * - PDFs: Drive's own viewer page. A `uc?export=download` link would hand the
 *   browser an attachment instead of something a page can display inline.
 * - Everything else — video above all — falls back to `uc?export=download`.
 *   Research found no documented stable raw-bytes URL for video: this form
 *   streams smaller files but may answer larger ones with an interstitial.
 *   The upload cap (`MAX_VIDEO_SIZE` in `r2.ts`, 100 MB) keeps us in the range
 *   where it generally works; the first-run verification step in the doc
 *   exists precisely because this is the one form we cannot stand behind
 *   unconditionally.
 */
export function drivePublicUrl(fileId: string, mimeType: string | null | undefined): string {
  const mime = (mimeType ?? "").toLowerCase();
  if (mime.startsWith("image/")) return `https://lh3.googleusercontent.com/d/${fileId}`;
  if (mime === "application/pdf") return `https://drive.google.com/file/d/${fileId}/preview`;
  return `https://drive.google.com/uc?export=download&id=${fileId}`;
}

/**
 * The inverse of `drivePublicUrl`: the file id out of a URL we generated, or
 * `null` for anything else.
 *
 * This is the parser `deleteStoredObjects` uses when a post is deleted, and
 * its accuracy is what keeps that delete honest — it must recognise exactly
 * the three shapes above and nothing else, or the app would try to delete
 * strangers' Drive files. (The mapping table is the second rail: only ids this
 * database recorded as ours are ever deleted, no matter what parses.)
 */
const ARCHIVED_URL_PATTERNS: RegExp[] = [
  /^https:\/\/lh3\.googleusercontent\.com\/d\/([A-Za-z0-9_-]+)\/?$/,
  /^https:\/\/drive\.google\.com\/file\/d\/([A-Za-z0-9_-]+)\/preview\/?$/,
  /^https:\/\/drive\.google\.com\/uc\?(?:[^#]*&)?id=([A-Za-z0-9_-]+)(?:[#&].*)?$/,
];

export function archivedFileIdFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  for (const pattern of ARCHIVED_URL_PATTERNS) {
    const match = pattern.exec(url);
    if (match) return match[1];
  }
  return null;
}

export interface DriveUploadInput {
  /** The R2 key — kept verbatim as the Drive file name so a file can be traced back to its origin. */
  name: string;
  mimeType: string;
  size: number;
  body: ReadableStream<Uint8Array>;
}

export interface UploadedFile {
  id: string;
  /** Drive answers sizes as a *string* of bytes; the pass converts before comparing. */
  size?: string | number;
  md5Hash?: string;
  mimeType?: string;
}

export interface DriveClient {
  upload(input: DriveUploadInput): Promise<UploadedFile>;
  makePublic(fileId: string): Promise<void>;
  deleteFile(fileId: string): Promise<void>;
}

/**
 * Drains a byte stream into fixed-size buffers.
 *
 * A single `read()` may return more bytes than the buffer holds or fewer than
 * it wants, so what is left over has to go somewhere between reads — the queue
 * below is that somewhere. It keeps the upload loop free of stream quirks:
 * it either fills a chunk or reports that the stream is done, and the
 * distinction is exactly the one between "not the last chunk" and "the last
 * chunk".
 */
class ChunkReader {
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>;
  private queue: Uint8Array[] = [];
  private queued = 0;

  constructor(body: ReadableStream<Uint8Array>) {
    this.reader = body.getReader();
  }

  /** Fills `out`; `done` is true when the stream drained while filling it. */
  async fill(out: Uint8Array): Promise<{ written: number; done: boolean }> {
    let written = 0;
    for (;;) {
      while (this.queued > 0 && written < out.length) {
        const head = this.queue[0];
        const take = Math.min(out.length - written, head.length);
        out.set(head.subarray(0, take), written);
        written += take;
        if (take === head.length) this.queue.shift();
        else this.queue[0] = head.subarray(take);
        this.queued -= take;
      }
      if (written === out.length) return { written, done: false };
      const { done, value } = await this.reader.read();
      if (done) return { written, done: true };
      if (value && value.length > 0) {
        this.queue.push(value);
        this.queued += value.length;
      }
    }
  }
}

/** The last byte a `Range: bytes=0-N` header confirms, or `null` if it names none. */
function parseRangeEnd(header: string | null): number | null {
  if (!header) return null;
  const match = /bytes=(\d+)-(\d+)/.exec(header);
  if (!match) return null;
  return Number.parseInt(match[2], 10);
}

async function responseText(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text.length > 500 ? `${text.slice(0, 500)}…` : text;
  } catch {
    return "(no body readable)";
  }
}

class DriveClientImpl implements DriveClient {
  private token: { value: string; expiresAt: number } | null = null;
  private readonly fetchImpl: typeof fetch;
  private readonly chunkSize: number;

  constructor(
    private readonly config: DriveConfig,
    options: { fetchImpl?: typeof fetch; chunkSize?: number } = {},
  ) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.chunkSize = options.chunkSize ?? DRIVE_UPLOAD_CHUNK;
  }

  /**
   * A currently-valid access token, refreshed when the cached one is within a
   * minute of expiry.
   *
   * The one-minute margin exists because an upload can span many requests: a
   * token that dies mid-session would fail the next chunk's PUT, and refreshing
   * up front costs nothing next to restarting an 8 MiB chunk.
   */
  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value;

    const body = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      refresh_token: this.config.refreshToken,
    });
    const response = await this.fetchImpl(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!response.ok) {
      const detail = await responseText(response);
      const hint =
        response.status === 400 || response.status === 401
          ? " If the response says invalid_grant, the refresh token has expired: tokens issued to an OAuth app still in Testing status last 7 days — publish the consent screen (see docs/GOOGLE-DRIVE-ARCHIVE.md) and run scripts/gdrive-auth.mjs again."
          : "";
      throw new Error(`Drive token refresh failed (${response.status}): ${detail}.${hint}`);
    }
    const json = (await response.json()) as { access_token?: string; expires_in?: number };
    if (!json.access_token) throw new Error("Drive token refresh answered without an access_token");
    this.token = {
      value: json.access_token,
      // The clock starts when the response arrived, not when Google's number
      // was written — skewed `expires_in` values then only cost us earlier
      // refreshes, never late ones.
      expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
    };
    return this.token.value;
  }

  /** `fetch` with the bearer token attached, retrying once through a forced refresh on a 401. */
  private async apiFetch(url: string, init: RequestInit, retried = false): Promise<Response> {
    const token = await this.accessToken();
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${token}`);
    const response = await this.fetchImpl(url, { ...init, headers });
    if (response.status === 401 && !retried) {
      // The cached token was good a moment ago and the server disagrees: drop
      // it, mint a new one, and give the call exactly one second chance.
      this.token = null;
      return this.apiFetch(url, init, true);
    }
    return response;
  }

  private async putChunk(sessionUri: string, bytes: Uint8Array, contentRange: string): Promise<Response> {
    return this.fetchImpl(sessionUri, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${await this.accessToken()}`,
        "Content-Range": contentRange,
      },
      // The Workers runtime accepts a typed-array body; the DOM lib's
      // `BodyInit` still types it as `Uint8Array<ArrayBuffer>` while stream
      // reads hand back `ArrayBufferLike`, so the cast is the type's lag,
      // not an unsound buffer.
      body: bytes as unknown as BodyInit,
    });
  }

  /**
   * Uploads one object through the resumable protocol and returns the file
   * resource Drive created.
   *
   * Failure handling is the archive's retry model in miniature: anything the
   * server does not confirm cleanly throws, the pass records the failure and
   * moves on, and the next hourly run starts this object's upload from zero.
   * Sessions are cheap; a half-written file that the pass believed had
   * succeeded is not.
   */
  async upload(input: DriveUploadInput): Promise<UploadedFile> {
    const { name, mimeType, size, body } = input;

    const metadata: Record<string, unknown> = { name, mimeType };
    if (this.config.folderId) metadata.parents = [this.config.folderId];
    const initiate = await this.apiFetch(
      `${DRIVE_UPLOAD_API}/files?uploadType=resumable&fields=${encodeURIComponent("id,size,md5Hash,mimeType")}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(metadata),
      },
    );
    if (!initiate.ok) {
      throw new Error(`Drive resumable upload failed to start (${initiate.status}): ${await responseText(initiate)}`);
    }
    const sessionUri = initiate.headers.get("location");
    if (!sessionUri) throw new Error("Drive resumable upload started without a session URI");

    // Zero-byte objects take the wildcard form: there is no byte range to
    // name, and the protocol completes such an upload with `bytes */0`.
    if (size === 0) {
      const response = await this.putChunk(sessionUri, new Uint8Array(0), "bytes */0");
      if (!response.ok) {
        throw new Error(`Drive upload of empty object failed (${response.status}): ${await responseText(response)}`);
      }
      return (await response.json()) as UploadedFile;
    }

    const chunks = new ChunkReader(body);
    const buffer = new Uint8Array(this.chunkSize);
    let start = 0;
    let pending: { bytes: Uint8Array; start: number; isFinal: boolean } | null = null;
    let emptyConfirmations = 0;

    for (;;) {
      if (!pending) {
        const { written, done } = await chunks.fill(buffer);
        if (done && written === 0) {
          // The stream drained with nothing left to send, so either the server
          // already finalized (the `response.ok` above) or it never did — and
          // in the second case there is no honest range to name: a buffer that
          // cannot be filled must not be advertised as a chunk.
          throw new Error(
            start >= size
              ? "Drive confirmed every byte but never finalized the upload"
              : `stream ended after ${start} of the ${size} bytes R2 reported`,
          );
        }
        pending = { bytes: buffer.subarray(0, written), start, isFinal: done };
      }

      if (pending.isFinal && pending.start + pending.bytes.length !== size) {
        // The final chunk is the one place the range is derived from the size
        // R2 reported rather than the bytes in hand — and a buffer holding
        // fewer than promised must not be sent under a range that claims the
        // rest, because Drive would record a file whose tail is whatever
        // happened to pad the body. Fail the object instead; the next run
        // re-reads it from R2 and tries again.
        throw new Error(
          `stream ended after ${pending.start + pending.bytes.length} of the ${size} bytes R2 reported`,
        );
      }
      const contentRange = pending.isFinal
        ? `bytes ${pending.start}-${size - 1}/${size}`
        : `bytes ${pending.start}-${pending.start + pending.bytes.length - 1}/${size}`;
      const response = await this.putChunk(sessionUri, pending.bytes, contentRange);

      if (response.ok) return (await response.json()) as UploadedFile;
      if (response.status !== 308) {
        throw new Error(`Drive upload chunk failed (${response.status}): ${await responseText(response)}`);
      }

      const confirmedEnd = parseRangeEnd(response.headers.get("range"));
      if (confirmedEnd === null) {
        // A `308` with no `Range` means the server received nothing: resend
        // the same chunk, but not forever — three silent non-answers in a row
        // mean the session is dead and the next run should start a new one.
        emptyConfirmations += 1;
        if (emptyConfirmations > MAX_EMPTY_CONFIRMATIONS) {
          throw new Error("Drive upload stalled: three chunk PUTs were answered with no progress");
        }
        continue;
      }

      const sentEnd = pending.start + pending.bytes.length - 1;
      if (confirmedEnd !== sentEnd) {
        // Half a chunk arrived. The stream cannot rewind to resend the missing
        // tail, so this session is abandoned rather than stitched: a resumed
        // upload that skipped bytes would corrupt the file silently, and the
        // archive's whole contract is that what lands on Drive is byte-identical
        // to what left R2.
        throw new Error(
          `Drive confirmed bytes through ${confirmedEnd} but ${sentEnd} were sent; abandoning session (next run re-uploads)`,
        );
      }
      if (pending.isFinal) {
        // The final chunk was sent in full and the server still says continue:
        // that is not a state the protocol produces, so treat it as failure
        // rather than send another chunk the server did not ask for.
        throw new Error("Drive answered 308 after the final chunk was received in full");
      }

      emptyConfirmations = 0;
      start = confirmedEnd + 1;
      pending = null;
    }
  }

  /** Makes a file readable by anyone with the link — the state every archived URL assumes. */
  async makePublic(fileId: string): Promise<void> {
    const response = await this.apiFetch(`${DRIVE_API}/files/${fileId}/permissions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "anyone", role: "reader" }),
    });
    // 409 means the file is already public — a retried pass, or an operator
    // who set it up by hand. That is the state we want, not an error.
    if (!response.ok && response.status !== 409) {
      throw new Error(`Drive permission change failed (${response.status}): ${await responseText(response)}`);
    }
  }

  /** Removes a file from Drive. A 404 is success, same as deleting an absent R2 key. */
  async deleteFile(fileId: string): Promise<void> {
    const response = await this.apiFetch(`${DRIVE_API}/files/${fileId}`, { method: "DELETE" });
    if (!response.ok && response.status !== 404) {
      throw new Error(`Drive delete failed for "${fileId}" (${response.status}): ${await responseText(response)}`);
    }
  }
}

export function createDriveClient(
  config: DriveConfig,
  options: { fetchImpl?: typeof fetch; chunkSize?: number } = {},
): DriveClient {
  return new DriveClientImpl(config, options);
}
