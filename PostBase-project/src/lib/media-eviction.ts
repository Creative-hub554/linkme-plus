/**
 * The media eviction pass: reclaiming uploads nothing ever referenced.
 *
 * `/api/posts/media` and the presigned `/api/uploads` route answer with a
 * public URL *before* any row points at it — the post (or comment) that
 * references the file is created by a *later* request. When that request never
 * comes (the composer was abandoned, the tab was lost, the publish failed
 * client-side), the object is stranded: it sits in the bucket, it costs
 * storage, and the hourly archive would eventually move it to Google Drive and
 * keep it there forever. The demo seeder strands objects the same way — it
 * uploads every asset before the rows that reference them are written, and a
 * re-seed with fewer posts or members leaves the old objects referenced by
 * nothing. This pass is the reaper for those orphans, and it runs in the same
 * cron *before* the archive so an orphan is deleted rather than archived.
 *
 * The shape of one pass, and why:
 *
 * 1. **List** the objects under every folder the pass covers: the post
 *    folder the upload routes write to, and the demo seeder's folder — the
 *    one `putObject` caller outside a route. `evictionPrefixes()` supplies
 *    the list, each entry derived from `getFolderForPurpose`, the same
 *    function the writers build their keys with, so the pass and the writers
 *    cannot drift apart in code.
 * 2. **Age** them past a grace period: the window a slow publisher gets
 *    between uploading a photo and creating the post that claims it. This
 *    must stay *below* the archive's grace (3 days by default) or orphans
 *    reach Drive first, where this pass can no longer see them.
 * 3. **Skip** anything `archived_objects` already maps. A mapping row means
 *    the archive owns that key — its resume path will rewrite any rows still
 *    pointing at it and then delete it — and deleting the object here would
 *    strand those rows on a file that is gone.
 * 4. **Check** every remaining candidate against the same column list the
 *    archive rewrites (`ARCHIVE_REWRITE_TARGETS`): an object is an orphan
 *    only when its URL appears in *none* of them — not in a `post_media` or
 *    `comment_media` row, and not pasted into a post's, comment's or
 *    message's text. Reusing that list is the point: it is this codebase's
 *    existing answer to "where may an R2 URL be recorded", it is guarded
 *    against schema drift by `media-archive.test.ts`, and a URL-holding
 *    column added later protects objects from eviction automatically.
 * 5. **Delete** the orphans, oldest first, under a batch limit. Deletes are
 *    cheap (one call each) but a bucket that lost its mind should still
 *    drain over hours rather than empty itself in a single cron.
 *
 * The pass fails *closed*: if the reference check cannot run, nothing is
 * deleted — an unknown reference state must read as "referenced". A failed
 * delete is a line in the report and a retry next hour; the pass never
 * throws, and deleting an absent key succeeds in R2, so a crashed run resumes
 * simply by running again.
 *
 * False keeps are possible and safe. The `like` predicates over-match rather
 * than under-match (keys carry no `%` or `_`, and if one ever did the
 * direction of the error is "keep the object"), and a URL pasted anywhere
 * keeps its object too. A false *delete* is what the whole design rules out.
 */

import { inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { archivedObjects } from "@/lib/db/schema";
import {
  ARCHIVE_REWRITE_TARGETS,
  joinPublicUrl,
  quoteIdent,
  type StoredObject,
} from "@/lib/media-archive";
import { getFolderForPurpose } from "@/lib/r2";

/** How one pass talks to R2: prefix-scoped listing plus delete. */
export interface EvictionStorage {
  listByPrefix(prefix: string): Promise<StoredObject[]>;
  delete(key: string): Promise<void>;
}

/** How one pass talks to the database: ownership and reference lookups. */
export interface EvictionStore {
  /** Keys that have an `archived_objects` row — the archive owns these. */
  findArchived(keys: string[]): Promise<string[]>;
  /** Which of the given public URLs appear in any column the archive rewrites. */
  findReferencedUrls(urls: string[]): Promise<string[]>;
}

export interface EvictionConfig {
  /** The R2 public URL base (no trailing slash) stored rows are prefixed with. */
  publicUrlBase: string;
  /** The key prefixes whose objects live and die by the reference check. */
  prefixes: readonly string[];
  /** Hours an object may sit unreferenced before it is an eviction candidate. */
  graceHours: number;
  batchLimit: number;
  dryRun: boolean;
  now: Date;
}

export interface EvictionReport {
  /** `"unconfigured"` when the pass declined to run; `null` otherwise. */
  skipped: "unconfigured" | null;
  listed: number;
  /** Objects listed but left alone for being inside the grace window. */
  young: number;
  /** Candidates skipped because `archived_objects` already maps them. */
  archivedOwned: number;
  /** Candidates whose references were actually checked (after the batch limit). */
  checked: number;
  /** Checked candidates some column still points at. */
  referenced: number;
  evicted: number;
  /** Dry run only: the keys a real pass would have deleted. */
  wouldEvict: string[];
  failed: Array<{ key: string; error: string }>;
}

export interface EvictionPassDeps {
  storage: EvictionStorage;
  store: EvictionStore;
  config: EvictionConfig;
  log?: (message: string) => void;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * One SELECT per rewrite-target column, each answering "which of these
 * candidate URLs does this column mention?".
 *
 * The candidate list travels as a single array parameter and each statement
 * returns the subset it matched, so N candidates cost a fixed number of
 * statements rather than N times that number — the same batching property
 * `buildRewriteStatements` gives the archive's updates.
 *
 * The predicates are deliberately substring matches (`like '%' || url || '%'`)
 * for the text and jsonb columns: those columns hold a URL *inside* larger
 * text — a pasted link in a post's body — so equality would miss the very
 * references that matter most. Over-matching only ever keeps an object, which
 * is the safe direction; see the module comment. The array column matches by
 * element, which is exact.
 *
 * Table and column names come from `ARCHIVE_REWRITE_TARGETS` — code, not
 * input — and are quoted with the archive's own `quoteIdent`. Both sides of
 * every comparison are aliased explicitly (`c.url`, `ref."url"`) so the
 * correlated subquery's scope cannot be misread: an unqualified `"url"` in
 * the inner select would resolve to the inner table, which is what is wanted
 * here, but spelling it out is what keeps that from being luck.
 */
export function buildReferenceQueries(
  urls: readonly string[],
): Array<{ text: string; params: unknown[] }> {
  if (urls.length === 0) return [];

  return ARCHIVE_REWRITE_TARGETS.map((target) => {
    const table = quoteIdent(target.table);
    const column = quoteIdent(target.column);
    const source = target.kind === "jsonb" ? `ref.${column}::text` : `ref.${column}`;
    const match =
      target.kind === "array"
        ? `c.url = any(ref.${column})`
        : `${source} like '%' || c.url || '%'`;
    return {
      text:
        `select c.url from unnest($1::text[]) as c(url) ` +
        `where exists (select 1 from ${table} as ref where ${match})`,
      params: [urls as string[]],
    };
  });
}

/**
 * The folders one pass covers — the value for `EvictionConfig.prefixes`.
 *
 * Two kinds of writer exist: the upload routes (`/api/posts/media` and the
 * presigned `/api/uploads`), which write to the `post` folder, and the demo
 * seeder — the only `putObject` caller outside a route — which writes to the
 * `seed` folder. Both entries come from `getFolderForPurpose`, the same
 * function those writers derive their keys with, so the pass cannot drift
 * away from a folder whose objects it should reap; a new writer joins the
 * pass by joining this list.
 *
 * Folders whose writer records the reference inside the same request that
 * uploads the file (avatars, covers, processed media) are not listed: the
 * publish-window race this pass exists for does not apply to them, and the
 * archive's whole-bucket sweep still moves anything they strand to Drive
 * rather than leaving it in R2 forever.
 */
export function evictionPrefixes(): string[] {
  return [getFolderForPurpose("post"), getFolderForPurpose("seed")].map((folder) => `${folder}/`);
}

function emptyReport(): EvictionReport {
  return {
    skipped: null,
    listed: 0,
    young: 0,
    archivedOwned: 0,
    checked: 0,
    referenced: 0,
    evicted: 0,
    wouldEvict: [],
    failed: [],
  };
}

/**
 * Runs one eviction pass. See the module comment for the ordering contract:
 * age → archive-ownership skip → reference check → delete, failing closed at
 * every step that could otherwise turn uncertainty into a deleted file.
 */
export async function runEvictionPass(deps: EvictionPassDeps): Promise<EvictionReport> {
  const { storage, store, config } = deps;
  const log = deps.log ?? (() => undefined);
  const report = emptyReport();

  if (!config.publicUrlBase) {
    // Without the public URL base no candidate URL can be built, so nothing
    // could be proven referenced — and a pass that cannot prove anything must
    // delete nothing. Mirrors the archive declining without its own base.
    report.skipped = "unconfigured";
    log("media-eviction: R2_PUBLIC_URL is not set; candidate URLs cannot be built, nothing evicted");
    return report;
  }

  const objects: StoredObject[] = [];
  try {
    // Every folder must list: a listing that dies after the first folder
    // must never read as "the rest of the bucket is empty" — one healthy
    // prefix beside a failed one still evicts nothing this hour.
    for (const prefix of config.prefixes) {
      objects.push(...(await storage.listByPrefix(prefix)));
    }
  } catch (error) {
    // Fail closed: with no complete listing there is nothing to judge.
    report.failed.push({ key: "(list)", error: errorText(error) });
    log(`media-eviction: listing failed, nothing evicted: ${errorText(error)}`);
    return report;
  }
  report.listed = objects.length;

  const cutoff = config.now.getTime() - config.graceHours * 60 * 60 * 1000;
  const aged = objects.filter((object) => object.uploaded.getTime() < cutoff);
  report.young = objects.length - aged.length;

  if (aged.length === 0) {
    // Nothing is past the grace window — the steady state of a healthy
    // bucket — so the pass ends here without touching the database at all.
    log(
      `media-eviction: listed ${report.listed}, all ${report.young} inside the grace window, nothing to check`,
    );
    return report;
  }

  let archivedKeys: Set<string>;
  try {
    archivedKeys = new Set(await store.findArchived(aged.map((object) => object.key)));
  } catch (error) {
    // Fail closed: ownership is unknown, and an object the archive owns must
    // never be deleted out from under its pending rewrite.
    report.failed.push({ key: "(archive lookup)", error: errorText(error) });
    log(`media-eviction: archived_objects lookup failed, nothing evicted: ${errorText(error)}`);
    return report;
  }
  const unowned = aged.filter((object) => !archivedKeys.has(object.key));
  report.archivedOwned = aged.length - unowned.length;

  // Oldest first, because R2 lists lexicographically by key — which groups by
  // member, not by age. Slicing the raw listing would let one member's backlog
  // starve everyone else's; sorting by upload time drains the worst garbage
  // first and is deterministic run to run.
  const batch = [...unowned]
    .sort((left, right) => left.uploaded.getTime() - right.uploaded.getTime())
    .slice(0, config.batchLimit);
  report.checked = batch.length;

  if (batch.length === 0) {
    log(
      `media-eviction: listed ${report.listed}, left ${report.young} young, ` +
        `${report.archivedOwned} archive-owned, nothing to check`,
    );
    return report;
  }

  const urls = batch.map((object) => joinPublicUrl(config.publicUrlBase, object.key));

  let referenced: Set<string>;
  try {
    referenced = new Set(await store.findReferencedUrls(urls));
  } catch (error) {
    // Fail closed: an unreachable reference check must read as "everything is
    // referenced", so nothing is deleted this hour.
    report.failed.push({ key: "(reference check)", error: errorText(error) });
    log(`media-eviction: reference check failed, nothing evicted: ${errorText(error)}`);
    return report;
  }

  const orphans = batch.filter(
    (object) => !referenced.has(joinPublicUrl(config.publicUrlBase, object.key)),
  );
  report.referenced = batch.length - orphans.length;

  if (config.dryRun) {
    report.wouldEvict = orphans.map((object) => object.key);
    for (const key of report.wouldEvict) log(`media-eviction: would evict "${key}"`);
    log(
      `media-eviction: dry run — ${orphans.length} to evict, ${report.referenced} referenced, ` +
        `${report.young} left young, ${report.archivedOwned} archive-owned, ` +
        `${unowned.length - batch.length} beyond the batch limit`,
    );
    return report;
  }

  for (const object of orphans) {
    try {
      await storage.delete(object.key);
      report.evicted += 1;
    } catch (error) {
      // Least dangerous to fail: the object stays, and the next pass finds it
      // again — retrying a delete is safe because R2 treats an absent key as
      // already done.
      report.failed.push({ key: object.key, error: `deleting from R2 failed: ${errorText(error)}` });
    }
  }

  log(
    `media-eviction: listed ${report.listed}, left ${report.young} young, ` +
      `${report.archivedOwned} archive-owned, checked ${report.checked}, ` +
      `kept ${report.referenced} referenced, evicted ${report.evicted}, failed ${report.failed.length}`,
  );
  return report;
}

/**
 * The storage adapter over the Worker's R2 binding, and the database adapter
 * for the two lookups — both plain operations inside the request-scoped
 * client `runWithDb` provides (the scheduled handler opens the same scope).
 *
 * The binding is used rather than the S3 SDK for the same reason the archive
 * uses it: listing and deleting through the runtime needs no credentials the
 * Worker did not already have.
 */
export function createEvictionStorage(bucket: R2Bucket): EvictionStorage {
  const MAX_LIST_PAGES = 50; // 50 × 1000 objects under the prefix; the bucket is meant to be mostly empty.
  return {
    async listByPrefix(prefix) {
      const objects: StoredObject[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
        const result = await bucket.list({ prefix, cursor, limit: 1000 });
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
    async delete(key) {
      await bucket.delete(key);
    },
  };
}

export function createEvictionStore(): EvictionStore {
  return {
    async findArchived(keys) {
      if (keys.length === 0) return [];
      const rows = await db
        .select({ r2Key: archivedObjects.r2Key })
        .from(archivedObjects)
        .where(inArray(archivedObjects.r2Key, keys));
      return rows.map((row) => row.r2Key);
    },
    async findReferencedUrls(urls) {
      if (urls.length === 0) return [];
      const found = new Set<string>();
      for (const statement of buildReferenceQueries(urls)) {
        const rows = await db.$client.unsafe(statement.text, statement.params as never[]);
        for (const row of rows as Array<Record<string, unknown>>) {
          for (const value of Object.values(row)) {
            if (typeof value === "string") found.add(value);
          }
        }
      }
      return [...found];
    },
  };
}
