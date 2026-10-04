import sharp from "sharp";
import { assertStorageConfigured, getPublicUrl, putObject } from "@/lib/r2";

/**
 * Demo imagery for the seed script.
 *
 * The artwork is generated locally with sharp from SVG, so seeding needs no
 * third-party image service and no checked-in binaries: a given index always
 * renders the same picture. Files are written to the project's own R2 bucket
 * under a `seed/` prefix, so the URLs are as stable as real uploads and are
 * served by the same CDN.
 *
 * The one exception is the sample video, which cannot be synthesised here (no
 * encoder is available). It is the Blender Foundation's Big Buck Bunny clip
 * (CC-BY 3.0, via test-videos.co.uk) and is mirrored into R2 on first use, so
 * the app never depends on that host at runtime.
 */

const JPEG_QUALITY = 82;

/** Brand-adjacent palettes; each artwork picks one by index. */
const PALETTES: Array<[string, string, string]> = [
  ["#1d4ed8", "#7c3aed", "#0b1b3a"],
  ["#0ea5e9", "#1e3a8a", "#082f49"],
  ["#7c3aed", "#ec4899", "#1b1035"],
  ["#0f766e", "#22d3ee", "#042f2e"],
  ["#f59e0b", "#b45309", "#2a1a05"],
  ["#e11d48", "#7c3aed", "#2a0716"],
  ["#2563eb", "#06b6d4", "#052033"],
  ["#4f46e5", "#a855f7", "#150a2e"],
  ["#0ea5e9", "#14b8a6", "#03282c"],
  ["#f97316", "#db2777", "#2b0b1a"],
];

/** Deterministic pseudo-random generator so artwork never shifts between runs. */
function pseudoRandom(seed: number): () => number {
  let state = (seed + 1) * 0x6d2b79f5;
  return () => {
    state = (state + 0x9e3779b9) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** An abstract, poster-like composition — stands in for a photo in demo posts. */
export function postArtworkSvg(index: number, width = 1200, height = 800): string {
  const [primary, secondary, deep] = PALETTES[index % PALETTES.length];
  const random = pseudoRandom(index * 7 + 3);

  const blobs = Array.from({ length: 5 }, () => {
    const cx = Math.round(random() * width);
    const cy = Math.round(random() * height);
    const r = Math.round((0.12 + random() * 0.22) * width);
    const opacity = (0.12 + random() * 0.22).toFixed(2);
    const fill = random() > 0.5 ? primary : secondary;
    return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" fill-opacity="${opacity}"/>`;
  }).join("");

  const shards = Array.from({ length: 3 }, () => {
    const x = Math.round(random() * width);
    const y = Math.round(random() * height);
    const w = Math.round(120 + random() * 360);
    const h = Math.round(40 + random() * 120);
    const rotation = Math.round(random() * 90 - 45);
    const fill = random() > 0.5 ? "#ffffff" : secondary;
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="18" fill="${fill}" fill-opacity="0.14" transform="rotate(${rotation} ${x} ${y})"/>`;
  }).join("");

  const dots = Array.from({ length: 26 }, () => {
    const cx = Math.round(random() * width);
    const cy = Math.round(random() * height);
    const r = (1 + random() * 3).toFixed(1);
    return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#ffffff" fill-opacity="0.22"/>`;
  }).join("");

  const angle = Math.round(random() * 90);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="bg" gradientTransform="rotate(${angle} 0.5 0.5)">
      <stop offset="0%" stop-color="${deep}"/>
      <stop offset="55%" stop-color="${primary}"/>
      <stop offset="100%" stop-color="${secondary}"/>
    </linearGradient>
    <radialGradient id="vignette" cx="50%" cy="45%" r="75%">
      <stop offset="60%" stop-color="#000000" stop-opacity="0"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0.45"/>
    </radialGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#bg)"/>
  ${blobs}
  ${shards}
  ${dots}
  <rect width="${width}" height="${height}" fill="url(#vignette)"/>
</svg>`;
}

/** A circular-safe avatar tile: gradient plus the member's initials. */
export function avatarSvg(index: number, initials: string, size = 320): string {
  const [primary, secondary, deep] = PALETTES[(index * 3) % PALETTES.length];
  const random = pseudoRandom(index * 11 + 5);
  const glowX = Math.round(random() * size);
  const glowY = Math.round(random() * size);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${primary}"/>
      <stop offset="100%" stop-color="${deep}"/>
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="${secondary}" stop-opacity="0.85"/>
      <stop offset="100%" stop-color="${secondary}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${size}" height="${size}" fill="url(#bg)"/>
  <circle cx="${glowX}" cy="${glowY}" r="${Math.round(size * 0.55)}" fill="url(#glow)"/>
  <text x="50%" y="50%" text-anchor="middle" dominant-baseline="central"
        font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="${Math.round(size * 0.42)}"
        font-weight="700" fill="#ffffff" fill-opacity="0.92">${escapeXml(initials)}</text>
</svg>`;
}

function svgBytes(svg: string): Uint8Array {
  return new TextEncoder().encode(svg);
}

async function assetExists(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(10_000) });
    return response.ok;
  } catch {
    return false;
  }
}

/** Uploads only when the object is missing, so re-seeding stays cheap. */
async function ensureAsset(key: string, produce: () => Promise<Uint8Array | ArrayBuffer>, contentType: string): Promise<string> {
  const url = getPublicUrl(key);
  if (await assetExists(url)) return url;

  const body = await produce();
  await putObject(key, body instanceof ArrayBuffer ? new Uint8Array(body) : body, contentType);
  return url;
}

export function assertDemoMediaConfigured(): void {
  assertStorageConfigured();
}

/** Seeds an avatar for a demo member and returns its public URL. */
export async function ensureDemoAvatar(index: number, initials: string): Promise<string> {
  const key = `seed/avatars/${initials.toLowerCase().replace(/[^a-z0-9]/g, "")}-${index}.png`;
  return ensureAsset(
    key,
    async () => sharp(svgBytes(avatarSvg(index, initials))).png({ compressionLevel: 9 }).toBuffer(),
    "image/png",
  );
}

/** Seeds the artwork for a demo image post and returns its public URL. */
export async function ensureDemoPostImage(index: number): Promise<string> {
  const key = `seed/posts/artwork-${String(index).padStart(2, "0")}.jpg`;
  return ensureAsset(
    key,
    async () => sharp(svgBytes(postArtworkSvg(index))).jpeg({ quality: JPEG_QUALITY, progressive: true, mozjpeg: true }).toBuffer(),
    "image/jpeg",
  );
}

/** Sample clips mirrored into R2 (CC-BY 3.0, Blender Foundation). */
const SAMPLE_VIDEOS = [
  "https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/360/Big_Buck_Bunny_360_10s_1MB.mp4",
  "https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/360/Big_Buck_Bunny_360_10s_2MB.mp4",
];

/**
 * Seeds a demo video and returns its public URL, or null when the sample clip
 * cannot be fetched (a seed run without internet still succeeds, it just has
 * fewer videos).
 */
export async function ensureDemoVideo(clipIndex: number): Promise<string | null> {
  const key = `seed/videos/sample-clip-${clipIndex + 1}.mp4`;
  const url = getPublicUrl(key);
  if (await assetExists(url)) return url;

  const candidates = [SAMPLE_VIDEOS[clipIndex % SAMPLE_VIDEOS.length], ...SAMPLE_VIDEOS];
  for (const source of candidates) {
    try {
      const response = await fetch(source, { signal: AbortSignal.timeout(30_000) });
      if (!response.ok) continue;
      const body = new Uint8Array(await response.arrayBuffer());
      if (body.byteLength === 0) continue;
      await putObject(key, body, "video/mp4");
      return url;
    } catch {
      // Try the next mirror; the caller falls back to a text post.
    }
  }

  return null;
}
