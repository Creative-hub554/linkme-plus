/**
 * The media archive: the hourly pass that moves R2 objects older than three
 * days into Google Drive and rewrites the database to point at them there.
 *
 * The shape of one pass, and why it is shaped that way:
 *
 * 1. **List** every object R2 still holds. Objects younger than the grace
 *    period are the app's hot tier and are left alone; that single age rule is
 *    the whole of "new posts stay on hosting for three days" — old uploads are
 *    already past it, so the same rule that archives them immediately also
 *    holds new media for exactly its three days.
 * 2. **Upload** each aged object to Drive, verify Drive's copy is the same
 *    size (and the same md5 when both sides know one), and make it public.
 *    Nothing is written and nothing is deleted until the copy is proven.
 * 3. **Record** the mapping in `archived_objects`. The row is the durable fact
 *    this whole design leans on: it is what lets a crashed run resume without
 *    re-uploading, and it is the allow-list `deleteStoredObjects` consults
 *    before removing anything from Drive.
 * 4. **Rewrite** every URL column, jsonb config, and array that may hold the
 *    old public URL, in batched statements (one per column per pass).
 * 5. **Delete** the R2 objects — last, so every crash window between these
 *    steps leaves the app still serving media: an interruption before the
 *    rewrite leaves rows pointing at R2, and the next run's resume path (rows
 *    in `archived_objects` whose object is still in R2) finishes the rewrite
 *    and the delete without uploading anything twice.
 *
 * The pass never throws: one object's failure is a line in the report and a
 * retry next hour, because the failure mode that matters — a row pointing at
 * a file that is gone — is the one this ordering makes unreachable.
 */

import { inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { archivedObjects } from "@/lib/db/schema";
import { drivePublicUrl, type DriveClient } from "@/lib/gdrive";

/** One object as the archive sees it from R2. */
export interface StoredObject {
  key: string;
  uploaded: Date;
  size: number;
  /** R2's etag — the md5 hex for single-part uploads, composite (contains `-`) otherwise. */
  etag?: string | null;
  contentType?: string | null;
}

export interface ArchiveStorage {
  /** Every object in the bucket, following list cursors to the end. */
  listAll(): Promise<StoredObject[]>;
  /** The object's body plus its size/etag/content type, or `null` if it vanished. */
  get(key: string): Promise<(Omit<StoredObject, "key" | "uploaded"> & { body: ReadableStream<Uint8Array> }) | null>;
  delete(key: string): Promise<void>;
}

/** One archived file as the mapping table holds it. */
export interface ArchivedRow {
  r2Key: string;
  driveFileId: string;
  oldUrl: string;
  newUrl: string;
  contentType: string | null;
  sizeBytes: number;
  md5Hex: string | null;
}

export interface ArchiveStore {
  findArchived(keys: string[]): Promise<ArchivedRow[]>;
  insertArchived(row: ArchivedRow): Promise<void>;
}

/** Runs one batched SQL statement; the pass executes one per rewrite column. */
export type ExecStatement = (text: string, params: unknown[]) => Promise<void>;

export interface ArchiveConfig {
  /** The R2 public URL base (no trailing slash) that stored rows are prefixed with. */
  publicUrlBase: string;
  graceDays: number;
  batchLimit: number;
  dryRun: boolean;
  now: Date;
}

export interface ArchiveReport {
  /** `"unconfigured"` when the pass declined to run; `null` otherwise. */
  skipped: "unconfigured" | null;
  listed: number;
  /** Objects listed but left on R2 for being too young. */
  young: number;
  /** Objects past the grace period that were uploaded this pass. */
  uploaded: number;
  /** Rows whose R2 copy still existed and whose rewrite+delete this pass finished. */
  resumed: number;
  rewrittenStatements: number;
  deleted: number;
  /** Dry run only: the keys a real pass would have uploaded. */
  wouldArchive: string[];
  failed: Array<{ key: string; error: string }>;
}

export interface ArchivePassDeps {
  storage: ArchiveStorage;
  drive: DriveClient | null;
  store: ArchiveStore;
  exec: ExecStatement;
  config: ArchiveConfig;
  log?: (message: string) => void;
}

/** How a column stores a URL — three shapes, three rewriting expressions. */
export type RewriteKind = "text" | "jsonb" | "array";

export interface RewriteTarget {
  table: string;
  column: string;
  kind: RewriteKind;
}

/**
 * Every column that may hold an R2 public URL, across every table.
 *
 * This list is not a performance optimisation over scanning for URLs; it is
 * the correctness surface. A URL the rewrite misses is a row that keeps
 * pointing at an object the pass is about to delete — a broken image the
 * archive created — so the guard test in `media-archive.test.ts` walks the
 * real schema and fails when a `*_url` column is added without being either
 * rewritten here or explicitly exempted below with a reason.
 *
 * Beyond the url-named columns, three kinds of extras are included on
 * purpose:
 * - jsonb configs that embed photo URLs (`cover_config` and friends), rewritten
 *   by casting the document to text, replacing, and casting back — a jsonb
 *   rebuild would need its shape, and the shape is the client's to change;
 * - URL arrays such as `photo_urls` and `evidence_urls`, via `array_replace`;
 * - the three free-text content columns, because a link pasted into a post,
 *   comment, or message is a stored URL too and would go dead with the object.
 *   The `like` predicates keep that cheap: a statement that matches nothing is
 *   a no-op scan, not a rewrite.
 */
export const ARCHIVE_REWRITE_TARGETS: readonly RewriteTarget[] = [
  // profiles: identity images, cover media, and the cover-studio configs
  { table: "profiles", column: "avatar_url", kind: "text" },
  { table: "profiles", column: "cover_url", kind: "text" },
  { table: "profiles", column: "cover_video_url", kind: "text" },
  { table: "profiles", column: "short_video_cover_url", kind: "text" },
  { table: "profiles", column: "cover_config", kind: "jsonb" },
  { table: "profiles", column: "short_video_cover_config", kind: "jsonb" },
  // Pages, groups, storefronts, companies: the identity images
  { table: "pages", column: "avatar_url", kind: "text" },
  { table: "pages", column: "cover_url", kind: "text" },
  { table: "groups", column: "cover_url", kind: "text" },
  { table: "storefronts", column: "avatar_url", kind: "text" },
  { table: "storefronts", column: "cover_url", kind: "text" },
  { table: "companies", column: "logo_url", kind: "text" },
  // The media tables themselves
  { table: "post_media", column: "url", kind: "text" },
  { table: "comment_media", column: "url", kind: "text" },
  { table: "listing_media", column: "url", kind: "text" },
  { table: "product_variants", column: "image_url", kind: "text" },
  { table: "job_applications", column: "cv_url", kind: "text" },
  { table: "ad_creatives", column: "image_url", kind: "text" },
  // Cover videos: the file, its poster frame, and the template config
  { table: "cover_videos", column: "video_url", kind: "text" },
  { table: "cover_videos", column: "thumbnail_url", kind: "text" },
  { table: "cover_videos", column: "customization", kind: "jsonb" },
  // Short video covers: every image and video the studio assembles
  { table: "short_video_covers", column: "profile_photo_url", kind: "text" },
  { table: "short_video_covers", column: "background_video_url", kind: "text" },
  { table: "short_video_covers", column: "background_photo_url", kind: "text" },
  { table: "short_video_covers", column: "video_url", kind: "text" },
  { table: "short_video_covers", column: "photo_urls", kind: "array" },
  // Verification evidence can include links to media hosted in our bucket
  { table: "verification_requests", column: "evidence_urls", kind: "array" },
  // Free text that may hold a pasted link to one of our objects
  { table: "posts", column: "content", kind: "text" },
  { table: "comments", column: "content", kind: "text" },
  { table: "messages", column: "content", kind: "text" },
];

/**
 * URL-named columns that are deliberately *not* rewritten, with the reason.
 *
 * Both are outbound links to somebody else's server, written by the client
 * and never stored by us; rewriting them would mean guessing.
 */
export const ARCHIVE_REWRITE_EXEMPT: Readonly<Record<string, string>> = {
  "ad_creatives.destination_url": "the advertiser's own landing page, never our storage",
  "short_video_covers.product_url": "an external product link chosen by the creator",
  "archived_objects.old_url":
    "the mapping row's own provenance — never rendered, and rewriting it would sever the record deleteStoredObjects consults",
  "archived_objects.new_url":
    "the Drive URL the mapping row pins: rewriting it would break the delete allow-list on the very next delete",
};

/** The pair one archived object contributes to the rewrite. */
export interface ArchivedPair {
  oldUrl: string;
  newUrl: string;
}

export function quoteIdent(name: string): string {
  // The names come from the two constant tables above — code, not input — so
  // doubling embedded quotes is all the quoting these identifiers need.
  return `"${name.replaceAll('"', '""')}"`;
}

/**
 * One `update` per column, chaining `replace` over every pair in the batch.
 *
 * Building a statement per column rather than per pair is what keeps a batch
 * of N objects at a fixed ~28 statements instead of N × 28 round trips; the
 * chained replaces cannot interfere with each other because old URLs are our
 * R2 host and new URLs are Google's — neither form contains the other.
 *
 * The `like` / `= any` predicates are load-bearing beyond skipping work:
 * `update` on a column that did not change would still bloat the table and
 * fire its triggers on every pass.
 */
export function buildRewriteStatements(
  pairs: readonly ArchivedPair[],
): Array<{ text: string; params: string[] }> {
  if (pairs.length === 0) return [];

  return ARCHIVE_REWRITE_TARGETS.map((target) => {
    const params: string[] = [];
    let next = 1;
    const ph = (value: string): string => {
      params.push(value);
      return `$${next++}`;
    };
    const table = quoteIdent(target.table);
    const column = quoteIdent(target.column);

    let set: string;
    let where: string;
    if (target.kind === "array") {
      let expression = column;
      for (const pair of pairs) {
        expression = `array_replace(${expression}, ${ph(pair.oldUrl)}, ${ph(pair.newUrl)})`;
      }
      const conditions: string[] = [];
      for (const pair of pairs) {
        conditions.push(`${ph(pair.oldUrl)} = any(${column})`);
      }
      set = `${column} = ${expression}`;
      where = conditions.join(" or ");
    } else {
      // jsonb is rewritten through its text form: the document's shape is the
      // client's to change, and a blind textual replace cannot invent a shape
      // it does not understand.
      const source = target.kind === "jsonb" ? `${column}::text` : column;
      let expression = source;
      // The two loops are separate so every placeholder in the SET clause
      // numbers below every one in the WHERE clause — postgres binds by
      // number, not position, but a statement whose numbers skip around its
      // own text is one nobody will dare edit later.
      for (const pair of pairs) {
        expression = `replace(${expression}, ${ph(pair.oldUrl)}, ${ph(pair.newUrl)})`;
      }
      const conditions: string[] = [];
      for (const pair of pairs) {
        conditions.push(`${source} like ${ph(`%${pair.oldUrl}%`)}`);
      }
      set = target.kind === "jsonb" ? `${column} = (${expression})::jsonb` : `${column} = ${expression}`;
      where = conditions.join(" or ");
    }

    return { text: `update ${table} set ${set} where ${where}`, params };
  });
}

/**
 * R2's etag as an md5 hex, or `null` when it is not one.
 *
 * A single-part upload's etag *is* the md5; a multipart one is a composite
 * (`"hex-2"`) and comparing it against Drive's md5Hash would fail on every
 * large file for no reason — so composite etags are skipped, and the size
 * check remains the verification that always applies.
 */
export function md5FromEtag(etag: string | null | undefined): string | null {
  if (!etag) return null;
  const normalized = etag.replaceAll('"', "").toLowerCase();
  return /^[0-9a-f]{32}$/.test(normalized) ? normalized : null;
}

export function joinPublicUrl(base: string, key: string): string {
  return `${base.replace(/\/+$/, "")}/${key}`;
}

function emptyReport(): ArchiveReport {
  return {
    skipped: null,
    listed: 0,
    young: 0,
    uploaded: 0,
    resumed: 0,
    rewrittenStatements: 0,
    deleted: 0,
    wouldArchive: [],
    failed: [],
  };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Runs one archive pass. See the module comment for the ordering contract:
 * upload → verify → record → rewrite → delete, with the mapping row as the
 * only thing that ever advances an object between runs.
 */
export async function runArchivePass(deps: ArchivePassDeps): Promise<ArchiveReport> {
  const { storage, drive, store, exec, config } = deps;
  const log = deps.log ?? (() => undefined);
  const report = emptyReport();

  if (!config.dryRun && (!drive || !config.publicUrlBase)) {
    report.skipped = "unconfigured";
    log("media-archive: Drive is not configured (GDRIVE_* / R2_PUBLIC_URL missing); nothing moved");
    return report;
  }

  const objects = await storage.listAll();
  report.listed = objects.length;

  const cutoff = config.now.getTime() - config.graceDays * 24 * 60 * 60 * 1000;
  const aged = objects.filter((object) => object.uploaded.getTime() < cutoff);
  report.young = objects.length - aged.length;

  const archivedRows = await store.findArchived(objects.map((object) => object.key));
  const archivedByKey = new Map(archivedRows.map((row) => [row.r2Key, row]));
  const presentKeys = new Set(objects.map((object) => object.key));

  // Fresh work: past the grace period and never archived. Resume work: the
  // mapping row exists but the R2 object survived — a run that died between
  // recording and deleting, which this pass finishes without re-uploading.
  const fresh = aged.filter((object) => !archivedByKey.has(object.key));
  const resumeRows = archivedRows.filter((row) => presentKeys.has(row.r2Key));
  const batch = fresh.slice(0, config.batchLimit);
  const resumes = resumeRows.slice(0, config.batchLimit);

  if (config.dryRun) {
    report.uploaded = batch.length;
    report.resumed = resumes.length;
    report.wouldArchive = batch.map((object) => object.key);
    for (const object of batch) log(`media-archive: would upload "${object.key}" (${object.size} bytes)`);
    for (const row of resumes) log(`media-archive: would finish "${row.r2Key}" (rewrite + delete)`);
    log(
      `media-archive: dry run — ${batch.length} to upload, ${resumes.length} to finish, ` +
        `${report.young} left hot, ${fresh.length - batch.length} beyond the batch limit`,
    );
    return report;
  }

  const driveClient = drive as DriveClient;
  const pairs: ArchivedPair[] = [];
  const doneKeys: string[] = [];

  for (const object of batch) {
    try {
      const stored = await storage.get(object.key);
      if (!stored) {
        // Listed and read is not atomic; a delete (or an earlier pass) that
        // won the race just means less work, not a failure.
        report.failed.push({ key: object.key, error: "vanished from R2 between listing and read" });
        continue;
      }

      const oldUrl = joinPublicUrl(config.publicUrlBase, object.key);
      const uploaded = await driveClient.upload({
        name: object.key,
        mimeType: stored.contentType ?? "application/octet-stream",
        size: object.size,
        body: stored.body,
      });

      // Verify before anything is written or deleted. A Drive that reports a
      // different size than R2 held is a broken copy, and the whole promise
      // of the archive is that the moved file is byte-identical.
      const driveSize = Number(uploaded.size);
      if (!Number.isFinite(driveSize) || driveSize !== object.size) {
        throw new Error(`Drive reports ${uploaded.size ?? "no"} bytes; R2 held ${object.size}`);
      }
      const localMd5 = md5FromEtag(stored.etag);
      if (localMd5 && uploaded.md5Hash && uploaded.md5Hash.toLowerCase() !== localMd5) {
        throw new Error(`md5 mismatch: Drive ${uploaded.md5Hash}, R2 etag ${localMd5}`);
      }

      await driveClient.makePublic(uploaded.id);
      const newUrl = drivePublicUrl(uploaded.id, stored.contentType);

      try {
        await store.insertArchived({
          r2Key: object.key,
          driveFileId: uploaded.id,
          oldUrl,
          newUrl,
          contentType: stored.contentType ?? null,
          sizeBytes: object.size,
          md5Hex: localMd5,
        });
      } catch (error) {
        // Without the mapping row the delete would orphan the Drive file from
        // the app's knowledge (and from `deleteStoredObjects`' allow-list), so
        // the object stays on R2 and the next pass starts it fresh.
        report.failed.push({ key: object.key, error: `recording the mapping failed: ${errorText(error)}` });
        continue;
      }

      pairs.push({ oldUrl, newUrl });
      doneKeys.push(object.key);
      report.uploaded += 1;
    } catch (error) {
      report.failed.push({ key: object.key, error: errorText(error) });
    }
  }

  for (const row of resumes) {
    pairs.push({ oldUrl: row.oldUrl, newUrl: row.newUrl });
    doneKeys.push(row.r2Key);
    report.resumed += 1;
  }

  if (pairs.length > 0) {
    // Every window up to here left the app fully working. The rewrite is the
    // first step that changes what the app shows, so a failure here stops the
    // deletes — rows would still point at R2, and the next run resumes from
    // the mapping rows this one recorded.
    try {
      const statements = buildRewriteStatements(pairs);
      for (const statement of statements) {
        await exec(statement.text, statement.params);
      }
      report.rewrittenStatements = statements.length;
    } catch (error) {
      report.failed.push({ key: "(rewrite)", error: errorText(error) });
      log(`media-archive: rewrite failed, nothing deleted this pass: ${errorText(error)}`);
      return report;
    }
  }

  for (const key of doneKeys) {
    try {
      await storage.delete(key);
      report.deleted += 1;
    } catch (error) {
      // Last and least dangerous to fail: a surviving object whose row says
      // "archived" is exactly what the next pass's resume path is for.
      report.failed.push({ key, error: `deleting from R2 failed: ${errorText(error)}` });
    }
  }

  log(
    `media-archive: listed ${report.listed}, left ${report.young} hot, uploaded ${report.uploaded}, ` +
      `resumed ${report.resumed}, rewrote ${report.rewrittenStatements} statements, ` +
      `deleted ${report.deleted}, failed ${report.failed.length}`,
  );
  return report;
}

/**
 * The storage adapter over the Worker's R2 binding, used by the cron.
 *
 * The binding is used rather than the S3 SDK on purpose: `get` hands back a
 * streaming body, so a 100 MB video crosses memory once in 8 MiB chunks on its
 * way to Drive instead of being buffered whole, and the cron needs no
 * credentials the Worker did not already have.
 */
export function createBindingStorage(bucket: R2Bucket): ArchiveStorage {
  const MAX_LIST_PAGES = 50; // 50 × 1000 objects; the bucket is meant to be mostly empty.
  return {
    async listAll() {
      const objects: StoredObject[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
        const result = await bucket.list({ cursor, limit: 1000 });
        for (const object of result.objects) {
          objects.push({
            key: object.key,
            uploaded: object.uploaded,
            size: object.size,
            etag: object.etag ?? null,
            contentType: object.httpMetadata?.contentType ?? null,
          });
        }
        if (!result.truncated || !result.cursor) break;
        cursor = result.cursor;
      }
      return objects;
    },
    async get(key) {
      const object = await bucket.get(key);
      if (!object) return null;
      return {
        size: object.size,
        etag: object.etag ?? null,
        contentType: object.httpMetadata?.contentType ?? null,
        body: object.body,
      };
    },
    async delete(key) {
      await bucket.delete(key);
    },
  };
}

/**
 * The mapping-table adapter, and the executor for the batched rewrite
 * statements — both plain `db` operations inside the request-scoped client
 * `runWithDb` provides (the scheduled handler opens the same scope).
 */
export function createDbStore(): ArchiveStore {
  return {
    async findArchived(keys) {
      if (keys.length === 0) return [];
      return db.select().from(archivedObjects).where(inArray(archivedObjects.r2Key, keys));
    },
    async insertArchived(row) {
      // `do nothing` rather than an error: a resumed pass may re-record a row
      // it wrote just before a crash, and the row already on file is the same
      // one it would have written.
      await db.insert(archivedObjects).values(row).onConflictDoNothing({ target: archivedObjects.r2Key });
    },
  };
}

export function createDbExec(): ExecStatement {
  return async (text, params) => {
    // The identifiers in these statements are constants from
    // `ARCHIVE_REWRITE_TARGETS`; only the URL values are parameters.
    //
    // `unsafe` accepts plain values as bound parameters; its own type is
    // narrowed to postgres-js's JSON mode, hence the cast.
    await db.$client.unsafe(text, params as never[]);
  };
}
