import { describe, expect, test } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { listingFirstPhoto } from "@/lib/db/listing-first-photo";

/**
 * A query builder with no driver behind it. Only `toSQL()` is used, so nothing
 * ever connects — what is measured is how drizzle *renders* the subquery the
 * two list reads embed, which no test can evaluate against a live table.
 */
function compile() {
  return new PgDialect().sqlToQuery(listingFirstPhoto());
}

describe("listingFirstPhoto", () => {
  test("reads each media row's url, aliased as the single-listing read aliases it", () => {
    // `lm` is the alias the single-listing read's media rows sort by; the card
    // resolution and the product page must name the same picture the same way.
    expect(compile().sql).toContain("select lm.url from \"listing_media\" as lm");
  });

  test("correlates on the outer listing's id, qualified — not the subquery's own column", () => {
    // An unqualified `listing_id` here would resolve to `lm`'s own column and
    // turn the correlation into `lm.listing_id = lm.listing_id`, which every
    // row satisfies — the same trap the posts gate is qualified against.
    expect(compile().sql).toMatch(
      /where lm\.listing_id = "marketplace_listings"\."id"/,
    );
  });

  test("orders by `order` ascending — the same rule the single-listing read sorts by", () => {
    // The first photo by `order` is what a card shows and what opens on the
    // product page; a different rule here would make them disagree.
    expect(compile().sql).toMatch(/order by lm\."order" asc/i);
  });

  test("answers exactly one url per listing", () => {
    expect(compile().sql).toContain("limit 1");
  });

  test("binds nothing — the correlation is a column reference, not a parameter", () => {
    // A bound parameter here would correlate the whole lookup to a single
    // listing constant instead of to each row the outer read walks.
    expect(compile().params).toEqual([]);
  });
});
