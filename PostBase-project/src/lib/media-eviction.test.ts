import { describe, expect, it, vi } from "vitest";
import {
  ARCHIVE_REWRITE_TARGETS,
  joinPublicUrl,
  type StoredObject,
} from "./media-archive";
import {
  buildReferenceQueries,
  createEvictionStorage,
  runEvictionPass,
  type EvictionPassDeps,
  type EvictionStorage,
  type EvictionStore,
} from "./media-eviction";

/**
 * The eviction pass, tested against fakes for R2 and the database.
 *
 * The pass *deletes* the only copy of an orphan nobody references, so these
 * tests are less about "does it delete" than about the ordering contract in
 * the module comment: nothing is deleted unless the reference check ran and
 * came back empty, and every failure mode must fail toward *keeping* the
 * object. The event log each harness keeps is what asserts that contract — a
 * green run whose `delete` happened before its `findReferencedUrls` would be
 * a bug these tests must catch.
 */

const NOW = new Date("2026-10-01T12:00:00Z");
const ONE_HOUR = 60 * 60 * 1000;
const HOT = "https://hot.example";

function storedObject(key: string, ageMs: number, overrides: Partial<StoredObject> = {}): StoredObject {
  return {
    key,
    uploaded: new Date(NOW.getTime() - ageMs),
    size: 3,
    etag: "d41d8cd98f00b204e9800998ecf8427e",
    contentType: "image/png",
    ...overrides,
  };
}

interface HarnessOptions {
  objects?: StoredObject[];
  /** Keys with an `archived_objects` row — owned by the archive. */
  archivedKeys?: string[];
  /** URLs that appear in some rewrite-target column. */
  referencedUrls?: string[];
  listThrows?: boolean;
  archivedLookupThrows?: boolean;
  referenceCheckThrows?: boolean;
  deleteThrows?: string[];
  batchLimit?: number;
  dryRun?: boolean;
  graceHours?: number;
  publicUrlBase?: string;
  prefix?: string;
}

/** One pass over fully-controlled fakes, with every step recorded in order. */
function harness(options: HarnessOptions = {}) {
  const {
    objects = [],
    archivedKeys = [],
    referencedUrls = [],
    listThrows = false,
    archivedLookupThrows = false,
    referenceCheckThrows = false,
    deleteThrows = [],
    batchLimit = 10,
    dryRun = false,
    graceHours = 24,
    publicUrlBase = HOT,
    prefix = "posts/",
  } = options;

  const events: string[] = [];

  const storage: EvictionStorage = {
    async listByPrefix(value) {
      events.push(`list:${value}`);
      if (listThrows) throw new Error("r2 unavailable");
      return objects;
    },
    async delete(key) {
      events.push(`delete:${key}`);
      if (deleteThrows.includes(key)) throw new Error("r2 unavailable");
    },
  };

  const store: EvictionStore = {
    async findArchived(keys) {
      events.push(`archived:${keys.length}`);
      if (archivedLookupThrows) throw new Error("database unavailable");
      const owned = new Set(archivedKeys);
      return keys.filter((key) => owned.has(key));
    },
    async findReferencedUrls(urls) {
      events.push(`referenced:${urls.length}`);
      if (referenceCheckThrows) throw new Error("connection reset");
      const live = new Set(referencedUrls);
      return urls.filter((url) => live.has(url));
    },
  };

  const config = {
    publicUrlBase,
    prefix,
    graceHours,
    batchLimit,
    dryRun,
    now: NOW,
  };

  const deps: EvictionPassDeps = { storage, store, config };
  return { deps, events };
}

const ORPHAN = "posts/member-1/orphan.png";
const REFERENCED = "posts/member-1/live.png";

describe("buildReferenceQueries", () => {
  const OLD = "https://hot.example/posts/member-1/a.png";
  const NEW = "https://hot.example/posts/member-1/b.png";

  it("is empty for an empty candidate list — a pass that checks nothing runs no statements", () => {
    expect(buildReferenceQueries([])).toEqual([]);
  });

  it("emits exactly one statement per target column", () => {
    // The batching property the hourly pass depends on: N candidates cost a
    // fixed number of statements, not N times that number — and the count is
    // the archive's own list, so a column added there is checked here too.
    expect(buildReferenceQueries([OLD, NEW])).toHaveLength(ARCHIVE_REWRITE_TARGETS.length);
  });

  it("carries the whole candidate list as one array parameter", () => {
    for (const statement of buildReferenceQueries([OLD, NEW])) {
      expect(statement.params).toEqual([[OLD, NEW]]);
    }
  });

  it("matches a text column by substring, with both sides of the comparison aliased", () => {
    const postMedia = buildReferenceQueries([OLD]).find((statement) =>
      statement.text.includes('"post_media"'),
    )!;
    expect(postMedia.text).toBe(
      `select c.url from unnest($1::text[]) as c(url) ` +
        `where exists (select 1 from "post_media" as ref where ref."url" like '%' || c.url || '%')`,
    );
  });

  it("reads jsonb through its text form", () => {
    // The document's shape belongs to the client that wrote it; only its text
    // form can be searched for an embedded URL.
    const coverConfig = buildReferenceQueries([OLD]).find((statement) =>
      statement.text.includes('"cover_config"'),
    )!;
    expect(coverConfig.text).toBe(
      `select c.url from unnest($1::text[]) as c(url) ` +
        `where exists (select 1 from "profiles" as ref where ref."cover_config"::text like '%' || c.url || '%')`,
    );
  });

  it("matches the one text[] column by element rather than substring", () => {
    const photoUrls = buildReferenceQueries([OLD]).find((statement) =>
      statement.text.includes('"photo_urls"'),
    )!;
    expect(photoUrls.text).toBe(
      `select c.url from unnest($1::text[]) as c(url) ` +
        `where exists (select 1 from "short_video_covers" as ref where c.url = any(ref."photo_urls"))`,
    );
  });

  it("names only tables and columns the archive's own list declares", () => {
    // The list is guarded against the schema by media-archive.test.ts; this
    // pins that every statement this builder emits is built from it.
    const tables = buildReferenceQueries([OLD]).map(
      (statement) => /from "([a-z_]+)" as ref/.exec(statement.text)![1],
    );
    expect(tables).toEqual(ARCHIVE_REWRITE_TARGETS.map((target) => target.table));
  });
});

describe("runEvictionPass", () => {
  it("evicts an orphan: list, ownership, references, delete — in that order", async () => {
    const { deps, events } = harness({ objects: [storedObject(ORPHAN, 25 * ONE_HOUR)] });
    const report = await runEvictionPass(deps);

    expect(report).toMatchObject({
      skipped: null,
      listed: 1,
      young: 0,
      archivedOwned: 0,
      checked: 1,
      referenced: 0,
      evicted: 1,
      failed: [],
    });
    // The contract: the delete comes after both lookups, never before them.
    expect(events).toEqual([
      "list:posts/",
      "archived:1",
      "referenced:1",
      `delete:${ORPHAN}`,
    ]);
  });

  it("keeps an object some column still references", async () => {
    const url = joinPublicUrl(HOT, REFERENCED);
    const { deps, events } = harness({
      objects: [storedObject(REFERENCED, 25 * ONE_HOUR)],
      referencedUrls: [url],
    });
    const report = await runEvictionPass(deps);

    expect(report).toMatchObject({ referenced: 1, evicted: 0, failed: [] });
    expect(events.some((event) => event.startsWith("delete:"))).toBe(false);
  });

  it("leaves objects younger than the grace window untouched", async () => {
    const { deps, events } = harness({ objects: [storedObject(ORPHAN, 23 * ONE_HOUR)] });
    const report = await runEvictionPass(deps);

    expect(report).toMatchObject({ listed: 1, young: 1, checked: 0, evicted: 0 });
    // Not even a lookup: the grace window is checked before any query runs.
    expect(events).toEqual(["list:posts/"]);
  });

  it("treats an object exactly at the boundary as still young", async () => {
    // The rule is *older than* the grace window. An object on the knife edge
    // waits for the next pass rather than racing the publisher who uploaded
    // it an instant too slowly.
    const { deps } = harness({ objects: [storedObject(ORPHAN, 24 * ONE_HOUR)] });
    const report = await runEvictionPass(deps);

    expect(report.young).toBe(1);
    expect(report.evicted).toBe(0);
  });

  it("skips an object the archive already maps, even when nothing references it", async () => {
    // The archive's resume path will rewrite rows still pointing at this key
    // and then delete it; deleting it here would strand those rows on a file
    // that is gone.
    const { deps, events } = harness({
      objects: [storedObject(ORPHAN, 25 * ONE_HOUR)],
      archivedKeys: [ORPHAN],
    });
    const report = await runEvictionPass(deps);

    expect(report).toMatchObject({ archivedOwned: 1, checked: 0, evicted: 0 });
    expect(events).toEqual(["list:posts/", "archived:1"]);
  });

  it("asks only about unowned candidates, and checks the oldest first under the batch limit", async () => {
    const { deps, events } = harness({
      objects: [
        storedObject("posts/member-1/middle.png", 30 * ONE_HOUR),
        storedObject("posts/member-1/oldest.png", 50 * ONE_HOUR),
        storedObject("posts/member-1/newest.png", 26 * ONE_HOUR),
        storedObject("posts/member-1/young.png", ONE_HOUR),
      ],
      archivedKeys: ["posts/member-1/middle.png"],
      batchLimit: 1,
    });
    const report = await runEvictionPass(deps);

    // The oldest unowned candidate is the one checked and evicted; the
    // archive-owned and young objects are excluded before the limit is spent.
    expect(report).toMatchObject({ young: 1, archivedOwned: 1, checked: 1, evicted: 1 });
    expect(events).toEqual([
      "list:posts/",
      "archived:3",
      "referenced:1",
      "delete:posts/member-1/oldest.png",
    ]);
  });

  it("only lists objects under the configured prefix", async () => {
    const { deps, events } = harness({ prefix: "posts/" });
    await runEvictionPass(deps);
    expect(events[0]).toBe("list:posts/");
  });

  it("dry run reports the plan and touches nothing", async () => {
    const { deps, events } = harness({
      objects: [
        storedObject(ORPHAN, 25 * ONE_HOUR),
        storedObject(REFERENCED, 26 * ONE_HOUR),
      ],
      referencedUrls: [joinPublicUrl(HOT, REFERENCED)],
      dryRun: true,
    });
    const report = await runEvictionPass(deps);

    expect(report.wouldEvict).toEqual([ORPHAN]);
    expect(report.evicted).toBe(0);
    // The proof that "dry" means dry: the lookups ran, no delete did.
    expect(events).toEqual(["list:posts/", "archived:2", "referenced:2"]);
  });

  it("declines to run when the public URL base is missing — candidate URLs would be garbage", async () => {
    const { deps, events } = harness({
      objects: [storedObject(ORPHAN, 25 * ONE_HOUR)],
      publicUrlBase: "",
    });
    const report = await runEvictionPass(deps);

    expect(report.skipped).toBe("unconfigured");
    expect(report.listed).toBe(0);
    expect(events).toEqual([]);
  });

  it("deletes nothing when the listing fails, and says so", async () => {
    const { deps } = harness({ objects: [storedObject(ORPHAN, 25 * ONE_HOUR)], listThrows: true });
    const report = await runEvictionPass(deps);

    expect(report.evicted).toBe(0);
    expect(report.failed).toEqual([{ key: "(list)", error: "r2 unavailable" }]);
  });

  it("deletes nothing when archive ownership cannot be checked", async () => {
    // An object whose ownership is unknown might be one the archive is about
    // to rewrite rows for — so unknown reads as "do not touch".
    const { deps, events } = harness({
      objects: [storedObject(ORPHAN, 25 * ONE_HOUR)],
      archivedLookupThrows: true,
    });
    const report = await runEvictionPass(deps);

    expect(report.evicted).toBe(0);
    expect(report.failed).toEqual([{ key: "(archive lookup)", error: "database unavailable" }]);
    expect(events).not.toContain(`delete:${ORPHAN}`);
  });

  it("deletes nothing when the reference check fails, and says so", async () => {
    // The whole point of the pass: an unproven orphan is not an orphan. A
    // failed check must read as "everything is referenced".
    const { deps, events } = harness({
      objects: [storedObject(ORPHAN, 25 * ONE_HOUR)],
      referenceCheckThrows: true,
    });
    const report = await runEvictionPass(deps);

    expect(report.evicted).toBe(0);
    expect(report.failed).toEqual([{ key: "(reference check)", error: "connection reset" }]);
    expect(events).not.toContain(`delete:${ORPHAN}`);
  });

  it("keeps evicting the other orphans when one R2 delete fails", async () => {
    const second = "posts/member-1/orphan-2.png";
    const { deps } = harness({
      objects: [
        storedObject(ORPHAN, 25 * ONE_HOUR),
        storedObject(second, 26 * ONE_HOUR),
      ],
      deleteThrows: [ORPHAN],
    });
    const report = await runEvictionPass(deps);

    // The failed one is a retry next hour, not a lost orphan: deleting an
    // absent key succeeds, so a re-run is safe either way.
    expect(report.evicted).toBe(1);
    expect(report.failed).toEqual([
      { key: ORPHAN, error: "deleting from R2 failed: r2 unavailable" },
    ]);
  });

  it("never throws: a storage failure surfaces as a report entry", async () => {
    const { deps } = harness({ objects: [storedObject(ORPHAN, 25 * ONE_HOUR)], listThrows: true });
    await expect(runEvictionPass(deps)).resolves.toBeDefined();
  });

  it("passes the configured prefix through to the listing", async () => {
    const { deps, events } = harness({ prefix: "posts/", objects: [] });
    await runEvictionPass(deps);
    // Nothing aged past the grace window (there is nothing at all), so the
    // pass short-circuits before any database call — the listing is the only
    // event, and it carries the configured prefix.
    expect(events).toEqual(["list:posts/"]);
  });
});

describe("createEvictionStorage", () => {
  function bucketFake(pages: Array<{ objects: unknown[]; truncated: boolean; cursor?: string }>) {
    const listCalls: unknown[] = [];
    return {
      listCalls,
      bucket: {
        list: vi.fn(async (options: unknown) => {
          listCalls.push(options);
          return pages[listCalls.length - 1];
        }),
        get: vi.fn(),
        delete: vi.fn(),
      } as unknown as R2Bucket,
    };
  }

  it("follows the list cursor to the end of the prefix", async () => {
    const { bucket, listCalls } = bucketFake([
      {
        objects: [{ key: "posts/a.png", uploaded: NOW, size: 1, etag: "x", httpMetadata: { contentType: "image/png" } }],
        truncated: true,
        cursor: "page-2",
      },
      {
        objects: [{ key: "posts/b.png", uploaded: NOW, size: 2, etag: "y", httpMetadata: {} }],
        truncated: false,
      },
    ]);
    const objects = await createEvictionStorage(bucket).listByPrefix("posts/");
    expect(objects.map((object) => object.key)).toEqual(["posts/a.png", "posts/b.png"]);
    // The prefix is asked for on every page; no third call ever happens.
    expect(listCalls).toEqual([
      { prefix: "posts/", cursor: undefined, limit: 1000 },
      { prefix: "posts/", cursor: "page-2", limit: 1000 },
    ]);
  });

  it("stops when a page claims truncation but offers no cursor", async () => {
    // A malformed page must not spin the loop: the pass logs a short prefix
    // rather than looping until the cron times out.
    const { bucket } = bucketFake([{ objects: [], truncated: true }]);
    await expect(createEvictionStorage(bucket).listByPrefix("posts/")).resolves.toEqual([]);
  });

  it("maps an object's fields, passes null through, and deletes by key", async () => {
    const bucket = {
      list: vi.fn(async () => ({
        objects: [{ key: "posts/a.png", uploaded: NOW, size: 42, etag: "abc", httpMetadata: { contentType: "video/mp4" } }],
        truncated: false,
      })),
      get: vi.fn(),
      delete: vi.fn(),
    } as unknown as R2Bucket;
    const storage = createEvictionStorage(bucket);

    await expect(storage.listByPrefix("posts/")).resolves.toEqual([
      { key: "posts/a.png", uploaded: NOW, size: 42, etag: "abc", contentType: "video/mp4" },
    ]);

    await storage.delete("posts/a.png");
    expect(bucket.delete).toHaveBeenCalledWith("posts/a.png");
  });
});
