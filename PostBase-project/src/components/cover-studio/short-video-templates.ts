export type CoverTemplateId =
  | "marquee-wall"
  | "soft-gradient-focus"
  | "light-sweep"
  | "particle-dust"
  | "photo-motion-bg"
  | "color-wash"
  | "split-vignette"
  | "texture-overlay"
  | "slow-zoom-ring-pulse"
  | "minimal-clean"
  | "neon-pulse"
  | "aurora-borealis"
  | "film-strip"
  | "deep-space"
  | "water-ripple"
  | "golden-hour"
  | "urban-night"
  | "geometry-overlay"
  | "double-exposure"
  | "light-leak"
  | "paper-texture"
  | "chrome-reflection"
  | "forest-mist"
  | "ocean-waves"
  | "sunset-dust"
  | "mirror-edge"
  | "holographic"
  | "spotlight-studio"
  | "vintage-film"
  | "gradient-mesh";

export interface ShortVideoTemplate {
  id: CoverTemplateId;
  name: string;
  aspectRatio: "9:16";
  /** background render mode */
  backgroundMode: "color" | "video" | "photo";
  /** whether the template shows a subtitle text line */
  showSubtitle: boolean;
  /** whether the template shows a product-link chip at the bottom */
  showProductChip: boolean;
  colors: [string, string, string];
  /** animation parameters driven by the canvas */
  motion: {
    duration: number; // loop duration in seconds
    speed: "slow" | "normal" | "fast";
  };
  /** human-readable description shown in the picker */
  description: string;
  /** thumbnail preview (inline SVG data URI) */
  thumb: string;
}

const palettes: Record<string, [string, string, string]> = {
  navy: ["#071426", "#1a3a5c", "#3b82f6"],
  sunset: ["#2a1020", "#7c2d12", "#f59e0b"],
  midnight: ["#030712", "#1e293b", "#8b5cf6"],
  rose: ["#240b18", "#831843", "#ec4899"],
  ocean: ["#032b3b", "#0e7490", "#06b6d4"],
  gold: ["#09090b", "#714100", "#d4af37"],
  emerald: ["#022c22", "#065f46", "#10b981"],
  slate: ["#0f172a", "#334155", "#94a3b8"],
};

const definitions: Array<[
  CoverTemplateId,
  string,
  "color" | "video" | "photo",
  boolean,
  boolean,
  string,
  string
]> = [
  [
    "marquee-wall",
    "Marquee Wall",
    "color",
    true,
    true,
    "A scrolling band of your moments slides beneath a ringed center frame.",
    "Scrolling marquee of video stills + ringed profile center",
  ],
  [
    "soft-gradient-focus",
    "Soft Gradient Focus",
    "color",
    true,
    false,
    "A warm gradient breathes behind a softly glowing center profile.",
    "Shifting gradient + soft glow around profile",
  ],
  [
    "light-sweep",
    "Light Sweep",
    "color",
    true,
    false,
    "A single luminous bar sweeps across a dark field and pauses at the center.",
    "Dark field + sweeping light bar + center profile",
  ],
  [
    "particle-dust",
    "Particle Dust",
    "color",
    true,
    false,
    "Floating particles drift around a glowing center while your videos flash in.",
    "Particle field + center glow + video flashes",
  ],
  [
    "photo-motion-bg",
    "Photo Motion BG",
    "video",
    true,
    true,
    "Your uploaded videos become a slow-motion background; the center stays sharp.",
    "Ken Burns video background + ringed center + subtitle",
  ],
  [
    "color-wash",
    "Color Wash",
    "color",
    true,
    true,
    "The background cycles through your palette while the ring pulses gently.",
    "Cycling palette + pulsing ring + product chip",
  ],
  [
    "split-vignette",
    "Split Vignette",
    "video",
    true,
    false,
    "Two video edges frame a bright center; the corners fall into shadow.",
    "Split video edges + bright center + vignette",
  ],
  [
    "texture-overlay",
    "Texture Overlay",
    "color",
    true,
    false,
    "A warm grain texture sits over your palette and videos fade through the center.",
    "Warm grain texture + fading video strips",
  ],
  [
    "slow-zoom-ring-pulse",
    "Slow Zoom & Ring Pulse",
    "video",
    true,
    true,
    "A slow zoom through your video timeline is ringed by a gentle pulse.",
    "Slow zoom video + pulsing ring + product chip",
  ],
  [
    "minimal-clean",
    "Minimal Clean",
    "color",
    true,
    true,
    "A clean solid backdrop lets the center frame and a single subtitle line speak.",
    "Clean solid + center frame + subtitle + product chip",
  ],
  [
    "neon-pulse",
    "Neon Pulse",
    "color",
    true,
    false,
    "A dark field thrums with a pulsing neon ring and grid lines.",
    "Dark field + pulsing neon ring + grid",
  ],
  [
    "aurora-borealis",
    "Aurora Borealis",
    "color",
    true,
    false,
    "Shifting curtains of color flow across a deep sky behind the center.",
    "Aurora gradient + flowing color + center profile",
  ],
  [
    "film-strip",
    "Film Strip",
    "color",
    true,
    false,
    "Film-strip borders frame the edges while the center stays clear.",
    "Film strip borders + centered profile",
  ],
  [
    "deep-space",
    "Deep Space",
    "color",
    true,
    false,
    "A starfield drifts slowly behind a glowing center portal.",
    "Starfield + center glow + slow drift",
  ],
  [
    "water-ripple",
    "Water Ripple",
    "color",
    true,
    false,
    "Concentric ripples pulse outward from the center frame.",
    "Ripple rings + calm palette + center",
  ],
  [
    "golden-hour",
    "Golden Hour",
    "color",
    true,
    true,
    "Warm sunset light washes across the frame with a corner lens flare.",
    "Warm sunset gradient + lens flare + product chip",
  ],
  [
    "urban-night",
    "Urban Night",
    "color",
    true,
    false,
    "City silhouette edges meet a neon accent at the center.",
    "City silhouette + neon accent + center",
  ],
  [
    "geometry-overlay",
    "Geometry Overlay",
    "color",
    true,
    false,
    "Drifting geometric shapes float across a clean backdrop.",
    "Drifting shapes + clean background",
  ],
  [
    "double-exposure",
    "Double Exposure",
    "photo",
    true,
    false,
    "A duotone blend of your photo and a gradient creates a layered look.",
    "Duotone double exposure + center profile",
  ],
  [
    "light-leak",
    "Light Leak",
    "color",
    true,
    false,
    "Animated light leaks sweep across the edges of the frame.",
    "Light leak overlays + clean center",
  ],
  [
    "paper-texture",
    "Paper Texture",
    "color",
    true,
    false,
    "A warm paper texture with soft shadow gives a tactile feel.",
    "Paper texture + soft shadow + center",
  ],
  [
    "chrome-reflection",
    "Chrome Reflection",
    "color",
    true,
    false,
    "A metallic gradient reflects like polished chrome around the center.",
    "Chrome metallic gradient + center",
  ],
  [
    "forest-mist",
    "Forest Mist",
    "color",
    true,
    false,
    "A deep green gradient fades into drifting mist at the edges.",
    "Forest green + drifting mist + center",
  ],
  [
    "ocean-waves",
    "Ocean Waves",
    "color",
    true,
    false,
    "Animated wave patterns roll across a deep blue background.",
    "Animated waves + deep blue + center",
  ],
  [
    "sunset-dust",
    "Sunset Dust",
    "color",
    true,
    true,
    "Warm dust particles float through a sunset gradient.",
    "Sunset gradient + floating dust + product chip",
  ],
  [
    "mirror-edge",
    "Mirror Edge",
    "color",
    true,
    false,
    "The edges mirror inward toward a bright center frame.",
    "Mirrored edges + bright center",
  ],
  [
    "holographic",
    "Holographic",
    "color",
    true,
    false,
    "A rainbow-shifting gradient gives a holographic foil effect.",
    "Holographic rainbow gradient + center",
  ],
  [
    "spotlight-studio",
    "Spotlight Studio",
    "color",
    true,
    false,
    "A dark stage is lit by a single spotlight on the center frame.",
    "Dark stage + spotlight + center",
  ],
  [
    "vintage-film",
    "Vintage Film",
    "color",
    true,
    false,
    "A sepia tone with film grain and a soft vignette feels nostalgic.",
    "Sepia + film grain + vintage vignette",
  ],
  [
    "gradient-mesh",
    "Gradient Mesh",
    "color",
    true,
    true,
    "A mesh of blended gradients shifts slowly behind the center.",
    "Mesh gradient + slow shift + product chip",
  ],
];

export const shortVideoTemplates: ShortVideoTemplate[] = definitions.map(
  ([id, name, backgroundMode, showSubtitle, showProductChip, description]) => {
    const paletteKeys = Object.keys(palettes);
    const colors = palettes[paletteKeys[Math.abs(hashCode(id)) % paletteKeys.length]];
    return {
      id,
      name,
      aspectRatio: "9:16",
      backgroundMode,
      showSubtitle,
      showProductChip,
      colors,
      motion: {
        duration: 8,
        speed: "slow",
      },
      description,
      thumb: makeThumb(id, colors, backgroundMode, showProductChip),
    };
  },
);

function makeThumb(id: string, colors: [string, string, string], backgroundMode: string, showProductChip: boolean): string {
  const [c0, c1, c2] = colors;
  const hasProduct = showProductChip;
  const isVideo = backgroundMode === "video";
  const isPhoto = backgroundMode === "photo";
  // 16:9 thumbnail showing 9:16 frame with round center
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 90" width="160" height="90">
  <defs>
    <linearGradient id="bg-${id}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${c0}"/>
      <stop offset="0.5" stop-color="${c1}"/>
      <stop offset="1" stop-color="${c2}"/>
    </linearGradient>
    <clipPath id="frame-${id}">
      <rect x="0" y="0" width="160" height="90" rx="6"/>
    </clipPath>
  </defs>
  <rect x="0" y="0" width="160" height="90" rx="6" fill="url(#bg-${id})"/>
  ${isVideo || isPhoto ? `<rect x="40" y="10" width="80" height="40" rx="4" fill="rgba(255,255,255,0.12)" stroke="rgba(255,255,255,0.2)" stroke-width="0.5"/><text x="80" y="34" text-anchor="middle" font-size="6" fill="rgba(255,255,255,0.5)" font-family="sans-serif">VIDEO</text>` : ""}
  <circle cx="80" cy="40" r="22" fill="rgba(0,0,0,0.35)" stroke="${c2}" stroke-width="1.5"/>
  <circle cx="80" cy="40" r="17" fill="none" stroke="rgba(255,255,255,0.25)" stroke-width="0.5"/>
  <!-- sample person silhouette -->
  <circle cx="80" cy="36" r="7" fill="rgba(255,255,255,0.7)"/>
  <path d="M 64 52 Q 64 44 80 44 Q 96 44 96 52 L 96 54 L 64 54 Z" fill="rgba(255,255,255,0.5)"/>
  <circle cx="80" cy="40" r="8" fill="rgba(77,112,255,0.6)"/>
  ${hasProduct ? `<rect x="55" y="72" width="50" height="7" rx="3" fill="${c2}" opacity="0.8"/><text x="80" y="77" text-anchor="middle" font-size="4.5" fill="white" font-family="sans-serif" font-weight="600">SHOP</text>` : ""}
  <text x="80" y="84" text-anchor="middle" font-size="4" fill="rgba(255,255,255,0.4)" font-family="sans-serif">COVER</text>
</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export const shortVideoCategories = [
  "All",
  "Color",
  "Video",
  "Subtitle",
  "Product",
];

/**
 * Looks a template up by id. The parameter is a plain string, not
 * `CoverTemplateId`, because the id usually arrives from stored JSONB (the
 * published cover's own config) rather than from the picker, and a value that
 * came back from the database is not something the compiler can vouch for.
 */
export function shortVideoTemplateById(id: string): ShortVideoTemplate | undefined {
  return shortVideoTemplates.find((t) => t.id === id);
}

function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return hash;
}
