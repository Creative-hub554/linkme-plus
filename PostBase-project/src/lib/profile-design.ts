export const profileLayouts = ["classic", "creator", "anime", "portfolio", "minimal"] as const;
export type ProfileLayout = (typeof profileLayouts)[number];

export const profilePalettes = ["midnight", "sakura", "cyber", "sunset", "cloud"] as const;
export type ProfilePalette = (typeof profilePalettes)[number];

export const profileCardStyles = ["soft", "glass", "outline"] as const;
export type ProfileCardStyle = (typeof profileCardStyles)[number];

export interface ProfileDesign {
  layout: ProfileLayout;
  palette: ProfilePalette;
  cardStyle: ProfileCardStyle;
  reducedMotion: boolean;
}

export const DEFAULT_PROFILE_DESIGN: ProfileDesign = {
  layout: "classic",
  palette: "midnight",
  cardStyle: "soft",
  reducedMotion: false,
};

/** Literal Tailwind classes keep the public palette allow-list visible to the build. */
export const profilePaletteGradients: Record<ProfilePalette, string> = {
  midnight: "from-slate-950 via-blue-900 to-indigo-600",
  sakura: "from-fuchsia-700 via-pink-500 to-orange-300",
  cyber: "from-cyan-500 via-blue-700 to-violet-800",
  sunset: "from-orange-500 via-rose-600 to-purple-800",
  cloud: "from-sky-300 via-blue-500 to-indigo-700",
};

function oneOf<T extends readonly string[]>(value: unknown, choices: T): value is T[number] {
  return typeof value === "string" && (choices as readonly string[]).includes(value);
}

/** Public presentation data only: no arbitrary CSS reaches another visitor. */
export function parseProfileDesign(value: unknown): ProfileDesign | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (!oneOf(candidate.layout, profileLayouts)) return null;
  if (!oneOf(candidate.palette, profilePalettes)) return null;
  if (!oneOf(candidate.cardStyle, profileCardStyles)) return null;
  if (typeof candidate.reducedMotion !== "boolean") return null;
  return { layout: candidate.layout, palette: candidate.palette, cardStyle: candidate.cardStyle, reducedMotion: candidate.reducedMotion };
}
