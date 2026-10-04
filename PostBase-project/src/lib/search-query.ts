/**
 * What counts as a search query, and where a search goes.
 *
 * Two places read a query — the form that starts one and the page that renders
 * one — and they have to agree. They disagree in two ways if each trims for
 * itself. A page that took `?q=%20` for a query would search for a space, and
 * the API wraps the term in `%` before matching, so that matches everything. A
 * form that navigated from a blank box would replace the page the reader was
 * reading with an empty search. Both are cheap to get wrong and invisible until
 * somebody does it.
 */

/** The query a reader meant, with the typing noise removed. `""` means none. */
export function normalizeSearchQuery(raw: string | null | undefined): string {
  return (raw ?? "").trim();
}

/**
 * The search page's address for a query, or `null` when there is nothing to
 * search for.
 *
 * `null` rather than `/search` so a caller has to decide what a blank box means
 * instead of navigating by default — the caller that has somewhere to be can
 * send the reader to `/search` itself, and the one that does not can stay put.
 */
export function searchHref(raw: string | null | undefined): string | null {
  const query = normalizeSearchQuery(raw);
  return query ? `/search?q=${encodeURIComponent(query)}` : null;
}
