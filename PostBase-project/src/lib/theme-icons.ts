import { Monitor, Moon, Sun } from "lucide-react";
import type { ThemeChoice } from "@/lib/theme";

/**
 * One icon per theme, in one place.
 *
 * Every picker of the theme draws its glyphs here — the settings card and the
 * nav's mobile panel (both through `ThemeChoiceGroup`) and the nav's account
 * menu (`ThemeMenuItems`) — and they must not disagree about which glyph means
 * "System". The label comes from `THEMES` in `theme.ts`; this is the picture
 * beside it.
 *
 * Not in `theme.ts`, and the reason is bundle-shaped rather than tidy: that
 * module is imported by the database schema and by an API route that returns
 * JSON, so putting three icon components behind it would ship them to the
 * server for a route that never draws anything. Nothing on the server imports
 * this file.
 */
export const THEME_ICONS = {
  light: Sun,
  dark: Moon,
  system: Monitor,
} satisfies Record<ThemeChoice, typeof Sun>;
