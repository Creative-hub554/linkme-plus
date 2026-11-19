/**
 * The Profile Theme Studio's shared model.
 *
 * Both the editor and the save route read this one file: the editor so its
 * pickers cannot offer an id the route would reject, and the route so its
 * validation is the same function the editor hydrates with — one list of
 * layouts, styles and blocks, and one place where the motion and contrast
 * safeguards are computed.
 *
 * The styles are anime-*inspired*, not anime *fan art*: every motif is an
 * original abstract pattern (petals, speed lines, halftone dots, a hex grid, a
 * silhouette), because profile themes have to be safe to publish — no licensed
 * characters, nothing that reads as someone else's trademark — and every
 * palette is a fixed, designed combination rather than free color choice,
 * because "the reader can always read it" is enforced better by shipping
 * combinations that already pass the contrast floor than by asking a member to
 * design around one.
 *
 * What the theme deliberately does NOT cover is identity and safety: the name,
 * handle, photo and the account's own controls (visibility, report, block)
 * belong to the profile and stay fixed and recognizable in every layout. The
 * layouts reserve a fixed identity zone that member-chosen decorations cannot
 * roam over, and "position" on the blocks list covers the optional content
 * blocks only.
 */

// ─── Ids ─────────────────────────────────────────────────────────

export type ProfileThemeLayoutId =
  | "classic-spotlight"
  | "gallery-fan"
  | "banner-focus"
  | "vertical-poster";

export type ProfileThemeStyleId =
  | "sakura-blossom"
  | "shoujo-sparkle"
  | "manga-ink"
  | "mecha-hangar"
  | "torii-dusk";

export type ProfileThemeBlockId =
  | "highlights"
  | "interests"
  | "media-strip"
  | "quote"
  | "links";

export type ProfileThemeDecorationZone =
  | "corner-top-left"
  | "corner-top-right"
  | "corner-bottom-left"
  | "corner-bottom-right"
  | "header-edge";

export interface ProfileThemeDecoration {
  id: string;
  /**
   * A staged decoration has no stored object yet: its url is `null` in the
   * request the editor serializes, and the route fills it from the file sent
   * at the same position. `normalizeProfileThemeConfig` still refuses a null —
   * a stored config must never carry a stub that never became an upload — so
   * the widened type exists for the request shape, not for storage.
   */
  url: string | null;
  zone: ProfileThemeDecorationZone;
}

/**
 * The optional content blocks, in the order they render. `position` is the
 * authority on order — the array order itself is never read — so editing the
 * order means editing positions into a clean permutation.
 */
export interface ProfileThemeBlockPlacement {
  id: ProfileThemeBlockId;
  included: boolean;
  position: number;
}

export interface ProfileThemeConfig {
  layoutId: ProfileThemeLayoutId;
  styleId: ProfileThemeStyleId;
  /** The Standard view: the plain, unthemed profile. True turns the theme off. */
  standard: boolean;
  blocks: ProfileThemeBlockPlacement[];
  decorations: ProfileThemeDecoration[];
  /** Ambient motion (style motifs drifting, shimmering). May be forced off. */
  motion: boolean;
}

// ─── Layouts ─────────────────────────────────────────────────────

/**
 * Where the identity zone sits, and nothing else: a layout's whole freedom is
 * the arrangement *around* identity and safety, never identity itself.
 */
export type ProfileThemeIdentityPlacement = "over-banner" | "lead" | "left" | "stacked";

export interface ProfileThemeLayout {
  id: ProfileThemeLayoutId;
  name: string;
  description: string;
  identityPlacement: ProfileThemeIdentityPlacement;
}

export const profileThemeLayouts: ProfileThemeLayout[] = [
  {
    id: "classic-spotlight",
    name: "Classic Spotlight",
    description: "Identity over the picture, blocks listed beneath — the profile as it is today, dressed.",
    identityPlacement: "over-banner",
  },
  {
    id: "gallery-fan",
    name: "Gallery Fan",
    description: "Your theme art opens the page and the blocks fan out beside identity.",
    identityPlacement: "left",
  },
  {
    id: "banner-focus",
    name: "Banner Focus",
    description: "One wide block on top, the rest of identity beneath — made for readers who scroll.",
    identityPlacement: "lead",
  },
  {
    id: "vertical-poster",
    name: "Vertical Poster",
    description: "Identity stacks tall on the left; blocks run down the right like a poster column.",
    identityPlacement: "stacked",
  },
];

export function profileThemeLayoutById(id: string): ProfileThemeLayout | undefined {
  return profileThemeLayouts.find((layout) => layout.id === id);
}

// ─── Styles ──────────────────────────────────────────────────────

export type ProfileThemeMotif = "petals" | "sparkles" | "halftone" | "hex-grid" | "torii";

/**
 * A style's own colors, fixed on purpose. `text` is what body text draws in on
 * `bg` (and on `surface`); `muted` is de-emphasized text such as handles, which
 * answers to the same floor the test suite pins for `text`; `accent` is chosen
 * for decoration and rings, and is what the contrast Safeguard computes
 * `accent-on-surface` from so a style whose accent would sit unreadably on its
 * own server marks itself unavailable rather than shipping unreadable.
 */
export interface ProfileThemeStyleColors {
  bg: string;
  surface: string;
  text: string;
  muted: string;
  accent: string;
}

export interface ProfileThemeStyle {
  id: ProfileThemeStyleId;
  name: string;
  description: string;
  motif: ProfileThemeMotif;
  colors: ProfileThemeStyleColors;
  /** Whether the style ships ambient motion at all. */
  motionCapable: boolean;
}

export const profileThemeStyles: ProfileThemeStyle[] = [
  {
    id: "sakura-blossom",
    name: "Sakura Blossom",
    description: "Petals drift down a warm blossom page. Inspired by spring, drawn as plain petals.",
    motif: "petals",
    colors: {
      bg: "#2b0f1d",
      surface: "#411529",
      text: "#fde8ef",
      muted: "#e8b8ca",
      accent: "#f472b6",
    },
    motionCapable: true,
  },
  {
    id: "shoujo-sparkle",
    name: "Shoujo Sparkle",
    description: "Soft lavender with four-point sparkles, the way a magazine panel catches light.",
    motif: "sparkles",
    colors: {
      bg: "#241539",
      surface: "#372252",
      text: "#f3ecff",
      muted: "#d0beee",
      accent: "#c084fc",
    },
    motionCapable: true,
  },
  {
    id: "manga-ink",
    name: "Manga Ink",
    description: "Ink black, white panels and a halftone field — the loudest palette, the same rules.",
    motif: "halftone",
    colors: {
      bg: "#101014",
      surface: "#1d1d22",
      text: "#fafafa",
      muted: "#c8c8cf",
      accent: "#e11d48",
    },
    motionCapable: false,
  },
  {
    id: "mecha-hangar",
    name: "Mecha Hangar",
    description: "Steel grey with a hex-grid glow, as a hangar floor reads in a work print.",
    motif: "hex-grid",
    colors: {
      bg: "#0b1418",
      surface: "#122129",
      text: "#e2f6ff",
      muted: "#9fc4d4",
      accent: "#22d3ee",
    },
    motionCapable: true,
  },
  {
    id: "torii-dusk",
    name: "Torii Dusk",
    description: "Deep indigo sky and a vermillion ring — dusk behind a gate, drawn as a silhouette.",
    motif: "torii",
    colors: {
      bg: "#171327",
      surface: "#241d3a",
      text: "#f1ebff",
      muted: "#c3b8e3",
      accent: "#fb7185",
    },
    motionCapable: false,
  },
];

export function profileThemeStyleById(id: string): ProfileThemeStyle | undefined {
  return profileThemeStyles.find((style) => style.id === id);
}

// ─── Blocks ──────────────────────────────────────────────────────

export interface ProfileThemeBlock {
  id: ProfileThemeBlockId;
  name: string;
  /** What the block shows, one sentence — the preview's reconstructed content. */
  description: string;
  optional: true;
}

export const profileThemeBlocks: ProfileThemeBlock[] = [
  {
    id: "highlights",
    name: "Highlights",
    description: "Three pinned tiles from your own feed.",
    optional: true,
  },
  {
    id: "interests",
    name: "Interests",
    description: "Chips for the things you have tagged.",
    optional: true,
  },
  {
    id: "media-strip",
    name: "Media strip",
    description: "A row of your recent photos and videos.",
    optional: true,
  },
  {
    id: "quote",
    name: "Quote",
    description: "One line from your bio, set larger.",
    optional: true,
  },
  {
    id: "links",
    name: "Links",
    description: "Your website and where to find you.",
    optional: true,
  },
];

export function profileThemeBlockById(id: string): ProfileThemeBlock | undefined {
  return profileThemeBlocks.find((block) => block.id === id);
}

/** The block order a first-time studio opens with. */
export const defaultProfileThemeBlocks: ProfileThemeBlockPlacement[] = [
  { id: "highlights", included: true, position: 0 },
  { id: "interests", included: true, position: 1 },
  { id: "media-strip", included: true, position: 2 },
  { id: "quote", included: false, position: 3 },
  { id: "links", included: false, position: 4 },
];

// ─── Decorations ─────────────────────────────────────────────────

export const MAX_PROFILE_THEME_DECORATIONS = 6;
export const MAX_PROFILE_THEME_DECORATION_BYTES = 5 * 1024 * 1024;
export const PROFILE_THEME_DECORATION_ACCEPT = "image/png,image/webp,image/jpeg,image/gif";

/**
 * Zones decorations may sit in. Deliberately there is no "over identity" and no
 * "over body text": a member-chosen image that could land on the name, the
 * photo or a block the reader is reading is the freedom this model does not
 * sell — identity and safety stay recognizable in every layout, so decorations
 * get fixed zones that cannot reach them.
 */
export const profileThemeDecorationZones: Array<{ id: ProfileThemeDecorationZone; name: string }> = [
  { id: "corner-top-left", name: "Top-left corner" },
  { id: "corner-top-right", name: "Top-right corner" },
  { id: "corner-bottom-left", name: "Bottom-left corner" },
  { id: "corner-bottom-right", name: "Bottom-right corner" },
  { id: "header-edge", name: "Along the picture edge" },
];

export function profileThemeDecorationZoneById(id: string): ProfileThemeDecorationZone | undefined {
  return profileThemeDecorationZones.find((zone) => zone.id === id)?.id;
}

// ─── Contrast safeguard ──────────────────────────────────────────

/** One color channel's contribution to relative luminance, WCAG 2.1 §1.4. */
function sRGBChannel(value: number): number {
  const channel = value / 255;
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

/** Relative luminance of a `#rrggbb` string, or `null` if it is not one. */
export function relativeLuminance(hex: string): number | null {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) return null;
  const raw = match[1];
  const channels = [0, 2, 4].map((offset) => parseInt(raw.slice(offset, offset + 2), 16));
  return (
    0.2126 * sRGBChannel(channels[0]!) +
    0.7152 * sRGBChannel(channels[1]!) +
    0.0722 * sRGBChannel(channels[2]!)
  );
}

/** The WCAG contrast ratio of two hex colors, or `null` if either is malformed. */
export function contrastRatio(a: string, b: string): number | null {
  const first = relativeLuminance(a);
  const second = relativeLuminance(b);
  if (first === null || second === null) return null;
  const [lighter, darker] = first >= second ? [first, second] : [second, first];
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * The contrast floor a style answers to. Body text needs 4.5:1 (WCAG AA for
 * normal text); the muted roles and the accent draw at least 3:1, the large-text
 * floor, because handles and rings read bigger and bolder than body copy.
 */
export const PROFILE_THEME_CONTRAST_FLOOR_TEXT = 4.5;
export const PROFILE_THEME_CONTRAST_FLOOR_LARGE = 3;

export interface ProfileThemeStyleContrast {
  textOnBg: number;
  textOnSurface: number;
  mutedOnSurface: number;
  accentOnSurface: number;
}

/** The four ratios the safeguard checks, computed from the style itself. */
export function profileThemeStyleContrast(style: ProfileThemeStyle): ProfileThemeStyleContrast | null {
  const colors = style.colors;
  const textOnBg = contrastRatio(colors.text, colors.bg);
  const textOnSurface = contrastRatio(colors.text, colors.surface);
  const mutedOnSurface = contrastRatio(colors.muted, colors.surface);
  const accentOnSurface = contrastRatio(colors.accent, colors.surface);
  if (textOnBg === null || textOnSurface === null || mutedOnSurface === null || accentOnSurface === null) {
    return null;
  }
  return { textOnBg, textOnSurface, mutedOnSurface, accentOnSurface };
}

/**
 * The motion/contrast safeguard, as a single yes/no a picker can bind to.
 *
 * The studio computes a style's four ratios and refuses to offer it when any
 * pair fails its floor, so a style that ships unreadable does not reach the
 * editor at all — the safeguard runs on the shared list, not on the member's
 * patience. Every shipped style is expected to pass (its test pins exactly
 * that), which is why this exists as a computed check rather than a hand-written
 * `true`: a palette edit that silently falls below the floor now removes the
 * style from the pickers instead of shipping it.
 */
export function isProfileThemeStyleAvailable(style: ProfileThemeStyle): boolean {
  const contrast = profileThemeStyleContrast(style);
  if (!contrast) return false;
  return (
    contrast.textOnBg >= PROFILE_THEME_CONTRAST_FLOOR_TEXT &&
    contrast.textOnSurface >= PROFILE_THEME_CONTRAST_FLOOR_TEXT &&
    contrast.mutedOnSurface >= PROFILE_THEME_CONTRAST_FLOOR_LARGE &&
    contrast.accentOnSurface >= PROFILE_THEME_CONTRAST_FLOOR_LARGE
  );
}

/**
 * Shippable styles, in picker order. Pickers map this rather than the full list
 * so an unavailable style is absent from the editor instead of shown disabled —
 * and the model's own test pins that the list is *all* of them today.
 */
export function availableProfileThemeStyles(): ProfileThemeStyle[] {
  return profileThemeStyles.filter(isProfileThemeStyleAvailable);
}

// ─── Config shape, defaults, validation ──────────────────────────

/** The Standard view as a config: the theme off, defaults beneath it. */
export const standardProfileThemeConfig: ProfileThemeConfig = {
  layoutId: profileThemeLayouts[0]!.id,
  styleId: profileThemeStyles[0]!.id,
  standard: true,
  blocks: defaultProfileThemeBlocks,
  decorations: [],
  motion: false,
};

function isBlockPlacementArray(value: unknown): value is ProfileThemeBlockPlacement[] {
  if (!Array.isArray(value)) return false;
  const seen = new Set<ProfileThemeBlockId>();
  const positions = new Set<number>();
  for (const entry of value) {
    if (!entry || typeof entry !== "object") return false;
    const { id, included, position } = entry as Record<string, unknown>;
    if (
      !profileThemeBlockById(String(id)) ||
      typeof included !== "boolean" ||
      typeof position !== "number" ||
      !Number.isInteger(position) ||
      position < 0
    ) {
      return false;
    }
    if (seen.has(id as ProfileThemeBlockId)) return false;
    seen.add(id as ProfileThemeBlockId);
    positions.add(position);
  }
  // Positions must form 0…n-1: the pile is rendered in a clean order, so a
  // sparsed list would silently clamp rather than mislead the reader.
  if (seen.size !== profileThemeBlocks.length) return false;
  return [...positions].sort((a, b) => a - b).every((position, index) => position === index);
}

function decorateZone(value: unknown): ProfileThemeDecorationZone | undefined {
  if (typeof value !== "string") return undefined;
  return profileThemeDecorationZoneById(value);
}

function isDecorationArray(value: unknown): value is ProfileThemeDecoration[] {
  if (!Array.isArray(value) || value.length > MAX_PROFILE_THEME_DECORATIONS) return false;
  const ids = new Set<string>();
  for (const entry of value) {
    if (!entry || typeof entry !== "object") return false;
    const { id, url, zone } = entry as Record<string, unknown>;
    if (
      typeof id !== "string" ||
      id.length === 0 ||
      id.length > 64 ||
      ids.has(id) ||
      typeof url !== "string" ||
      !(url.startsWith("https://") || url.startsWith("http://") || url.startsWith("/")) ||
      url.length > 2048 ||
      !decorateZone(zone)
    ) {
      return false;
    }
    ids.add(id);
  }
  return true;
}

/**
 * Validates a config that came from outside the compiler — `request.json()`,
 * or JSONB read back from a row written by an older build.
 *
 * Returns the config as `ProfileThemeConfig`, or `null` when it is not one; callers
 * turn a null into their own fallback (the route answers 400, the editor falls
 * back to the Standard view).
 */
export function normalizeProfileThemeConfig(value: unknown): ProfileThemeConfig | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;

  const layoutId = typeof candidate.layoutId === "string" ? candidate.layoutId : null;
  const styleId = typeof candidate.styleId === "string" ? candidate.styleId : null;
  if (!layoutId || !styleId) return null;
  const layout = profileThemeLayoutById(layoutId);
  const style = profileThemeStyleById(styleId);
  if (!layout || !style) return null;

  if (typeof candidate.standard !== "boolean") return null;
  if (typeof candidate.motion !== "boolean") return null;
  if (!isBlockPlacementArray(candidate.blocks)) return null;
  if (!isDecorationArray(candidate.decorations)) return null;

  // Decorations a member staged for an upload they never finished are
  // serialized with `url: null`; a config holding such an entry is the editor's
  // own draft shape and is not valid to persist as-is.
  if (candidate.decorations.some((decoration) => decoration.url === null)) return null;

  return {
    layoutId: layout.id,
    styleId: style.id,
    standard: candidate.standard,
    blocks: candidate.blocks,
    decorations: candidate.decorations,
    motion: candidate.motion,
  };
}

/** The block list, ordered for rendering. */
export function orderedProfileThemeBlocks(config: ProfileThemeConfig): ProfileThemeBlockPlacement[] {
  return [...config.blocks].sort((a, b) => a.position - b.position);
}
