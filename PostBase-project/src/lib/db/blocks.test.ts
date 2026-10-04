import { describe, expect, test } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import { blockedEitherWay, notBlockedEitherWay } from "@/lib/db/blocks";
import { follows, users } from "@/lib/db/schema";

/**
 * A query builder with no driver behind it. Only `toSQL()` is used, so nothing
 * ever connects — what is being measured is how drizzle *renders* the rule
 * inside a real query. The fake `@/lib/db` does not evaluate `where`, so this is
 * the only place the predicate's SQL is pinned.
 */
const builder = drizzle({} as never);

function compile(condition: Parameters<PgDialect["sqlToQuery"]>[0]) {
  return new PgDialect().sqlToQuery(condition);
}

/** The rendered SQL with each placeholder resolved to the value it binds. */
function expand(a: string, b: string): string {
  const { sql, params } = compile(blockedEitherWay(a, b));
  return sql.replace(/\$(\d+)/g, (_match, n: string) => JSON.stringify(params[Number(n) - 1]));
}

describe("blockedEitherWay", () => {
  test("covers the block in both directions", () => {
    const { sql, params } = compile(blockedEitherWay("viewer-1", "target-2"));

    // `a` blocked `b`...
    expect(sql).toMatch(/"blocker_id" = \$1 and "blocks"\."blocked_id" = \$2/);
    // ...and `b` blocked `a`. Only one of these would let the other side through.
    expect(sql).toMatch(/"blocker_id" = \$3 and "blocks"\."blocked_id" = \$4/);
    expect(params).toEqual(["viewer-1", "target-2", "target-2", "viewer-1"]);
  });

  test("reads the same block whichever side is named first", () => {
    // The rule is symmetric: swapping the arguments renames the directions but
    // does not change which pairs are blocked.
    for (const rendered of [expand("a", "b"), expand("b", "a")]) {
      expect(rendered).toContain('"blocker_id" = "a" and "blocks"."blocked_id" = "b"');
      expect(rendered).toContain('"blocker_id" = "b" and "blocks"."blocked_id" = "a"');
    }
  });
});

describe("notBlockedEitherWay", () => {
  test("negates the rule over the surrounding row", () => {
    const { sql, params } = compile(notBlockedEitherWay("viewer-1", users.id));

    expect(sql).toMatch(/^not exists \(/);
    expect(sql).toMatch(/from "blocks"/);
    // The candidate is the surrounding query's member, so the correlation runs
    // outward; an unqualified `"id"` here would compare the block to itself.
    expect(sql).toMatch(/"blocked_id" = "users"\."id"/);
    expect(sql).toMatch(/"blocker_id" = "users"\."id"/);
    expect(params).toEqual(["viewer-1", "viewer-1"]);
  });

  test("keeps the outer member qualified inside a joined list query", () => {
    const { sql } = builder
      .select({ id: users.id })
      .from(follows)
      .innerJoin(users, eq(follows.followerId, users.id))
      .where(notBlockedEitherWay("viewer-1", users.id))
      .toSQL();

    expect(sql).toMatch(/not exists \(/);
    expect(sql).toMatch(/from "blocks"/);
    expect(sql).toMatch(/"blocked_id" = "users"\."id"/);
    // The trap this test exists for: drizzle drops a qualifier in the *select
    // list* of a single-table query, so an unqualified outer reference would
    // turn the arm into `blocks.blocked_id = blocks.id`, true for a real pair.
    expect(sql).not.toMatch(/"blocked_id" = "id"/);
  });
});
