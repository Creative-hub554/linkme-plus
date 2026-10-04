/**
 * "3h ago" for a post's timestamp.
 *
 * Lifted out of the feed and the profile page, which held an identical copy
 * each, so the Page view is not a third. Everything here is relative to *now*,
 * which is why it is a function rather than a stored string: a post's age is a
 * fact about the reader's clock, not about the row.
 */
export function formatPostTime(value: string): string {
  const date = new Date(value);
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return date.toLocaleDateString();
}
