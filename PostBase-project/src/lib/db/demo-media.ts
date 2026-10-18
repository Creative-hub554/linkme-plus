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

/**
 * A catalogue-style product shot: a lit surface with the object standing on it.
 *
 * Square, because the card crops its photo into a square tile and a wide
 * composition would be cut down to its middle. Deliberately not the post
 * artwork: a shop grid and a feed are different surfaces, and a wall of
 * posters in the marketplace reads as a feed that lost its way.
 */
export function listingPhotoSvg(index: number, size = 1200): string {
  const [primary, secondary, deep] = PALETTES[(index * 5 + 1) % PALETTES.length];
  const random = pseudoRandom(index * 13 + 9);

  const horizon = Math.round(size * (0.56 + random() * 0.12));
  const angle = Math.round(random() * 24 - 12);
  const objectWidth = Math.round(size * (0.4 + random() * 0.22));
  const objectHeight = Math.round(objectWidth * (0.52 + random() * 0.4));
  const objectX = Math.round((size - objectWidth) / 2);
  const objectY = Math.round(horizon - objectHeight * 0.86);
  const objectBand = Math.round(objectY + objectHeight * 0.62);
  const poolY = Math.round(horizon + size * (0.06 + random() * 0.06));

  const motes = Array.from({ length: 18 }, () => {
    const cx = Math.round(random() * size);
    const cy = Math.round(random() * size);
    const r = (1 + random() * 2.6).toFixed(1);
    return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#ffffff" fill-opacity="0.16"/>`;
  }).join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="wall" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${deep}"/>
      <stop offset="100%" stop-color="${primary}" stop-opacity="0.55"/>
    </linearGradient>
    <linearGradient id="surface" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${primary}" stop-opacity="0.5"/>
      <stop offset="100%" stop-color="${deep}" stop-opacity="0.9"/>
    </linearGradient>
    <linearGradient id="object" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.92"/>
      <stop offset="60%" stop-color="${secondary}" stop-opacity="0.75"/>
      <stop offset="100%" stop-color="${primary}" stop-opacity="0.85"/>
    </linearGradient>
    <radialGradient id="pool" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.3"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${size}" height="${size}" fill="url(#wall)"/>
  <rect y="${horizon}" width="${size}" height="${size - horizon}" fill="url(#surface)"/>
  ${motes}
  <ellipse cx="${Math.round(size / 2)}" cy="${poolY}" rx="${Math.round(objectWidth * 0.65)}" ry="${Math.round(objectWidth * 0.16)}" fill="url(#pool)"/>
  <g transform="rotate(${angle} ${Math.round(size / 2)} ${objectBand})">
    <rect x="${objectX}" y="${objectY}" width="${objectWidth}" height="${objectHeight}" rx="${Math.round(objectWidth * 0.08)}" fill="url(#object)"/>
    <rect x="${objectX}" y="${objectBand}" width="${objectWidth}" height="${Math.round(objectHeight * 0.08)}" fill="${deep}" fill-opacity="0.25"/>
  </g>
</svg>`;
}

/**
 * A wide banner for a Page's header.
 *
 * The Page detail crops its cover into a short band, so this one is wide and
 * shallow rather than square — the opposite of the listing photo, for the same
 * reason: a composition is drawn for the box that will hold it.
 */
export function pageCoverSvg(index: number, width = 1600, height = 400): string {
  const [primary, secondary, deep] = PALETTES[(index * 7 + 4) % PALETTES.length];
  const random = pseudoRandom(index * 17 + 11);

  const arcs = Array.from({ length: 4 }, (_unused, step) => {
    const cx = Math.round(width * (0.1 + random() * 0.8));
    const cy = Math.round(height * (0.7 + random() * 0.5));
    const r = Math.round(width * (0.14 + random() * 0.26));
    const opacity = (0.1 + step * 0.05).toFixed(2);
    return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${step % 2 === 0 ? secondary : "#ffffff"}" fill-opacity="${opacity}"/>`;
  }).join("");

  const bars = Array.from({ length: 3 }, () => {
    const x = Math.round(random() * width);
    const barWidth = Math.round(width * (0.06 + random() * 0.14));
    return `<rect x="${x}" y="0" width="${barWidth}" height="${height}" fill="#ffffff" fill-opacity="0.05"/>`;
  }).join("");

  const angle = Math.round(random() * 40 - 20);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="band" gradientTransform="rotate(${angle} 0.5 0.5)">
      <stop offset="0%" stop-color="${deep}"/>
      <stop offset="50%" stop-color="${primary}"/>
      <stop offset="100%" stop-color="${secondary}"/>
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="30%" r="70%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.22"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#band)"/>
  ${bars}
  ${arcs}
  <rect width="${width}" height="${height}" fill="url(#glow)"/>
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

/** Seeds the cover banner for a demo Page and returns its public URL. */
export async function ensureDemoPageCover(index: number): Promise<string> {
  const key = `seed/pages/cover-${String(index).padStart(2, "0")}.jpg`;
  return ensureAsset(
    key,
    async () => sharp(svgBytes(pageCoverSvg(index))).jpeg({ quality: JPEG_QUALITY, progressive: true, mozjpeg: true }).toBuffer(),
    "image/jpeg",
  );
}

/** Seeds the photo for a demo marketplace listing and returns its public URL. */
export async function ensureDemoListingImage(index: number): Promise<string> {
  const key = `seed/listings/listing-${String(index).padStart(2, "0")}.jpg`;
  return ensureAsset(
    key,
    async () => sharp(svgBytes(listingPhotoSvg(index))).jpeg({ quality: JPEG_QUALITY, progressive: true, mozjpeg: true }).toBuffer(),
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
