import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { describe, expect, it } from "vitest";
import { ARCHIVE_REWRITE_TARGETS, buildRewriteStatements } from "./media-archive";

/**
 * Execute the archive's generated SQL against real PostgreSQL rather than only
 * checking its text. Point ARCHIVE_TEST_DATABASE_URL at a disposable database
 * and opt in explicitly:
 *
 *   ARCHIVE_LIVE_POSTGRES=1 ARCHIVE_TEST_DATABASE_URL=<scratch> \
 *     npx vitest run src/lib/media-archive-live-postgres.test.ts
 *
 * This never falls back to DATABASE_URL. It creates a uniquely named schema
 * inside one transaction and rolls the entire schema back on completion.
 */
const DATABASE_URL = process.env.ARCHIVE_TEST_DATABASE_URL;
const ENABLED = process.env.ARCHIVE_LIVE_POSTGRES === "1" && Boolean(DATABASE_URL);

(ENABLED ? describe : describe.skip)("archive rewrite SQL against live Postgres", () => {
  it("rewrites text, jsonb, and text[] targets, including verification evidence", async () => {
    const connection = postgres(DATABASE_URL!, { max: 1, prepare: false, connect_timeout: 5 });
    const schemaName = `archive_rewrite_${randomUUID().replaceAll("-", "")}`;
    const oldUrls = [
      "https://hot.example/posts/member-1/first.png",
      "https://hot.example/posts/member-1/second.png",
    ];
    const newUrls = [
      "https://drive.example/files/first",
      "https://drive.example/files/second",
    ];

    try {
      await connection.begin(async (transaction) => {
        await transaction.unsafe(`create schema "${schemaName}"`);
        await transaction.unsafe(`set local search_path to "${schemaName}"`);

        const columnsByTable = new Map<string, typeof ARCHIVE_REWRITE_TARGETS[number][]>();
        for (const target of ARCHIVE_REWRITE_TARGETS) {
          const columns = columnsByTable.get(target.table) ?? [];
          columns.push(target);
          columnsByTable.set(target.table, columns);
        }

        for (const [table, targets] of columnsByTable) {
          const definitions = targets.map((target) => {
            const type = target.kind === "array" ? "text[]" : target.kind === "jsonb" ? "jsonb" : "text";
            return `"${target.column}" ${type}`;
          });
          await transaction.unsafe(`create table "${table}" (${definitions.join(", ")})`);

          const names = targets.map((target) => `"${target.column}"`).join(", ");
          const values = targets.map((target, index) => {
            const placeholder = `$${index + 1}`;
            if (target.kind === "array") return `${placeholder}::text[]`;
            if (target.kind === "jsonb") return `${placeholder}::jsonb`;
            return placeholder;
          });
          const params = targets.map((target) => {
            if (target.kind === "array") return oldUrls;
            if (target.kind === "jsonb") return JSON.stringify({ links: oldUrls });
            return oldUrls.join(" and ");
          });
          await transaction.unsafe(
            `insert into "${table}" (${names}) values (${values.join(", ")})`,
            params,
          );
        }

        for (const statement of buildRewriteStatements(
          oldUrls.map((oldUrl, index) => ({ oldUrl, newUrl: newUrls[index] })),
        )) {
          await transaction.unsafe(statement.text, statement.params);
        }

        for (const [table, targets] of columnsByTable) {
          const [row] = await transaction.unsafe(`select * from "${table}"`);
          for (const target of targets) {
            const value = row[target.column] as string | string[] | { links: string[] };
            if (target.kind === "array") {
              expect(value, `${table}.${target.column}`).toEqual(newUrls);
            } else if (target.kind === "jsonb") {
              const document = typeof value === "string" ? JSON.parse(value) : value;
              expect(document, `${table}.${target.column}`).toEqual({ links: newUrls });
            } else {
              expect(value, `${table}.${target.column}`).toBe(newUrls.join(" and "));
            }
          }
        }

        // Drop all temporary objects before commit; any earlier failure makes
        // postgres-js roll the transaction (and the schema) back automatically.
        for (const table of columnsByTable.keys()) {
          await transaction.unsafe(`drop table "${schemaName}"."${table}"`);
        }
        await transaction.unsafe(`drop schema "${schemaName}"`);
      });
    } finally {
      await connection.end({ timeout: 5 });
    }
  });
});
