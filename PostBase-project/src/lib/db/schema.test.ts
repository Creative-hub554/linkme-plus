import { describe, expect, test } from "vitest";
import { PgTable, getTableConfig } from "drizzle-orm/pg-core";
import * as schema from "@/lib/db/schema";
import { postAudiences } from "@/lib/post-audiences";

/**
 * The schema is 600-odd lines of declarations that nothing else exercises: the
 * migrations read them, the queries are typed from them, and a typo in either
 * direction (a column renamed in one place, a foreign key left pointing at a
 * table that was since split up) surfaces only when a query first runs against
 * a database nobody has created in the test environment.
 *
 * These tests are the substitute. Every exported table is resolved through
 * drizzle's own `getTableConfig` — the same path DDL generation takes, which
 * means the `.references(() => …)` callbacks are *invoked* rather than merely
 * stored — and the resolved shape is asserted against the invariants the rest
 * of the codebase silently assumes: the enums hold the values the application
 * offers, foreign keys target tables this file actually defines, and column
 * names stay in the snake_case the SQL side expects.
 */

// Entries are widened first so the guard's target (`[string, PgTable]`) is
// assignable to the parameter type — `Object.entries` infers a union of every
// export, enums included, which a `PgTable` predicate cannot narrow from.
const entries: [string, unknown][] = Object.entries(schema);
const tables = entries.filter((entry): entry is [string, PgTable] => {
  const [, value] = entry;
  return value instanceof PgTable;
});

const tableNames = new Set(tables.map(([, table]) => getTableConfig(table).name));

describe("the exported tables", () => {
  test("resolve to DDL the database could actually create", () => {
    expect(tables.length).toBeGreaterThan(15);
    for (const [exportName, table] of tables) {
      const config = getTableConfig(table);
      // The export name is the query vocabulary; the table name is what the
      // migration writes. Both have to read as the same word.
      expect(config.name, `table ${exportName}`).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(config.columns.length, `table ${exportName} has no columns`).toBeGreaterThan(0);
      for (const column of config.columns) {
        expect(column.name, `${exportName}.${column.name}`).toMatch(/^[a-z][a-z0-9_]*$/);
      }
    }
  });

  test("keep every foreign key pointing at a table this file defines", () => {
    // The callbacks are resolved here rather than at DDL time, so a key left
    // referencing `users` after the split into `users`/`profiles` fails in the
    // suite instead of in a migration applied to a real database.
    for (const [exportName, table] of tables) {
      const config = getTableConfig(table);
      for (const foreignKey of config.foreignKeys) {
        // The reference resolves to the *other side's columns*; the table they
        // belong to is the one being referenced.
        const { foreignColumns } = foreignKey.reference();
        expect(foreignColumns.length, `${exportName} has a key with no target`).toBeGreaterThan(0);
        const referencedName = getTableConfig(foreignColumns[0].table as PgTable).name;
        expect(
          tableNames.has(referencedName),
          `${exportName} references ${referencedName}, which this schema does not define`,
        ).toBe(true);
      }
    }
  });

  test("carry at least one primary key each", () => {
    for (const [exportName, table] of tables) {
      const config = getTableConfig(table);
      const primary = config.columns.filter((column) => column.primary);
      expect(primary.length, `${exportName} has no primary key`).toBeGreaterThan(0);
    }
  });
});

describe("the enums", () => {
  test("offer the visibility column exactly the audiences the rule describes", () => {
    // The comment in `schema.ts` promises this: the column is built from the
    // shared list so the database cannot hold an audience no rule describes.
    // The promise is only worth the assertion that keeps it.
    expect(schema.visibilityEnum.enumValues).toEqual([...postAudiences]);
  });

  test("pin the roles the authorization checks look for", () => {
    expect(schema.userRoleEnum.enumValues).toEqual(["member", "admin", "moderator"]);
  });

  test("pin the lifecycle values each flow walks", () => {
    expect(schema.postTypeEnum.enumValues).toEqual([
      "text",
      "image",
      "video",
      "short_video",
    ]);
    expect(schema.listingStatusEnum.enumValues).toEqual([
      "draft",
      "active",
      "reserved",
      "sold",
      "expired",
      "removed",
    ]);
    expect(schema.jobStatusEnum.enumValues).toEqual([
      "draft",
      "active",
      "closed",
      "archived",
    ]);
    expect(schema.applicationStatusEnum.enumValues).toEqual([
      "pending",
      "reviewing",
      "shortlisted",
      "rejected",
      "hired",
    ]);
    expect(schema.reportStatusEnum.enumValues).toEqual([
      "pending",
      "reviewing",
      "resolved",
      "dismissed",
    ]);
    expect(schema.moderationActionEnum.enumValues).toEqual([
      "warning",
      "removal",
      "suspension",
      "ban",
    ]);
    expect(schema.coverVideoStatusEnum.enumValues).toEqual([
      "pending",
      "rendering",
      "ready",
      "failed",
    ]);
    expect(schema.campaignStatusEnum.enumValues).toEqual([
      "draft",
      "pending_payment",
      "pending_review",
      "approved",
      "scheduled",
      "active",
      "paused",
      "rejected",
      "completed",
      "cancelled",
      "refunded",
    ]);
  });
});
