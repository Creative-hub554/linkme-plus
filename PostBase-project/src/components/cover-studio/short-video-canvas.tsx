"use client";

import { useEffect, useRef } from "react";
import type { ShortVideoTemplate } from "@/components/cover-studio/short-video-templates";

/**
 * The profile banner's shape. The published cover video is rendered at this
 * size so it plays in the existing banner without being cropped, and the studio
 * exports it so the page can send the same default profile-frame radius.
 */
export const COVER_CANVAS_WIDTH = 1200;
export const COVER_CANVAS_HEIGHT = 444;

/**
 * One shared empty list, used as the default for `backgroundPhotos`. A literal
 * `[]` default is a new array on every render, and the render effect restarts
 * whenever its inputs change identity — so the default has to be stable.
 */
const NO_BACKGROUND_PHOTOS: string[] = [];

interface ShortVideoCanvasProps {
  template: ShortVideoTemplate;
  /** profile photo for the round center */
  profilePhoto?: string | null;
  /** uploaded background video (if backgroundMode === video) */
  backgroundVideo?: string | null;
  /** uploaded background photo (if backgroundMode === photo) */
  backgroundPhoto?: string | null;
  /** background color override (if backgroundMode === color) */
  backgroundColor?: string;
  /** subtitle text */
  subtitle?: string;
  /** product link display text (e.g. "Shop now →") */
  productLabel?: string;
  /** product URL (for metadata only; not rendered as clickable in canvas) */
  productUrl?: string;
  /** playback speed */
  speed?: "slow" | "normal" | "fast";
  /** loop duration in seconds */
  duration?: number;
  /** playing state */
  isPlaying?: boolean;
  /** canvas ready callback for MediaRecorder capture */
  onCanvasReady?: (canvas: HTMLCanvasElement) => void;
  /** className */
  className?: string;
  /** horizontal offset of profile frame from center ( 캔버스 px; negative = left ) */
  profileOffsetX?: number;
  /** vertical offset of profile frame from default position ( 캔버스 px; negative = up ) */
  profileOffsetY?: number;
  /** profile frame radius in canvas px (min 40, max 240) */
  profileRadius?: number;
  /** callback fired when profile frame is dragged/resized */
  onProfileChange?: (offsetX: number, offsetY: number, radius: number) => void;
  /** uploaded pictures; two or more render as an animated background wall */
  backgroundPhotos?: string[];
  /** canvas shape: the studio's vertical frame or the landscape profile banner */
  aspectRatio?: "9:16" | "cover";
  /** forces continuous drawing while a video is being recorded */
  recording?: boolean;
}

const FONT_SIZES = {
  profileName: 36,
  subtitle: 22,
  productChip: 16,
  marquee: 28,
} as const;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      // apply EXIF orientation (mobile photos often come rotated)
      const orientation = getExifOrientation(src);
      if (orientation > 1 && img.naturalWidth > 0) {
        const canvas = document.createElement("canvas");
        const w = img.naturalWidth;
        const h = img.naturalHeight;
        let dx = 0, dh = w, dw = h, rot = 0;
        const dy = 0;
        switch (orientation) {
          case 2: dw = -w; break;            // flip H
          case 3: rot = Math.PI; break;      // 180°
          case 4: dh = -h; break;            // flip V
          case 5: dx = w; rot = Math.PI / 2; break; // 90° + flip H
          case 6: rot = Math.PI / 2; break;  // 90°
          case 7: dx = w; dh = -h; rot = -Math.PI / 2; break; // 270° + flip H
          case 8: rot = -Math.PI / 2; break; // 270°
        }
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d")!;
        ctx.translate(dx || 0, dy || 0);
        if (rot) ctx.rotate(rot);
        ctx.scale(dw < 0 ? -1 : 1, dh < 0 ? -1 : 1);
        ctx.drawImage(img, 0, 0);
        img.src = canvas.toDataURL("image/png");
        img.onload = () => resolve(img);
      } else {
        resolve(img);
      }
    };
    img.onerror = () => resolve(img);
    img.src = src;
  });
}

function getExifOrientation(dataUrl: string): number {
  if (!dataUrl.startsWith("data:image/jpeg")) return 1;
  try {
    const base64 = dataUrl.split(",")[1];
    if (!base64) return 1;
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const offset = bytes.indexOf(0xFF, 0);
    if (offset < 0) return 1;
    if (bytes[offset + 1] !== 0xE1) return 1;
    const exifStart = offset + 4;
    const littleEndian = bytes[exifStart] === 0x49 && bytes[exifStart + 1] === 0x49;
    const readU16 = (p: number) =>
      littleEndian ? bytes[p] | (bytes[p + 1] << 8) : (bytes[p] << 8) | bytes[p + 1];
    const tiffEnd = exifStart + 2 + readU16(exifStart + 2) * 12;
    if (tiffEnd > bytes.length) return 1;
    const ifd0 = readU16(exifStart + 2);
    const ifd0Off = exifStart + 2 + 2 + ifd0 * 12;
    if (ifd0Off + 12 > bytes.length) return 1;
    const count = readU16(ifd0Off);
    for (let i = 0; i < count; i++) {
      const entryOff = ifd0Off + 2 + i * 12;
      if (entryOff + 12 > bytes.length) continue;
      const tag = readU16(entryOff);
      if (tag === 0x0112) {
        const valOff = readU16(entryOff + 8);
        return valOff < 4 ? bytes[ifd0Off + 2 + valOff] : readU16(ifd0Off + 2 + valOff);
      }
    }
    return 1;
  } catch {
    return 1;
  }
}

function loadVideo(src: string | null): Promise<HTMLVideoElement | null> {
  return new Promise((resolve) => {
    if (!src) return resolve(null);
    const vid = document.createElement("video");
    vid.muted = true;
    vid.loop = true;
    vid.playsInline = true;
    vid.onloadeddata = () => resolve(vid);
    vid.onerror = () => resolve(null);
    vid.src = src;
    vid.load();
  });
}

/**
 * Fills a box with an image without distorting it, cropping the overflow — the
 * same cover-fit the round profile frame uses, shared here by the wall cards.
 */
function drawImageCoverFit(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const scale = Math.max(width / image.width, height / image.height);
  const drawW = image.width * scale;
  const drawH = image.height * scale;
  ctx.drawImage(image, x + (width - drawW) / 2, y + (height - drawH) / 2, drawW, drawH);
}

export interface PhotoWallCard {
  x: number;
  y: number;
  width: number;
  height: number;
  imageIndex: number;
  /** which row the card sits in; rows drift in alternating directions */
  row: number;
  /**
   * The card's absolute position in its row's strip. It is what stays constant
   * as the wall moves, so it is how the same card can be followed over time.
   */
  slot: number;
}

/**
 * Layout for the animated picture wall — the moving backdrop built from the
 * pictures a member uploads.
 *
 * Pure on purpose. Every other part of this canvas needs a real 2D context, but
 * the wall is geometry, and geometry is the part a test can actually check (the
 * suite has no canvas). Cards sit in horizontal rows that drift in alternating
 * directions; wrapping is expressed as absolute card positions rather than a
 * modulo of a short strip, so the pictures never jump when a row loops.
 */
export function photoWallLayout({
  width,
  height,
  photoCount,
  elapsedMs,
  speedFactor,
  rows,
}: {
  width: number;
  height: number;
  photoCount: number;
  elapsedMs: number;
  speedFactor: number;
  rows?: number;
}): PhotoWallCard[] {
  const count = Math.max(1, Math.floor(photoCount));
  const rowCount = Math.max(1, Math.min(4, rows ?? (height < 700 ? 3 : 4)));
  const gap = Math.round(height / rowCount / 12) + 6;
  const rowHeight = height / rowCount;
  const cardHeight = Math.max(24, rowHeight - gap);
  const cardWidth = Math.round(cardHeight * 1.4);
  const step = cardWidth + gap;
  const speed = Math.max(0.25, speedFactor);
  // A card crosses the frame in roughly three seconds at normal speed. Scaling
  // by the step is what keeps that true for any canvas size or picture count.
  const distance = (elapsedMs / 1000) * step * 0.35 * speed;

  const cards: PhotoWallCard[] = [];
  for (let row = 0; row < rowCount; row += 1) {
    const y = row * rowHeight + (rowHeight - cardHeight) / 2;
    const direction = row % 2 === 0 ? -1 : 1;
    const base = direction * distance;
    const start = Math.floor((-base - cardWidth) / step) - 1;
    const end = Math.ceil((width - base) / step) + 1;
    for (let index = start; index <= end; index += 1) {
      const x = index * step + base;
      if (x > width + cardWidth || x + cardWidth < 0) continue;
      cards.push({
        x,
        y,
        width: cardWidth,
        height: cardHeight,
        imageIndex: ((index % count) + count) % count,
        row,
        slot: index,
      });
    }
  }
  return cards;
}

function drawRoundFrame(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  photo: HTMLImageElement | null,
  glowColor: string,
  ringColor: string,
) {
  // outer glow
  ctx.save();
  ctx.shadowColor = glowColor;
  ctx.shadowBlur = 30;
  ctx.fillStyle = "rgba(77,112,255,0.35)";
  ctx.beginPath();
  ctx.arc(cx, cy, radius + 12, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // ring
  ctx.save();
  ctx.strokeStyle = ringColor;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(cx, cy, radius + 4, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  // photo clip
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.25)";
  ctx.shadowBlur = 10;
  ctx.fillStyle = "#0a0f1a";
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  if (photo && photo.naturalWidth > 0) {
    ctx.save();
    // cover-fit: scale to fill the circle, cropping excess
    const imgAspect = photo.width / photo.height;
    const frameAspect = 1; // circle is square
    let drawW: number, drawH: number;
    if (imgAspect > frameAspect) {
      drawW = radius * 2;
      drawH = drawW / imgAspect;
    } else {
      drawH = radius * 2;
      drawW = drawH * imgAspect;
    }
    const dx = cx - drawW / 2;
    const dy = cy - drawH / 2;
    ctx.beginPath();
    ctx.arc(cx, cy, radius - 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(photo, dx, dy, drawW, drawH);
    ctx.restore();
  } else {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius - 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = "#1a2236";
    ctx.fill();
    ctx.restore();
  }

  // inner ring highlight
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.15)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(cx, cy, radius - 2, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

export function ShortVideoCanvas({
  template,
  profilePhoto,
  backgroundVideo,
  backgroundPhoto,
  backgroundColor,
  subtitle,
  productLabel,
  speed = "slow",
  duration = 8,
  isPlaying = true,
  onCanvasReady,
  className,
  profileOffsetX = 0,
  profileOffsetY = 0,
  profileRadius,
  onProfileChange,
  backgroundPhotos = NO_BACKGROUND_PHOTOS,
  aspectRatio = "9:16",
  recording = false,
}: ShortVideoCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // The cover video has to fit the profile's landscape banner, so the same
  // canvas renders either the tall studio frame or the banner shape. The round
  // profile frame sits on the centre line in the banner and above centre in the
  // tall frame, which is what `centerFactor` carries.
  const isCover = aspectRatio === "cover";
  const W = isCover ? COVER_CANVAS_WIDTH : 1080;
  const H = isCover ? COVER_CANVAS_HEIGHT : 1920;
  const centerFactor = isCover ? 0.5 : 0.38;
  const defaultRadius = isCover
    ? Math.min(H * 0.24, W * 0.1)
    : Math.min(180, W * 0.17);
  const frameRef = useRef<number | null>(null);
  const pausedRef = useRef(false);
  const assetsRef = useRef<{
    bgVideo: HTMLVideoElement | null;
    bgPhoto: HTMLImageElement | null;
    profile: HTMLImageElement | null;
    photos: HTMLImageElement[];
  }>({ bgVideo: null, bgPhoto: null, profile: null, photos: [] });
  const offsetX = useRef(profileOffsetX);
  const offsetY = useRef(profileOffsetY);
  const radius = useRef(profileRadius ?? defaultRadius);
  const draggingRef = useRef<"move" | "resize" | null>(null);
  const dragStartRef = useRef<{ x: number; y: number; ox: number; oy: number; or: number } | null>(null);

  useEffect(() => {
    offsetX.current = profileOffsetX;
  }, [profileOffsetX]);
  useEffect(() => {
    offsetY.current = profileOffsetY;
  }, [profileOffsetY]);
  useEffect(() => {
    radius.current = profileRadius ?? defaultRadius;
  }, [profileRadius, defaultRadius]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    onCanvasReady?.(canvas);

    let cancelled = false;
    let visible = true;
    let reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    canvas.width = W;
    canvas.height = H;

    let startedAt = performance.now();

    const loadAssets = async () => {
      const [video, photo, profile, photos] = await Promise.all([
        backgroundVideo ? loadVideo(backgroundVideo) : Promise.resolve(null),
        loadImage(backgroundPhoto ?? ""),
        loadImage(profilePhoto ?? ""),
        Promise.all(backgroundPhotos.map((src) => loadImage(src))),
      ]);
      if (cancelled) return;
      assetsRef.current = { bgVideo: video, bgPhoto: photo, profile, photos };
    };
    void loadAssets();

    const speedFactor = speed === "slow" ? 0.6 : speed === "fast" ? 1.4 : 1;
    const loopMs = Math.max(5000, Math.min(10000, duration * 1000));

    // pre-create a 2D noise texture for grain overlay
    const noiseCanvas = document.createElement("canvas");
    noiseCanvas.width = 256;
    noiseCanvas.height = 256;
    const nctx = noiseCanvas.getContext("2d");
    if (nctx) {
      const imgData = nctx.createImageData(256, 256);
      for (let i = 0; i < imgData.data.length; i += 4) {
        const v = Math.random() * 255;
        imgData.data[i] = v;
        imgData.data[i + 1] = v;
        imgData.data[i + 2] = v;
        imgData.data[i + 3] = 255;
      }
      nctx.putImageData(imgData, 0, 0);
    }
    const noisePattern = nctx ? ctx.createPattern(noiseCanvas, "repeat") : null;

    const draw = (now: number) => {
      // While recording, the wall has to keep drawing for the whole clip: the
      // recorder captures the live canvas, so a paused or off-screen frame would
      // be recorded as a still.
      if (cancelled) return;
      if (!recording && (pausedRef.current || !visible)) return;
      const elapsed = now - startedAt;
      const progress = (elapsed % loopMs) / loopMs;
      const t = progress * 2 * Math.PI;

      ctx.clearRect(0, 0, W, H);

      const cx = W / 2 + offsetX.current;
      const cy = H * centerFactor + offsetY.current;
      const palette = template.colors;
      const wallPhotos = assetsRef.current.photos;

      // ── background per template ──────────────────────────────────────
      if (wallPhotos.length >= 2) {
        // Two or more uploaded pictures become a slowly drifting wall of cards
        // instead of the template's own backdrop. The template still supplies
        // the palette and the speed, so every studio look recolours the wall.
        ctx.fillStyle = palette[0];
        ctx.fillRect(0, 0, W, H);

        for (const card of photoWallLayout({
          width: W,
          height: H,
          photoCount: wallPhotos.length,
          elapsedMs: elapsed,
          speedFactor,
        })) {
          const image = wallPhotos[card.imageIndex];
          ctx.save();
          ctx.beginPath();
          ctx.roundRect(card.x, card.y, card.width, card.height, 14);
          ctx.clip();
          if (image && image.naturalWidth > 0) {
            drawImageCoverFit(ctx, image, card.x, card.y, card.width, card.height);
          } else {
            ctx.fillStyle = palette[card.imageIndex % palette.length];
            ctx.fill();
          }
          ctx.restore();
        }

        // Template tint plus a scrim, so the ringed centre and any subtitle stay
        // legible over busy pictures.
        ctx.globalAlpha = 0.22;
        ctx.fillStyle = palette[1];
        ctx.fillRect(0, 0, W, H);
        ctx.globalAlpha = 0.34;
        ctx.fillStyle = "#020814";
        ctx.fillRect(0, 0, W, H);
        ctx.globalAlpha = 1;
      } else if (template.id === "marquee-wall") {
        // gradient background
        const g = ctx.createLinearGradient(0, 0, W, H);
        g.addColorStop(0, palette[0]);
        g.addColorStop(0.5, palette[1]);
        g.addColorStop(1, palette[2]);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);

        // scrolling marquee band
        const bandY = H * 0.72;
        const bandH = 120;
        const bandG = ctx.createLinearGradient(0, bandY, 0, bandY + bandH);
        bandG.addColorStop(0, "rgba(0,0,0,0.6)");
        bandG.addColorStop(0.5, "rgba(0,0,0,0.2)");
        bandG.addColorStop(1, "rgba(0,0,0,0.6)");
        ctx.fillStyle = bandG;
        ctx.fillRect(0, bandY, W, bandH);

        const scrollSpeed = 0.8 * speedFactor;
        const offset = ((elapsed * 0.05 * scrollSpeed) % (W * 2)) - W;
        ctx.globalAlpha = 0.7;
        for (let x = offset; x < W + 200; x += 300) {
          ctx.fillStyle = palette[(Math.floor(x / 300) % 3) + 1];
          ctx.beginPath();
          ctx.roundRect(x, bandY + 10, 220, bandH - 20, 12);
          ctx.fill();
        }
        ctx.globalAlpha = 1;

      } else if (template.id === "soft-gradient-focus") {
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, W * 0.7);
        g.addColorStop(0, palette[2]);
        g.addColorStop(0.4, palette[1]);
        g.addColorStop(1, palette[0]);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);

        // soft glow ring
        const glowR = 200 + Math.sin(t * 0.5) * 30;
        const grad = ctx.createRadialGradient(cx, cy, glowR - 60, cx, cy, glowR);
        grad.addColorStop(0, "rgba(255,255,255,0.12)");
        grad.addColorStop(1, "transparent");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, glowR, 0, Math.PI * 2);
        ctx.fill();

      } else if (template.id === "light-sweep") {
        ctx.fillStyle = palette[0];
        ctx.fillRect(0, 0, W, H);

        const barX = ((elapsed * 0.1 * speedFactor) % (W + 400)) - 200;
        const grad = ctx.createLinearGradient(barX, 0, barX + 300, 0);
        grad.addColorStop(0, "transparent");
        grad.addColorStop(0.4, palette[2]);
        grad.addColorStop(0.7, palette[2]);
        grad.addColorStop(1, "transparent");
        ctx.fillStyle = grad;
        ctx.globalAlpha = 0.5;
        ctx.fillRect(barX, 0, 300, H);
        ctx.globalAlpha = 1;

        // light point at center when bar passes
        const dist = Math.abs(barX + 150 - cx);
        if (dist < 300) {
          const intensity = 1 - dist / 300;
          const lg = ctx.createRadialGradient(cx, cy, 0, cx, cy, 200);
          lg.addColorStop(0, `rgba(255,255,255,${intensity * 0.3})`);
          lg.addColorStop(1, "transparent");
          ctx.fillStyle = lg;
          ctx.beginPath();
          ctx.arc(cx, cy, 200, 0, Math.PI * 2);
          ctx.fill();
        }

      } else if (template.id === "particle-dust") {
        ctx.fillStyle = palette[0];
        ctx.fillRect(0, 0, W, H);

        // particles
        const particleCount = 60;
        for (let i = 0; i < particleCount; i++) {
          const seed = (i * 137.5) % 1;
          const px = (Math.sin(t * 0.3 + seed * 6.28) * 0.5 + 0.5) * W;
          const py = (Math.cos(t * 0.2 + seed * 6.28) * 0.5 + 0.5) * H;
          const size = 3 + Math.sin(t + seed * 6.28) * 2;
          const alpha = 0.3 + Math.sin(t * 2 + seed * 6.28) * 0.2;
          ctx.globalAlpha = alpha;
          ctx.fillStyle = palette[(i % 3) + 1];
          ctx.beginPath();
          ctx.arc(px, py, size, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;

        // center glow
        const cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, 250);
        cg.addColorStop(0, "rgba(255,255,255,0.1)");
        cg.addColorStop(1, "transparent");
        ctx.fillStyle = cg;
        ctx.beginPath();
        ctx.arc(cx, cy, 250, 0, Math.PI * 2);
        ctx.fill();

      } else if (template.id === "photo-motion-bg") {
        // background video/photo with Ken Burns
        const bg = assetsRef.current.bgPhoto ?? null;
        if (bg && bg.naturalWidth > 0) {
          const scale = Math.max(W / bg.width, H / bg.height) * (1 + Math.sin(t * 0.2) * 0.05);
          const sx = (W - bg.width * scale) / 2 + Math.sin(t * 0.15) * 40;
          const sy = (H - bg.height * scale) / 2 + Math.cos(t * 0.12) * 30;
          ctx.globalAlpha = 0.55;
          ctx.drawImage(bg, sx, sy, bg.width * scale, bg.height * scale);
          ctx.globalAlpha = 1;
        } else {
          const g = ctx.createLinearGradient(0, 0, W, H);
          g.addColorStop(0, palette[0]);
          g.addColorStop(1, palette[2]);
          ctx.fillStyle = g;
          ctx.fillRect(0, 0, W, H);
        }

      } else if (template.id === "color-wash") {
        const idx = Math.floor(t / (Math.PI * 2) * 3) % 3;
        const nextIdx = (idx + 1) % 3;
        const mix = (t % (Math.PI * 2)) / (Math.PI * 2);
        const r = lerpColor(palette[idx], palette[nextIdx], mix);
        ctx.fillStyle = r;
        ctx.fillRect(0, 0, W, H);

        // pulsing ring
        const ringR = 180 + Math.sin(t * 2) * 20;
        ctx.strokeStyle = palette[(idx + 2) % 3];
        ctx.lineWidth = 6 + Math.sin(t * 2) * 2;
        ctx.globalAlpha = 0.6;
        ctx.beginPath();
        ctx.arc(cx, cy, ringR, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;

      } else if (template.id === "split-vignette") {
        const bg = assetsRef.current.bgPhoto ?? null;
        if (bg && bg.naturalWidth > 0) {
          ctx.drawImage(bg, 0, 0, W, H);
        } else {
          ctx.fillStyle = palette[0];
          ctx.fillRect(0, 0, W, H);
        }

        // vignette
        const vg = ctx.createRadialGradient(cx, cy, W * 0.2, cx, cy, W * 0.75);
        vg.addColorStop(0, "rgba(0,0,0,0)");
        vg.addColorStop(0.6, "rgba(0,0,0,0.1)");
        vg.addColorStop(1, "rgba(0,0,0,0.7)");
        ctx.fillStyle = vg;
        ctx.fillRect(0, 0, W, H);

        // split light beams
        ctx.globalAlpha = 0.2;
        ctx.fillStyle = palette[2];
        ctx.fillRect(0, cy - 200, W * 0.4, 400);
        ctx.fillRect(W * 0.6, cy - 200, W * 0.4, 400);
        ctx.globalAlpha = 1;

      } else if (template.id === "texture-overlay") {
        const g = ctx.createLinearGradient(0, 0, W, H);
        g.addColorStop(0, palette[0]);
        g.addColorStop(0.5, palette[1]);
        g.addColorStop(1, palette[2]);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);

        // grain overlay
        if (noisePattern) {
          ctx.globalAlpha = 0.08;
          ctx.fillStyle = noisePattern;
          ctx.fillRect(0, 0, W, H);
          ctx.globalAlpha = 1;
        }

        const bg = assetsRef.current.bgPhoto ?? null;
        if (bg && bg.naturalWidth > 0) {
          const sw = W * 0.6;
          const sh = H * 0.12;
          const sx = (W - sw) / 2;
          const sy = H * 0.5 - sh / 2 + Math.sin(t * 0.5) * 20;
          ctx.globalAlpha = 0.3 + Math.sin(t * 2) * 0.1;
          ctx.drawImage(bg, sx, sy, sw, sh);
        }
        ctx.globalAlpha = 1;

      } else if (template.id === "slow-zoom-ring-pulse") {
        const bg = assetsRef.current.bgPhoto ?? null;
        if (bg && bg.naturalWidth > 0) {
          const zoom = 1 + Math.sin(t * 0.15) * 0.15;
          const scale = Math.max(W / bg.width, H / bg.height) * zoom;
          const sx = (W - bg.width * scale) / 2;
          const sy = (H - bg.height * scale) / 2;
          ctx.globalAlpha = 0.5;
          ctx.drawImage(bg, sx, sy, bg.width * scale, bg.height * scale);
          ctx.globalAlpha = 1;
        } else {
          ctx.fillStyle = palette[0];
          ctx.fillRect(0, 0, W, H);
        }

        // pulsing ring
        const pr = 180 + Math.sin(t * 3) * 25;
        ctx.strokeStyle = palette[2];
        ctx.lineWidth = 4 + Math.sin(t * 3) * 2;
        ctx.globalAlpha = 0.7;
        ctx.beginPath();
        ctx.arc(cx, cy, pr, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;

      } else if (template.id === "minimal-clean") {
        ctx.fillStyle = palette[0];
        ctx.fillRect(0, 0, W, H);

        // subtle gradient overlay
        const mg = ctx.createRadialGradient(cx, cy, 0, cx, cy, W * 0.5);
        mg.addColorStop(0, "rgba(255,255,255,0.05)");
        mg.addColorStop(1, "transparent");
        ctx.fillStyle = mg;
        ctx.beginPath();
        ctx.arc(cx, cy, W * 0.5, 0, Math.PI * 2);
        ctx.fill();
      }

      // ── extended templates (20 additional) ─────────────────────────────
      else if (template.id === "neon-pulse") {
        ctx.fillStyle = palette[0];
        ctx.fillRect(0, 0, W, H);
        const pr = 180 + Math.sin(t * 3) * 25;
        ctx.strokeStyle = palette[2];
        ctx.lineWidth = 4 + Math.sin(t * 3) * 2;
        ctx.globalAlpha = 0.8;
        ctx.beginPath();
        ctx.arc(cx, cy, pr, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 0.25;
        const gs = Math.max(30, W * 0.05);
        ctx.strokeStyle = palette[2];
        ctx.lineWidth = 1;
        for (let x = -gs; x < W + gs; x += gs) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
        for (let y = -gs; y < H + gs; y += gs) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
        ctx.globalAlpha = 1;
      }

      else if (template.id === "aurora-borealis") {
        const g = ctx.createLinearGradient(0, 0, W, H);
        g.addColorStop(0, palette[0]);
        g.addColorStop(0.4, palette[1]);
        g.addColorStop(0.7, palette[2]);
        g.addColorStop(1, palette[0]);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
        ctx.globalAlpha = 0.3;
        for (let i = 0; i < 3; i++) {
          const ay = H * (0.2 + i * 0.2) + Math.sin(t * 0.2 + i * 2) * 40;
          const ag = ctx.createRadialGradient(W * 0.3, ay, 0, W * 0.3, ay, W * 0.5);
          ag.addColorStop(0, palette[(i + 2) % 3]);
          ag.addColorStop(1, "transparent");
          ctx.fillStyle = ag;
          ctx.beginPath();
          ctx.arc(W * 0.3, ay, W * 0.5, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }

      else if (template.id === "film-strip") {
        ctx.fillStyle = palette[0];
        ctx.fillRect(0, 0, W, H);
        const stripW = 18;
        const gap = 8;
        ctx.fillStyle = palette[2];
        for (let x = 0; x < W; x += stripW + gap) {
          ctx.fillRect(x, 0, stripW, H);
        }
        for (let y = 0; y < H; y += stripW + gap) {
          ctx.fillRect(0, y, W, stripW);
        }
        ctx.globalAlpha = 0.3;
        ctx.fillStyle = palette[1];
        ctx.fillRect(0, 0, W, 40);
        ctx.fillRect(0, H - 40, W, 40);
        ctx.globalAlpha = 1;
      }

      else if (template.id === "deep-space") {
        ctx.fillStyle = palette[0];
        ctx.fillRect(0, 0, W, H);
        for (let i = 0; i < 120; i++) {
          const seed = (i * 73.1) % 1;
          const sx = (Math.sin(t * 0.02 + seed * 6.28) * 0.5 + 0.5) * W;
          const sy = (Math.cos(t * 0.015 + seed * 6.28) * 0.5 + 0.5) * H;
          const size = 0.5 + Math.sin(t + seed * 6.28) * 0.5;
          ctx.globalAlpha = 0.2 + size * 0.4;
          ctx.fillStyle = i % 3 === 0 ? palette[2] : "#ffffff";
          ctx.beginPath();
          ctx.arc(sx, sy, Math.max(0.5, size), 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
        const cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, 200);
        cg.addColorStop(0, "rgba(255,255,255,0.12)");
        cg.addColorStop(1, "transparent");
        ctx.fillStyle = cg;
        ctx.beginPath();
        ctx.arc(cx, cy, 200, 0, Math.PI * 2);
        ctx.fill();
      }

      else if (template.id === "water-ripple") {
        const g = ctx.createLinearGradient(0, 0, W, H);
        g.addColorStop(0, palette[0]);
        g.addColorStop(1, palette[2]);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
        for (let ring = 0; ring < 5; ring++) {
          const r = 120 + ring * 40 + Math.sin(t * 2 + ring) * 10;
          ctx.strokeStyle = palette[(ring + 2) % 3];
          ctx.lineWidth = 2;
          ctx.globalAlpha = 0.5 - ring * 0.08;
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }

      else if (template.id === "golden-hour") {
        const g = ctx.createLinearGradient(0, 0, W, H);
        g.addColorStop(0, palette[0]);
        g.addColorStop(0.35, palette[1]);
        g.addColorStop(0.7, palette[2]);
        g.addColorStop(1, palette[2]);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
        const flareX = W * 0.8;
        const flareY = H * 0.15;
        const fg = ctx.createRadialGradient(flareX, flareY, 0, flareX, flareY, W * 0.6);
        fg.addColorStop(0, "rgba(255,200,100,0.25)");
        fg.addColorStop(0.4, "rgba(255,180,80,0.08)");
        fg.addColorStop(1, "transparent");
        ctx.fillStyle = fg;
        ctx.beginPath();
        ctx.arc(flareX, flareY, W * 0.6, 0, Math.PI * 2);
        ctx.fill();
      }

      else if (template.id === "urban-night") {
        ctx.fillStyle = palette[0];
        ctx.fillRect(0, 0, W, H);
        ctx.globalAlpha = 0.4;
        ctx.fillStyle = palette[1];
        for (let i = 0; i < 20; i++) {
          const bx = (i * 65 + Math.sin(t * 0.1 + i) * 10) % W;
          const bh = 50 + Math.sin(i * 1.3) * 40;
          ctx.fillRect(bx, H - bh, 30, bh);
        }
        ctx.globalAlpha = 1;
        const sa = ctx.createRadialGradient(cx, cy, 0, cx, cy, 250);
        sa.addColorStop(0, palette[2]);
        sa.addColorStop(1, "transparent");
        ctx.fillStyle = sa;
        ctx.globalAlpha = 0.2;
        ctx.beginPath();
        ctx.arc(cx, cy, 250, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      else if (template.id === "geometry-overlay") {
        const g = ctx.createLinearGradient(0, 0, W, H);
        g.addColorStop(0, palette[0]);
        g.addColorStop(1, palette[2]);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
        ctx.globalAlpha = 0.2;
        for (let i = 0; i < 8; i++) {
          const gx = (W * 0.1) + (i * W * 0.1) + Math.sin(t + i * 0.8) * 30;
          const gy = (H * 0.2) + (i * H * 0.08) + Math.cos(t * 0.7 + i) * 20;
          const gs = 40 + Math.sin(t * 0.5 + i * 0.5) * 15;
          ctx.fillStyle = palette[i % 3];
          ctx.beginPath();
          ctx.moveTo(gx, gy);
          ctx.lineTo(gx + gs, gy);
          ctx.lineTo(gx + gs * 0.6, gy + gs * 0.7);
          ctx.closePath();
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }

      else if (template.id === "double-exposure") {
        const bg = assetsRef.current.bgPhoto ?? null;
        const g = ctx.createLinearGradient(0, 0, W, H);
        g.addColorStop(0, palette[0]);
        g.addColorStop(1, palette[2]);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
        if (bg && bg.naturalWidth > 0) {
          ctx.globalAlpha = 0.35;
          const sw = W * 0.8;
          const sh = H * 0.6;
          const sx = (W - sw) / 2;
          const sy = (H - sh) / 2;
          ctx.drawImage(bg, sx, sy, sw, sh);
          ctx.globalAlpha = 0.5;
          ctx.fillStyle = palette[1];
          ctx.globalCompositeOperation = "overlay";
          ctx.beginPath();
          ctx.arc(cx, cy, 150, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalCompositeOperation = "source-over";
          ctx.globalAlpha = 1;
        }
      }

      else if (template.id === "light-leak") {
        const g = ctx.createLinearGradient(0, 0, W, H);
        g.addColorStop(0, palette[0]);
        g.addColorStop(1, palette[2]);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
        const lx = ((elapsed * 0.08) % (W + 300)) - 150;
        const lg = ctx.createLinearGradient(lx, 0, lx + 200, 0);
        lg.addColorStop(0, "transparent");
        lg.addColorStop(0.4, palette[2]);
        lg.addColorStop(1, "transparent");
        ctx.globalAlpha = 0.4;
        ctx.fillStyle = lg;
        ctx.fillRect(lx, 0, 200, H);
        const lx2 = W - ((elapsed * 0.06) % (W + 300)) - 150;
        const lg2 = ctx.createLinearGradient(lx2, 0, lx2 + 200, 0);
        lg2.addColorStop(0, "transparent");
        lg2.addColorStop(0.4, palette[1]);
        lg2.addColorStop(1, "transparent");
        ctx.fillStyle = lg2;
        ctx.fillRect(lx2, 0, 200, H);
        ctx.globalAlpha = 1;
      }

      else if (template.id === "paper-texture") {
        const g = ctx.createLinearGradient(0, 0, W, H);
        g.addColorStop(0, palette[0]);
        g.addColorStop(0.5, palette[1]);
        g.addColorStop(1, palette[2]);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
        ctx.globalAlpha = 0.1;
        for (let i = 0; i < 200; i++) {
          const px = Math.random() * W;
          const py = Math.random() * H;
          const pv = Math.random() * 255;
          ctx.fillStyle = `rgba(${pv},${pv},${pv},0.3)`;
          ctx.fillRect(px, py, 2, 2);
        }
        ctx.globalAlpha = 1;
        const shd = ctx.createLinearGradient(0, 0, 0, H);
        shd.addColorStop(0, "rgba(0,0,0,0.15)");
        shd.addColorStop(0.3, "transparent");
        shd.addColorStop(0.7, "transparent");
        shd.addColorStop(1, "rgba(0,0,0,0.15)");
        ctx.fillStyle = shd;
        ctx.fillRect(0, 0, W, H);
      }

      else if (template.id === "chrome-reflection") {
        const cg = ctx.createLinearGradient(0, 0, W, H);
        cg.addColorStop(0, "#a8a8a8");
        cg.addColorStop(0.25, "#ffffff");
        cg.addColorStop(0.5, "#4a4a4a");
        cg.addColorStop(0.75, "#d4d4d4");
        cg.addColorStop(1, "#2a2a2a");
        ctx.fillStyle = cg;
        ctx.fillRect(0, 0, W, H);
        ctx.globalAlpha = 0.3;
        const rg = ctx.createLinearGradient(0, 0, 0, H);
        rg.addColorStop(0, "rgba(255,255,255,0.5)");
        rg.addColorStop(0.4, "transparent");
        rg.addColorStop(0.6, "transparent");
        rg.addColorStop(1, "rgba(0,0,0,0.3)");
        ctx.fillStyle = rg;
        ctx.fillRect(0, 0, W, H);
        ctx.globalAlpha = 1;
      }

      else if (template.id === "forest-mist") {
        const g = ctx.createLinearGradient(0, 0, W, H);
        g.addColorStop(0, palette[0]);
        g.addColorStop(0.5, palette[1]);
        g.addColorStop(1, "#0a1a0f");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
        ctx.globalAlpha = 0.15;
        for (let i = 0; i < 40; i++) {
          const my = H * (0.3 + i * 0.015) + Math.sin(t * 0.1 + i * 0.2) * 20;
          const mw = 200 + Math.sin(t * 0.05 + i) * 50;
          const mg2 = ctx.createRadialGradient(W * 0.5, my, 0, W * 0.5, my, mw);
          mg2.addColorStop(0, "rgba(150,200,150,0.3)");
          mg2.addColorStop(1, "transparent");
          ctx.fillStyle = mg2;
          ctx.beginPath();
          ctx.arc(W * 0.5, my, mw, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }

      else if (template.id === "ocean-waves") {
        const g = ctx.createLinearGradient(0, 0, W, H);
        g.addColorStop(0, palette[0]);
        g.addColorStop(1, palette[2]);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
        ctx.globalAlpha = 0.3;
        for (let w = 0; w < 5; w++) {
          ctx.strokeStyle = palette[(w + 2) % 3];
          ctx.lineWidth = 2;
          ctx.beginPath();
          for (let x = 0; x <= W; x += 5) {
            const wy = H * 0.3 + w * 60 + Math.sin(x * 0.02 + t * 1.5 + w) * 20;
            if (x === 0) ctx.moveTo(x, wy);
            else ctx.lineTo(x, wy);
          }
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }

      else if (template.id === "sunset-dust") {
        const g = ctx.createLinearGradient(0, 0, W, H);
        g.addColorStop(0, palette[0]);
        g.addColorStop(0.4, palette[1]);
        g.addColorStop(0.7, palette[2]);
        g.addColorStop(1, "#f59e0b");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
        for (let i = 0; i < 50; i++) {
          const seed = (i * 97.3) % 1;
          const dx = (Math.sin(t * 0.1 + seed * 6.28) * 0.5 + 0.5) * W;
          const dy = (Math.cos(t * 0.08 + seed * 6.28) * 0.5 + 0.5) * H;
          const ds = 2 + Math.sin(t + seed * 6.28) * 1.5;
          ctx.globalAlpha = 0.3 + Math.sin(t * 2 + seed * 6.28) * 0.2;
          ctx.fillStyle = palette[(i % 3) + 1];
          ctx.beginPath();
          ctx.arc(dx, dy, Math.max(0.5, ds), 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }

      else if (template.id === "mirror-edge") {
        const g = ctx.createLinearGradient(0, 0, W, H);
        g.addColorStop(0, palette[0]);
        g.addColorStop(0.5, palette[1]);
        g.addColorStop(1, palette[2]);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
        ctx.globalAlpha = 0.25;
        const mw = W * 0.15;
        const mh = H * 0.15;
        const img = assetsRef.current.bgPhoto ?? null;
        if (img && img.naturalWidth > 0) {
          ctx.drawImage(img, W - mw - 10, 10, mw, mh);
          ctx.drawImage(img, 10, H - mh - 10, mw, mh);
          ctx.drawImage(img, 10, 10, mw, mh);
          ctx.drawImage(img, W - mw - 10, H - mh - 10, mw, mh);
        } else {
          ctx.fillStyle = palette[2];
          ctx.fillRect(W - mw - 10, 10, mw, mh);
          ctx.fillRect(10, H - mh - 10, mw, mh);
          ctx.fillRect(10, 10, mw, mh);
          ctx.fillRect(W - mw - 10, H - mh - 10, mw, mh);
        }
        ctx.globalAlpha = 1;
      }

      else if (template.id === "holographic") {
        const t2 = t * 0.1;
        const hg = ctx.createLinearGradient(0, 0, W, H);
        hg.addColorStop(0, palette[0]);
        hg.addColorStop(0.25, `hsl(${(t2 * 60) % 360}, 80%, 60%)`);
        hg.addColorStop(0.5, palette[1]);
        hg.addColorStop(0.75, `hsl(${(t2 * 60 + 180) % 360}, 80%, 60%)`);
        hg.addColorStop(1, palette[2]);
        ctx.fillStyle = hg;
        ctx.fillRect(0, 0, W, H);
        ctx.globalAlpha = 0.15;
        for (let i = 0; i < 15; i++) {
          const hx = (i * W / 15) + Math.sin(t + i * 0.5) * 20;
          ctx.strokeStyle = `hsl(${(t2 * 60 + i * 25) % 360}, 80%, 70%)`;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(hx, 0);
          ctx.lineTo(hx + 30, H);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }

      else if (template.id === "spotlight-studio") {
        ctx.fillStyle = palette[0];
        ctx.fillRect(0, 0, W, H);
        const sg = ctx.createRadialGradient(cx, cy, 0, cx, cy, W * 0.6);
        sg.addColorStop(0, "rgba(255,255,240,0.15)");
        sg.addColorStop(0.4, "rgba(255,255,200,0.05)");
        sg.addColorStop(1, "transparent");
        ctx.fillStyle = sg;
        ctx.beginPath();
        ctx.arc(cx, cy, W * 0.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 0.15;
        ctx.strokeStyle = palette[2];
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(cx - 150, 0);
        ctx.lineTo(cx - 40, H * 0.4);
        ctx.lineTo(cx + 40, H * 0.4);
        ctx.lineTo(cx + 150, 0);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      else if (template.id === "vintage-film") {
        const g = ctx.createLinearGradient(0, 0, W, H);
        g.addColorStop(0, "#2a1f1a");
        g.addColorStop(0.5, "#4a3828");
        g.addColorStop(1, "#6a5038");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
        ctx.globalAlpha = 0.08;
        for (let i = 0; i < 500; i++) {
          const px = Math.random() * W;
          const py = Math.random() * H;
          const pv = 128 + Math.random() * 127;
          ctx.fillStyle = `rgba(${pv},${pv},${pv},0.4)`;
          ctx.fillRect(px, py, 1, 1);
        }
        ctx.globalAlpha = 1;
        const vg = ctx.createRadialGradient(cx, cy, W * 0.25, cx, cy, W * 0.7);
        vg.addColorStop(0, "rgba(0,0,0,0)");
        vg.addColorStop(1, "rgba(0,0,0,0.5)");
        ctx.fillStyle = vg;
        ctx.fillRect(0, 0, W, H);
        ctx.globalAlpha = 0.6;
        ctx.fillStyle = "#1a1a1a";
        ctx.font = "14px monospace";
        ctx.textAlign = "right";
        ctx.fillText("K EAGLE  50mm  f/2.8  1/125  ISO 400", W - 20, H - 20);
        ctx.globalAlpha = 1;
      }

      else if (template.id === "gradient-mesh") {
        const t2 = t * 0.08;
        const mg = ctx.createRadialGradient(W * (0.3 + Math.sin(t2) * 0.1), H * (0.3 + Math.cos(t2 * 0.7) * 0.1), 0, W * 0.5, H * 0.5, W * 0.7);
        mg.addColorStop(0, palette[2]);
        mg.addColorStop(0.4, palette[1]);
        mg.addColorStop(1, palette[0]);
        ctx.fillStyle = mg;
        ctx.fillRect(0, 0, W, H);
        const mg2 = ctx.createRadialGradient(W * (0.7 + Math.cos(t2) * 0.1), H * (0.4 + Math.sin(t2 * 0.5) * 0.1), 0, W * 0.6, H * 0.4, W * 0.5);
        mg2.addColorStop(0, palette[0]);
        mg2.addColorStop(0.5, palette[2]);
        mg2.addColorStop(1, "transparent");
        ctx.globalAlpha = 0.4;
        ctx.fillStyle = mg2;
        ctx.beginPath();
        ctx.arc(W * 0.65, H * 0.45, W * 0.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      // ── center profile frame ──────────────────────────────────────────
      const r = radius.current;

      // videos flashing around center for particle/zoom templates
      if ((template.id === "particle-dust" || template.id === "slow-zoom-ring-pulse") &&
          assetsRef.current.bgPhoto && assetsRef.current.bgPhoto.naturalWidth > 0) {
        const flashIdx = Math.floor(t / (Math.PI * 2 / 4)) % 4;
        const flashAngle = flashIdx * (Math.PI * 2 / 4) + t * 0.5;
        const flashDist = r + 120;
        const fx = cx + Math.cos(flashAngle) * flashDist;
        const fy = cy + Math.sin(flashAngle) * flashDist * 0.6;
        ctx.globalAlpha = 0.25;
        ctx.drawImage(assetsRef.current.bgPhoto, fx - 100, fy - 60, 200, 120);
        ctx.globalAlpha = 1;
      }

      drawRoundFrame(
        ctx,
        cx,
        cy,
        r,
        assetsRef.current.profile,
        "rgba(77,112,255,0.9)",
        palette[2],
      );

      // ── subtitle ─────────────────────────────────────────────────────
      if (template.showSubtitle && subtitle) {
        const subY = cy + r + 60;
        ctx.save();
        ctx.textAlign = "center";
        ctx.shadowColor = "rgba(0,0,0,0.7)";
        ctx.shadowBlur = 8;
        ctx.fillStyle = "#ffffff";
        ctx.font = `600 ${FONT_SIZES.subtitle}px Arial, sans-serif`;
        const maxW = W * 0.7;
        let text = subtitle;
        while (ctx.measureText(text).width > maxW && text.length > 2) {
          text = text.slice(0, -1);
        }
        if (text.length < subtitle.length) text = text.slice(0, -1) + "…";
        ctx.fillText(text, cx, subY);
        ctx.restore();
      }

      // ── product chip ──────────────────────────────────────────────────
      if (template.showProductChip && productLabel) {
        const chipY = H - 140;
        const chipText = productLabel;
        ctx.font = `600 ${FONT_SIZES.productChip}px Arial, sans-serif`;
        const padX = 28;
        const tw = ctx.measureText(chipText).width;
        const chipW = tw + padX * 2;
        const chipH = 48;
        const chipX = cx - chipW / 2;
        const chipYpos = chipY - chipH / 2;

        ctx.save();
        ctx.shadowColor = "rgba(0,0,0,0.4)";
        ctx.shadowBlur = 12;
        ctx.fillStyle = palette[2];
        ctx.beginPath();
        ctx.roundRect(chipX, chipYpos, chipW, chipH, 24);
        ctx.fill();
        ctx.restore();

        ctx.save();
        ctx.strokeStyle = "rgba(255,255,255,0.5)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.roundRect(chipX, chipYpos, chipW, chipH, 24);
        ctx.stroke();
        ctx.restore();

        ctx.save();
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "#ffffff";
        ctx.font = `600 ${FONT_SIZES.productChip}px Arial, sans-serif`;
        ctx.fillText(chipText, cx, chipY);
        ctx.restore();

        // product URL stored as canvas metadata (not visible)
        // encoded in the saved video metadata via FormData on the page
      }

      // ── brand watermark (subtle) ─────────────────────────────────────
      ctx.save();
      ctx.globalAlpha = 0.15;
      ctx.textAlign = "right";
      ctx.textBaseline = "bottom";
      ctx.fillStyle = "#ffffff";
      ctx.font = `500 14px Arial, sans-serif`;
      ctx.fillText("LinkMe+", W - 30, H - 20);
      ctx.restore();

      if (recording || (!reducedMotion && isPlaying)) {
        frameRef.current = requestAnimationFrame(draw);
      }
    };

    const resizeObserver = new ResizeObserver(() => {
      // canvas is fixed 1080x1920; CSS handles display scaling
    });
    resizeObserver.observe(canvas);

    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onMotionChange = () => { reducedMotion = mediaQuery.matches; };
    mediaQuery.addEventListener("change", onMotionChange);

    const intersectionObserver = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible && !pausedRef.current && frameRef.current === null && (recording || (!reducedMotion && isPlaying))) {
        startedAt = performance.now();
        frameRef.current = requestAnimationFrame(draw);
      }
      if (!visible && frameRef.current !== null && !recording) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    }, { threshold: 0.05 });
    intersectionObserver.observe(canvas);

    // draw one frame immediately for static preview
    draw(performance.now());

    return () => {
      cancelled = true;
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      mediaQuery.removeEventListener("change", onMotionChange);
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      onProfileChange?.(offsetX.current, offsetY.current, radius.current);
    };
  }, [
    template,
    profilePhoto,
    backgroundVideo,
    backgroundPhoto,
    backgroundColor,
    subtitle,
    productLabel,
    speed,
    duration,
    isPlaying,
    onCanvasReady,
    className,
    onProfileChange,
    backgroundPhotos,
    aspectRatio,
    isCover,
    W,
    H,
    centerFactor,
    defaultRadius,
    recording,
  ]);

  const onPointerDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const scaleX = W / rect.width;
    const scaleY = H / rect.height;
    const px = (e.clientX - rect.left) * scaleX;
    const py = (e.clientY - rect.top) * scaleY;
    const dx = px - (W / 2 + offsetX.current);
    const dy = py - (H * centerFactor + offsetY.current);
    const dist = Math.sqrt(dx * dx + dy * dy);
    const frameR = radius.current + 24;
    if (Math.abs(dist - frameR) < 20) {
      draggingRef.current = "resize";
      dragStartRef.current = { x: px, y: py, ox: offsetX.current, oy: offsetY.current, or: radius.current };
    } else if (dist < frameR - 4) {
      draggingRef.current = "move";
      dragStartRef.current = { x: px, y: py, ox: offsetX.current, oy: offsetY.current, or: radius.current };
    }
  };

  const onPointerMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!draggingRef.current || !dragStartRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const scaleX = W / rect.width;
    const scaleY = H / rect.height;
    const px = (e.clientX - rect.left) * scaleX;
    const py = (e.clientY - rect.top) * scaleY;
    const dx = px - dragStartRef.current.x;
    const dy = py - dragStartRef.current.y;
    if (draggingRef.current === "move") {
      const maxX = isCover ? W * 0.35 : 180;
      const minY = isCover ? -H * 0.35 : -400;
      const maxY = isCover ? H * 0.35 : 0;
      const nx = Math.max(-maxX, Math.min(maxX, dragStartRef.current.ox + dx));
      const ny = Math.max(minY, Math.min(maxY, dragStartRef.current.oy + dy));
      offsetX.current = nx;
      offsetY.current = ny;
      onProfileChange?.(nx, ny, radius.current);
    } else {
      const maxRadius = isCover ? H * 0.45 : 240;
      const newR = Math.max(40, Math.min(maxRadius, dragStartRef.current.or + dy * 0.6));
      radius.current = newR;
      onProfileChange?.(offsetX.current, offsetY.current, newR);
    }
  };

  const onPointerUp = () => {
    if (draggingRef.current && dragStartRef.current) {
      onProfileChange?.(offsetX.current, offsetY.current, radius.current);
    }
    draggingRef.current = null;
    dragStartRef.current = null;
  };

  const onTouchStart = (e: React.TouchEvent<HTMLCanvasElement>) => {
    const t = e.touches[0]; if (!t) return;
    const me = { clientX: t.clientX, clientY: t.clientY, currentTarget: e.currentTarget };
    onPointerDown(me as unknown as React.MouseEvent<HTMLCanvasElement>);
  };

  const onTouchMove = (e: React.TouchEvent<HTMLCanvasElement>) => {
    const t = e.touches[0]; if (!t) return;
    const me = { clientX: t.clientX, clientY: t.clientY, currentTarget: e.currentTarget };
    onPointerMove(me as unknown as React.MouseEvent<HTMLCanvasElement>);
  };

  const onTouchEnd = () => onPointerUp();
  const onTouchCancel = () => onPointerUp();

  return (
    <canvas
      ref={canvasRef}
      className={className ?? "h-full w-full"}
      role="img"
      aria-label="Short video cover preview"
      onMouseDown={onPointerDown}
      onMouseMove={onPointerMove}
      onMouseUp={onPointerUp}
      onMouseLeave={onPointerUp}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchCancel}
    />
  );
}

function lerpColor(a: string, b: string, t: number): string {
  const pa = hexToRgb(a);
  const pb = hexToRgb(b);
  if (!pa || !pb) return a;
  const r = Math.round(pa.r + (pb.r - pa.r) * t);
  const g = Math.round(pa.g + (pb.g - pa.g) * t);
  const bl = Math.round(pa.b + (pb.b - pa.b) * t);
  return `rgb(${r},${g},${bl})`;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? { r: parseInt(result[1], 16), g: parseInt(result[2], 16), b: parseInt(result[3], 16) }
    : null;
}
