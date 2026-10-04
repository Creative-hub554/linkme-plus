/**
 * Helpers for the published Cover Studio video.
 *
 * Kept out of the page and the cover dialog for the same reason `formatPostTime`
 * is kept out of the post card: `profiles.shortVideoCoverConfig` is untyped JSONB
 * written by the publish route and read defensively here, and both the parse and
 * the wording are worth checking without a browser.
 */

export interface CoverVideoConfig {
  templateId?: string;
  photoUrls?: string[];
  updatedAt?: string;
}

/**
 * Reads `profiles.shortVideoCoverConfig`, which is untyped JSONB.
 *
 * Every field is optional and a config with nothing usable in it reads as
 * `null`, so the profile can treat "no published cover video" and "a cover video
 * whose details were never recorded" the same way instead of printing blanks.
 */
export function parseCoverVideoConfig(value: unknown): CoverVideoConfig | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const record = value as Record<string, unknown>;
  const config: CoverVideoConfig = {};

  if (typeof record.templateId === "string" && record.templateId.length > 0) {
    config.templateId = record.templateId;
  }
  if (Array.isArray(record.photoUrls)) {
    const urls = record.photoUrls.filter((url): url is string => typeof url === "string");
    if (urls.length > 0) config.photoUrls = urls;
  }
  if (typeof record.updatedAt === "string" && record.updatedAt.length > 0) {
    config.updatedAt = record.updatedAt;
  }

  return Object.keys(config).length > 0 ? config : null;
}

/**
 * One line for the cover editor saying what the published video is.
 *
 * The fallback sentence matters: this text is the only thing in the editor that
 * says the banner is playing a video rather than showing a photo, so it has to
 * read as a sentence even when nothing is known about how the clip was made.
 */
export function describeCoverVideo(
  templateName: string | null | undefined,
  pictureCount: number | null | undefined,
): string {
  const pictures =
    typeof pictureCount === "number" && pictureCount > 0
      ? `${pictureCount} ${pictureCount === 1 ? "picture" : "pictures"}`
      : null;
  const template = templateName ? `the ${templateName} template` : null;

  if (pictures && template) return `Made with ${pictures} and ${template}.`;
  if (pictures) return `Made with ${pictures}.`;
  if (template) return `Made with ${template}.`;
  return "Published from Cover Studio.";
}
