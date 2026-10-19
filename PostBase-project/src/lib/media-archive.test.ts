import { describe, expect, it, vi } from "vitest";
import { PgTable, getTableConfig } from "drizzle-orm/pg-core";
import * as schema from "@/lib/db/schema";
import {
  ARCHIVE_REWRITE_EXEMPT,
  ARCHIVE_REWRITE_TARGETS,
  buildRewriteStatements,
  createBindingStorage,
  joinPublicUrl,
  md5FromEtag,
  runArchivePass,
  type ArchivePassDeps,
  type ArchiveStorage,
  type ArchivedRow,
  type ArchiveStore,
  type StoredObject,
} from "./media-archive";
import type { DriveClient } from "@/lib/gdrive";

/**
 * The archive pass, tested against fakes for R2, Drive, and the mapping
 * table — and, above those, the guard that keeps the rewrite list honest.
 *
 * The pass moves the only copy of somebody's photo, so these tests are less
 * about "does it upload" than about the ordering contract in the module
 * comment: nothing is written or deleted before Drive's copy is verified, and
 * no crash window may leave a row pointing at a file that is gone. The event
 * log each harness keeps is what asserts that contract — a green run whose
 * `delete` came before its `insert` would be a bug these tests must catch.
 */

const NOW = new Date("2026-10-01T12:00:00Z");
const THREE_DAYS = 3 * 24 * 60 * 60 * 1000;
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

function body(bytes = 3): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(bytes).fill(1));
      controller.close();
    },
  });
}

interface HarnessOptions {
  objects?: StoredObject[];
  rows?: ArchivedRow[];
  /** Override what Drive claims a given key's upload produced. */
  driveSize?: (object: StoredObject) => string | undefined;
  driveMd5?: (object: StoredObject) => string | undefined;
  vanished?: string[];
  uploadThrows?: string[];
  insertThrows?: string[];
  deleteThrows?: string[];
  batchLimit?: number;
  dryRun?: boolean;
}

/** One pass over fully-controlled fakes, with every step recorded in order. */
function harness(options: HarnessOptions = {}) {
  const {
    objects = [],
    rows = [],
    vanished = [],
    uploadThrows = [],
    insertThrows = [],
    deleteThrows = [],
    batchLimit = 10,
    dryRun = false,
  } = options;

  const events: string[] = [];
  const executed: Array<{ text: string; params: unknown[] }> = [];
  const rowMap = new Map(rows.map((row) => [row.r2Key, row]));

  const storage: ArchiveStorage = {
    async listAll() {
      return objects;
    },
    async get(key) {
      events.push(`get:${key}`);
      if (vanished.includes(key)) return null;
      const object = objects.find((entry) => entry.key === key);
      if (!object) return null;
      return { size: object.size, etag: object.etag, contentType: object.contentType, body: body(object.size) };
    },
    async delete(key) {
      events.push(`delete:${key}`);
      if (deleteThrows.includes(key)) throw new Error("r2 unavailable");
    },
  };

  let fileId = 0;
  const drive: DriveClient = {
    async upload(input) {
      events.push(`upload:${input.name}`);
      if (uploadThrows.includes(input.name)) throw new Error("drive unavailable");
      fileId += 1;
      const id = `drive-${fileId}`;
      const source = objects.find((entry) => entry.key === input.name)!;
      return {
        id,
        size: options.driveSize?.(source) ?? String(input.size),
        md5Hash: options.driveMd5?.(source),
        mimeType: input.mimeType,
      };
    },
    async makePublic(id) {
      events.push(`public:${id}`);
    },
    async deleteFile(id) {
      events.push(`driveDelete:${id}`);
    },
  };

  const store: ArchiveStore = {
    async findArchived(keys) {
      return keys.flatMap((key) => {
        const row = rowMap.get(key);
        return row ? [row] : [];
      });
    },
    async insertArchived(row) {
      events.push(`insert:${row.r2Key}`);
      if (insertThrows.includes(row.r2Key)) throw new Error("database unavailable");
      rowMap.set(row.r2Key, row);
    },
  };

  const config = {
    publicUrlBase: HOT,
    graceDays: 3,
    batchLimit,
    dryRun,
    now: NOW,
  };

  const deps: ArchivePassDeps = {
    storage,
    drive,
    store,
    exec: async (text, params) => {
      // One event per statement, keyed by the table it rewrites — the table
      // is the part of a batched statement worth asserting on.
      events.push(`exec:${/update "([a-z_]+)"/.exec(text)?.[1] ?? "?"}`);
      executed.push({ text, params });
    },
    config,
  };

  return { deps, events, executed, rowMap };
}

function archivedRow(r2Key: string, id = "drive-x"): ArchivedRow {
  return {
    r2Key,
    driveFileId: id,
    oldUrl: joinPublicUrl(HOT, r2Key),
    newUrl: `https://lh3.googleusercontent.com/d/${id}`,
    contentType: "image/png",
    sizeBytes: 3,
    md5Hex: null,
  };
}

describe("the rewrite targets against the real schema", () => {
  // The guard this whole feature leans on. Targets are a hand-written list,
  // the schema evolves independently, and the failure mode of a drift is not
  // a type error — it is a column still pointing at an object the pass just
  // deleted. So the schema itself is read here (through drizzle's own
  // `getTableConfig`, the same path DDL takes) and the two are compared.
  // Widened to `unknown` first, the same narrowing `schema.test.ts` uses:
  // `Object.values` infers a union of every export, enums included, which a
  // `PgTable` predicate cannot narrow from.
  const exports: unknown[] = Object.values(schema);
  const tables = exports.filter((entry): entry is PgTable => entry instanceof PgTable);
  const byName = new Map(
    tables.map((table) => {
      const config = getTableConfig(table);
      return [config.name, new Map(config.columns.map((column) => [column.name, column]))] as const;
    }),
  );
  const targetIds = new Set(ARCHIVE_REWRITE_TARGETS.map((target) => `${target.table}.${target.column}`));

  it("names only columns the schema actually defines", () => {
    for (const target of ARCHIVE_REWRITE_TARGETS) {
      const table = byName.get(target.table);
      expect(table, `${target.table}.${target.column}: no such table`).toBeDefined();
      expect(table!.has(target.column), `${target.table}.${target.column}: no such column`).toBe(true);
    }
  });

  it("rewrites or exempts every url-named column in the schema", () => {
    // Every column whose name says it holds a URL either appears in the
    // rewrite list or is exempted above with a reason. A new `*_url` column
    // added without one of the two fails here, which is the only place that
    // can catch it before it ships as a broken image.
    for (const [tableName, columns] of byName) {
      for (const columnName of columns.keys()) {
        if (!columnName.includes("url")) continue;
        const id = `${tableName}.${columnName}`;
        expect(
          targetIds.has(id) || id in ARCHIVE_REWRITE_EXEMPT,
          `${id} holds a URL but the archive neither rewrites nor exempts it`,
        ).toBe(true);
      }
    }
  });

  it("exempts nothing that is not a url-named column, and nothing twice", () => {
    for (const id of Object.keys(ARCHIVE_REWRITE_EXEMPT)) {
      const [tableName, columnName] = id.split(".");
      expect(byName.get(tableName)?.has(columnName), `${id}: no such column`).toBe(true);
      expect(targetIds.has(id), `${id} is both rewritten and exempt`).toBe(false);
    }
  });

  it("chooses each target's rewriting kind from the column's real data type", () => {
    // The builder emits `replace` for text, `::text`/`::jsonb` casts for jsonb,
    // and `array_replace` for arrays; a kind that disagrees with the column it
    // names would produce SQL the migration never runs and the tests never
    // execute — against a live database it would simply fail at 3 a.m.
    const expectedKind: Record<string, string> = { string: "text", json: "jsonb", array: "array" };
    for (const target of ARCHIVE_REWRITE_TARGETS) {
      const column = byName.get(target.table)!.get(target.column)!;
      expect(
        target.kind,
        `${target.table}.${target.column} is ${column.dataType}, not a ${target.kind} rewrite`,
      ).toBe(expectedKind[column.dataType]);
    }
  });
});

describe("buildRewriteStatements", () => {
  const OLD = "https://hot.example/posts/member-1/a.png";
  const NEW = "https://lh3.googleusercontent.com/d/aaa";
  const OLD2 = "https://hot.example/posts/member-1/b.png";
  const NEW2 = "https://lh3.googleusercontent.com/d/bbb";

  it("is empty for an empty batch — a pass that moved nothing rewrites nothing", () => {
    expect(buildRewriteStatements([])).toEqual([]);
  });

  it("emits exactly one statement per target column", () => {
    // The batching property the hourly pass depends on: N objects cost a
    // fixed number of statements, not N times that number.
    expect(buildRewriteStatements([{ oldUrl: OLD, newUrl: NEW }])).toHaveLength(
      ARCHIVE_REWRITE_TARGETS.length,
    );
  });

  it("rewrites a text column with a chained, parameterised replace", () => {
    const statements = buildRewriteStatements([{ oldUrl: OLD, newUrl: NEW }]);
    const postMedia = statements.find((statement) => statement.text.includes('"post_media"'))!;
    expect(postMedia.text).toBe(
      `update "post_media" set "url" = replace("url", $1, $2) where "url" like $3`,
    );
    expect(postMedia.params).toEqual([OLD, NEW, `%${OLD}%`]);
  });

  it("chains every pair in the batch into one statement, in parameter order", () => {
    const statements = buildRewriteStatements([
      { oldUrl: OLD, newUrl: NEW },
      { oldUrl: OLD2, newUrl: NEW2 },
    ]);
    const postMedia = statements.find((statement) => statement.text.includes('"post_media"'))!;
    expect(postMedia.text).toBe(
      `update "post_media" set "url" = replace(replace("url", $1, $2), $3, $4) where "url" like $5 or "url" like $6`,
    );
    expect(postMedia.params).toEqual([OLD, NEW, OLD2, NEW2, `%${OLD}%`, `%${OLD2}%`]);
  });

  it("rewrites jsonb through its text form, casting back", () => {
    // The document's shape belongs to the client that wrote it; a textual
    // replace cannot invent a structure it does not understand.
    const statements = buildRewriteStatements([{ oldUrl: OLD, newUrl: NEW }]);
    const coverConfig = statements.find((statement) => statement.text.includes('"cover_config"'))!;
    expect(coverConfig.text).toBe(
      `update "profiles" set "cover_config" = (replace("cover_config"::text, $1, $2))::jsonb ` +
        `where "cover_config"::text like $3`,
    );
  });

  it("rewrites URL arrays with array_replace and an any() guard", () => {
    const statements = buildRewriteStatements([{ oldUrl: OLD, newUrl: NEW }]);
    const photoUrls = statements.find((statement) => statement.text.includes('"photo_urls"'))!;
    expect(photoUrls.text).toBe(
      `update "short_video_covers" set "photo_urls" = array_replace("photo_urls", $1, $2) ` +
        `where $3 = any("photo_urls")`,
    );
    expect(photoUrls.params).toEqual([OLD, NEW, OLD]);

    const evidenceUrls = statements.find((statement) => statement.text.includes('"evidence_urls"'))!;
    expect(evidenceUrls.text).toBe(
      `update "verification_requests" set "evidence_urls" = array_replace("evidence_urls", $1, $2) ` +
        `where $3 = any("evidence_urls")`,
    );
    expect(evidenceUrls.params).toEqual([OLD, NEW, OLD]);
  });

  it("keeps placeholders in text order so postgres reads params positionally", () => {
    // $1 is the first value in the statement's text, always. A builder that
    // interleaved WHERE placeholders would still look right in a unit test
    // and silently swap URLs in production.
    for (const statement of buildRewriteStatements([{ oldUrl: OLD, newUrl: NEW }])) {
      const placeholders = [...statement.text.matchAll(/\$(\d+)/g)].map((match) => Number(match[1]));
      expect(placeholders).toEqual(placeholders.map((_, index) => index + 1));
    }
  });
});

describe("md5FromEtag", () => {
  it("reads a single-part etag as the md5 it is", () => {
    expect(md5FromEtag("d41d8cd98f00b204e9800998ecf8427e")).toBe("d41d8cd98f00b204e9800998ecf8427e");
    expect(md5FromEtag('"ABCDEF0123456789abcdef0123456789"')).toBe("abcdef0123456789abcdef0123456789");
  });

  it("refuses a composite etag rather than compare the wrong hash", () => {
    // A multipart upload's etag is `<md5>-<parts>`, which is not an md5 of
    // anything — comparing it to Drive's hash would fail every large file.
    for (const etag of ["d41d8cd98f00b204e9800998ecf8427e-2", "not-a-hash", "", null, undefined]) {
      expect(md5FromEtag(etag)).toBeNull();
    }
  });
});

describe("runArchivePass", () => {
  it("archives an aged object: upload, verify, record, rewrite, delete — in that order", async () => {
    const { deps, events, executed } = harness({ objects: [storedObject("posts/member-1/a.png", THREE_DAYS + 1)] });
    const report = await runArchivePass(deps);

    expect(report).toMatchObject({ listed: 1, young: 0, uploaded: 1, resumed: 0, deleted: 1, failed: [] });
    expect(events).toEqual([
      "get:posts/member-1/a.png",
      "upload:posts/member-1/a.png",
      "public:drive-1",
      "insert:posts/member-1/a.png",
      ...ARCHIVE_REWRITE_TARGETS.map((target) => `exec:${target.table}`),
      "delete:posts/member-1/a.png",
    ]);
    // One statement per column, each carrying the one pair.
    expect(executed).toHaveLength(ARCHIVE_REWRITE_TARGETS.length);
    expect(executed[0].params).toEqual([
      `${HOT}/posts/member-1/a.png`,
      "https://lh3.googleusercontent.com/d/drive-1",
      `%${HOT}/posts/member-1/a.png%`,
    ]);
  });

  it("leaves objects younger than the grace period on hot hosting", async () => {
    const { deps, events } = harness({ objects: [storedObject("posts/member-1/new.png", THREE_DAYS - 1000)] });
    const report = await runArchivePass(deps);
    expect(report).toMatchObject({ young: 1, uploaded: 0, deleted: 0 });
    // Not even a read: the hot tier is the app's, untouched.
    expect(events).toEqual([]);
  });

  it("treats an object exactly at the boundary as still hot", async () => {
    // The rule is *older than* three days. An object on the knife edge waits
    // for the next pass rather than being half a millisecond from deletion.
    const { deps } = harness({ objects: [storedObject("posts/member-1/boundary.png", THREE_DAYS)] });
    const report = await runArchivePass(deps);
    expect(report.uploaded).toBe(0);
    expect(report.young).toBe(1);
  });

  it("stops at the batch limit and leaves the rest for the next hour", async () => {
    const { deps } = harness({
      objects: [
        storedObject("posts/member-1/a.png", THREE_DAYS + 3000),
        storedObject("posts/member-1/b.png", THREE_DAYS + 2000),
        storedObject("posts/member-1/c.png", THREE_DAYS + 1000),
      ],
      batchLimit: 2,
    });
    const report = await runArchivePass(deps);
    expect(report.uploaded).toBe(2);
    // The third object is not a failure, just later.
    expect(report.failed).toEqual([]);
  });

  it("never restarts the cycle for an object whose archive is finished", async () => {
    // A row whose R2 object is gone is a finished archive: the object was
    // moved and deleted on an earlier pass. Re-listing it (through some other
    // key's listing) must not re-upload — a second Drive copy with no second
    // mapping row would be an orphan forever.
    const { deps, events } = harness({
      objects: [storedObject("posts/member-1/other.png", 1000)],
      rows: [archivedRow("posts/member-1/a.png")],
    });
    const report = await runArchivePass(deps);
    expect(report).toMatchObject({ uploaded: 0, resumed: 0, deleted: 0, failed: [] });
    expect(events).toEqual([]);
  });

  it("resumes a crashed pass: rewrite and delete from the mapping row, without re-uploading", async () => {
    // The window this covers: a run that recorded the mapping and died
    // before the rewrite and delete. The object is still in R2, so this pass
    // finishes the job — no upload, no second Drive copy.
    const row = archivedRow("posts/member-1/a.png", "drive-99");
    const { deps, events } = harness({
      objects: [storedObject("posts/member-1/a.png", THREE_DAYS + 1)],
      rows: [row],
    });
    const report = await runArchivePass(deps);
    expect(report).toMatchObject({ uploaded: 0, resumed: 1, deleted: 1 });
    expect(events).toContain(`delete:posts/member-1/a.png`);
    expect(events.some((event) => event.startsWith("upload:"))).toBe(false);
    // The rewrite ran with the *recorded* URLs — the same pair the first run
    // would have used.
    expect(events.filter((event) => event.startsWith("insert:"))).toEqual([]);
    expect(events.filter((event) => event.startsWith("exec:"))).toHaveLength(ARCHIVE_REWRITE_TARGETS.length);
  });

  it("refuses to record or delete when Drive's copy is a different size", async () => {
    const { deps, events, rowMap } = harness({
      objects: [storedObject("posts/member-1/a.png", THREE_DAYS + 1)],
      driveSize: () => "999",
    });
    const report = await runArchivePass(deps);
    expect(report.failed).toEqual([
      { key: "posts/member-1/a.png", error: "Drive reports 999 bytes; R2 held 3" },
    ]);
    expect(rowMap.size).toBe(0);
    // No rewrite and no delete followed the bad copy: R2 still holds the
    // only good one.
    expect(events.filter((event) => event.startsWith("exec:") || event.startsWith("delete:"))).toEqual([]);
  });

  it("refuses a copy whose md5 disagrees with R2's etag", async () => {
    const { deps } = harness({
      objects: [storedObject("posts/member-1/a.png", THREE_DAYS + 1)],
      driveMd5: () => "00000000000000000000000000000000",
    });
    const report = await runArchivePass(deps);
    expect(report.failed[0].error).toMatch(/md5 mismatch/);
  });

  it("does not compare md5 when R2's etag is a composite", async () => {
    const { deps } = harness({
      objects: [storedObject("posts/member-1/a.png", THREE_DAYS + 1, { etag: "d41d8cd98f00b204e9800998ecf8427e-2" })],
      driveMd5: () => "00000000000000000000000000000000",
    });
    const report = await runArchivePass(deps);
    expect(report.failed).toEqual([]);
    expect(report.uploaded).toBe(1);
  });

  it("keeps an object on R2 when the mapping row cannot be written", async () => {
    // The mapping row is what a delete is allowed by; without it the Drive
    // file would be unreachable, so the object stays put for a clean retry.
    const { deps, events } = harness({
      objects: [storedObject("posts/member-1/a.png", THREE_DAYS + 1)],
      insertThrows: ["posts/member-1/a.png"],
    });
    const report = await runArchivePass(deps);
    expect(report.failed[0].error).toMatch(/recording the mapping failed/);
    expect(events).not.toContain("delete:posts/member-1/a.png");
  });

  it("deletes nothing at all when the rewrite fails, and says so", async () => {
    // One bad statement means the batch's URLs are half-applied at best; the
    // objects stay on R2 and the next run resumes from the mapping rows.
    const { deps, rowMap } = harness({
      objects: [storedObject("posts/member-1/a.png", THREE_DAYS + 1)],
    });
    deps.exec = async () => {
      throw new Error("connection reset");
    };
    const report = await runArchivePass(deps);
    expect(report.failed).toEqual([{ key: "(rewrite)", error: "connection reset" }]);
    expect(report.deleted).toBe(0);
    // The rows *were* recorded — that is exactly what next run resumes from.
    expect(rowMap.size).toBe(1);
  });

  it("continues past one object's failure and archives the rest", async () => {
    const { deps } = harness({
      objects: [
        storedObject("posts/member-1/a.png", THREE_DAYS + 3000),
        storedObject("posts/member-1/b.png", THREE_DAYS + 2000),
      ],
      uploadThrows: ["posts/member-1/a.png"],
    });
    const report = await runArchivePass(deps);
    expect(report.uploaded).toBe(1);
    expect(report.deleted).toBe(1);
    expect(report.failed).toEqual([{ key: "posts/member-1/a.png", error: "drive unavailable" }]);
  });

  it("reports an object that vanished between listing and reading, and moves on", async () => {
    const { deps } = harness({
      objects: [storedObject("posts/member-1/a.png", THREE_DAYS + 1)],
      vanished: ["posts/member-1/a.png"],
    });
    const report = await runArchivePass(deps);
    expect(report.failed[0].error).toMatch(/vanished/);
    expect(report.deleted).toBe(0);
  });

  it("keeps deleting the other objects when one R2 delete fails", async () => {
    const { deps } = harness({
      objects: [
        storedObject("posts/member-1/a.png", THREE_DAYS + 3000),
        storedObject("posts/member-1/b.png", THREE_DAYS + 2000),
      ],
      deleteThrows: ["posts/member-1/a.png"],
    });
    const report = await runArchivePass(deps);
    expect(report.deleted).toBe(1);
    expect(report.failed).toEqual([
      { key: "posts/member-1/a.png", error: "deleting from R2 failed: r2 unavailable" },
    ]);
  });

  it("dry run reports the plan and touches nothing", async () => {
    const { deps, events } = harness({
      objects: [
        storedObject("posts/member-1/a.png", THREE_DAYS + 1),
        storedObject("posts/member-1/fresh.png", 1000),
      ],
      rows: [archivedRow("posts/member-1/crashed.png")],
      dryRun: true,
    });
    const report = await runArchivePass(deps);
    expect(report.wouldArchive).toEqual(["posts/member-1/a.png"]);
    expect(report.uploaded).toBe(1);
    expect(report.young).toBe(1);
    // The proof that "dry" means dry: no read, no upload, no write, no delete.
    expect(events).toEqual([]);
  });

  it("declines to run when Drive is not configured, without touching anything", async () => {
    const { deps } = harness({ objects: [storedObject("posts/member-1/a.png", THREE_DAYS + 1)] });
    deps.drive = null;
    const report = await runArchivePass(deps);
    expect(report.skipped).toBe("unconfigured");
    expect(report.listed).toBe(0);
  });

  it("declines to run when the public URL base is missing — old URLs would be garbage", async () => {
    const { deps } = harness({ objects: [storedObject("posts/member-1/a.png", THREE_DAYS + 1)] });
    deps.config = { ...deps.config, publicUrlBase: "" };
    const report = await runArchivePass(deps);
    expect(report.skipped).toBe("unconfigured");
  });
});

describe("createBindingStorage", () => {
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

  it("follows the list cursor to the end of the bucket", async () => {
    const { bucket, listCalls } = bucketFake([
      { objects: [{ key: "a", uploaded: NOW, size: 1, etag: "x", httpMetadata: { contentType: "image/png" } }], truncated: true, cursor: "page-2" },
      { objects: [{ key: "b", uploaded: NOW, size: 2, etag: "y", httpMetadata: {} }], truncated: false },
    ]);
    const objects = await createBindingStorage(bucket).listAll();
    expect(objects.map((object) => object.key)).toEqual(["a", "b"]);
    // Second page asked for by cursor; no third call ever happens.
    expect(listCalls).toEqual([
      { cursor: undefined, limit: 1000 },
      { cursor: "page-2", limit: 1000 },
    ]);
  });

  it("stops when a page claims truncation but offers no cursor", async () => {
    // A malformed page must not spin the loop: the pass logs a short bucket
    // rather than looping until the cron times out.
    const { bucket } = bucketFake([{ objects: [], truncated: true }]);
    await expect(createBindingStorage(bucket).listAll()).resolves.toEqual([]);
  });

  it("maps a read object's size, etag, and content type, and passes null through", async () => {
    const readBody = new ReadableStream<Uint8Array>();
    const bucket = {
      list: vi.fn(),
      get: vi.fn(async () => ({
        size: 42,
        etag: "abc",
        httpMetadata: { contentType: "video/mp4" },
        body: readBody,
      })),
      delete: vi.fn(),
    } as unknown as R2Bucket;
    const storage = createBindingStorage(bucket);
    await expect(storage.get("posts/member-1/a.mp4")).resolves.toEqual({
      size: 42,
      etag: "abc",
      contentType: "video/mp4",
      body: readBody,
    });

    (bucket.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    await expect(storage.get("gone")).resolves.toBeNull();
  });
});

describe("joinPublicUrl", () => {
  it("joins base and key without doubling or losing the slash", () => {
    expect(joinPublicUrl(HOT, "posts/a.png")).toBe("https://hot.example/posts/a.png");
    expect(joinPublicUrl("https://hot.example///", "posts/a.png")).toBe("https://hot.example/posts/a.png");
  });
});
