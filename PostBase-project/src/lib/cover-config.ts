/**
 * Reads the photo list out of `profiles.coverConfig`, which is untyped JSONB.
 *
 * The animated cover's config is written by `POST /api/profile/cover-config`
 * with a `photos` array of public URLs and read back by the profile to render
 * the banner. The removal paths need those URLs as storage keys: when a config
 * is replaced or the whole cover is removed, the photos it held are
 * unreferenced, and the config is the only record of which objects they were.
 *
 * Defensive in the same way `parseCoverVideoConfig` is: anything that is not an
 * array of strings reads as "no photos" rather than throwing from inside a
 * delete that runs after the row has already been committed.
 */
export function coverConfigPhotoUrls(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const photos = (value as { photos?: unknown }).photos;
  if (!Array.isArray(photos)) return [];
  return photos.filter((url): url is string => typeof url === "string" && url.length > 0);
}
