import { describe, expect, test } from "vitest";
import { normalizeSearchQuery, searchHref } from "@/lib/search-query";

describe("normalizeSearchQuery", () => {
  test("keeps what a reader searched for, without the noise around it", () => {
    expect(normalizeSearchQuery("  maya  ")).toBe("maya");
    expect(normalizeSearchQuery("maya designs")).toBe("maya designs");
  });

  test("reads a missing or blank query as no query at all", () => {
    // `?q=%20` arrives as a space, and a page that took it for a query would
    // search for it — which, wrapped in the API's `%…%`, matches everything.
    expect(normalizeSearchQuery(null)).toBe("");
    expect(normalizeSearchQuery(undefined)).toBe("");
    expect(normalizeSearchQuery("")).toBe("");
    expect(normalizeSearchQuery("   ")).toBe("");
    expect(normalizeSearchQuery("\n\t")).toBe("");
  });
});

describe("searchHref", () => {
  test("addresses the search page with the query", () => {
    expect(searchHref("maya")).toBe("/search?q=maya");
    expect(searchHref("  maya  ")).toBe("/search?q=maya");
  });

  test("encodes a query that is not URL-shaped", () => {
    expect(searchHref("a&b #c")).toBe("/search?q=a%26b%20%23c");
  });

  test("has no address for a box with nothing in it", () => {
    // `null` rather than `/search`, so the form has to decide not to navigate
    // instead of replacing the page with an empty search.
    expect(searchHref("")).toBeNull();
    expect(searchHref("   ")).toBeNull();
    expect(searchHref(null)).toBeNull();
    expect(searchHref(undefined)).toBeNull();
  });
});
