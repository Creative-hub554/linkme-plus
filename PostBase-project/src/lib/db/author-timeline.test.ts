import { describe, expect, test } from "vitest";
import { and } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { authoredByMember } from "@/lib/db/author-timeline";

/**
 * Renders the conditions exactly as the query builder would embed them, without
 * a database: `PgDialect` turns drizzle's SQL object into text plus bindings.
 *
 * What is pinned here is the shape of the `?authorId=` filter — which rows a
 * member's own timeline is built from — and no test can evaluate that against a
 * live table. The conditions are compiled joined with `and`, the way the route's
 * `where(and(...conditions))` actually combines them.
 */
function compile(authorId: string) {
  const combined = and(...authoredByMember(authorId));
  if (!combined) throw new Error("expected the member timeline to add conditions");
  return new PgDialect().sqlToQuery(combined);
}

describe("authoredByMember", () => {
  test("names the member as the author", () => {
    expect(compile("member-1").sql).toMatch(/"author_id" = \$1/);
  });

  test("rules out the Pages the member runs", () => {
    // Without this, running a Page would fill the admin's own timeline with
    // posts the Page made. The Page's own listing reads them back by page id.
    expect(compile("member-1").sql).toMatch(/"page_id" is null/i);
  });

  test("binds only the member's own id", () => {
    expect(compile("member-1").params).toEqual(["member-1"]);
  });

  test("binds each member's own id rather than a shared value", () => {
    expect(compile("reader-a").params).toEqual(["reader-a"]);
    expect(compile("reader-b").params).toEqual(["reader-b"]);
  });
});
