"use client";

import { useEffect, useRef } from "react";

export interface DynamicCoverConfig {
  templateId?: string;
  mode?: "personal" | "group";
  title?: string;
  subtitle?: string;
  photos?: string[];
  colorPalette?: string[];
  profile?: { enabled?: boolean; position?: "center"; shape?: "circle" };
  motion?: { rows?: number; speed?: number; direction?: string; transition?: string; animation?: string };
  effect?: string;
  backgroundPhoto?: string | null;
  updatedAt?: string;
}

interface DynamicCoverCanvasProps {
  config: DynamicCoverConfig;
  label: string;
  username?: string | null;
  bio?: string | null;
  avatarUrl?: string | null;
}

export function DynamicCoverCanvas({ config, label, username, bio, avatarUrl }: DynamicCoverCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<number | null>(null);
  const visibleRef = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    const palette = config.colorPalette?.length ? config.colorPalette : ["#071426", "#163b68", "#2563eb"];
    const photos = config.photos ?? [];
    const rows = Math.max(1, Math.min(8, config.motion?.rows ?? 4));
    const speed = Number(config.motion?.speed ?? 1);
    const direction = config.motion?.direction ?? "alternate";
    const animation = config.motion?.animation ?? "smooth";
    const imageCache: HTMLImageElement[] = [];
    let avatarImage: HTMLImageElement | null = null;
    let startedAt = performance.now();
    let stopped = false;
    let width = 1200;
    let height = 450;
    let reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const loadImage = (src: string, onLoad: (image: HTMLImageElement) => void) => {
      const image = new Image();
      image.crossOrigin = "anonymous";
      image.onload = () => onLoad(image);
      image.src = src;
    };

    photos.forEach((src, index) => loadImage(src, (image) => { imageCache[index] = image; }));
    if (avatarUrl) loadImage(avatarUrl, (image) => { avatarImage = image; });

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = Math.max(1, Math.round(rect.width));
      height = Math.max(1, Math.round(rect.height));
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const drawImageCover = (image: HTMLImageElement, x: number, y: number, cardWidth: number, cardHeight: number, radius: number) => {
      const scale = Math.max(cardWidth / image.width, cardHeight / image.height);
      const sourceWidth = cardWidth / scale;
      const sourceHeight = cardHeight / scale;
      const sourceX = (image.width - sourceWidth) / 2;
      const sourceY = (image.height - sourceHeight) / 2;
      context.save();
      context.beginPath();
      context.roundRect(x, y, cardWidth, cardHeight, radius);
      context.clip();
      context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, x, y, cardWidth, cardHeight);
      context.restore();
    };

    const draw = (now: number) => {
      if (stopped || !visibleRef.current) return;
      const elapsed = now - startedAt;
      const phase = (elapsed / (9000 / Math.max(0.35, speed))) % 1;
      const mobile = width < 640;
      const centerX = mobile ? width * 0.64 : width / 2;
      const centerY = height * (mobile ? 0.47 : 0.46);
      const gradient = context.createLinearGradient(0, 0, width, height);
      gradient.addColorStop(0, palette[0]);
      gradient.addColorStop(0.52, palette[1]);
      gradient.addColorStop(1, palette[2]);
      context.fillStyle = gradient;
      context.fillRect(0, 0, width, height);

      const cardHeight = Math.max(mobile ? 35 : 42, Math.min(mobile ? 58 : 88, height / rows * 0.72));
      const cardWidth = Math.max(mobile ? 76 : 100, cardHeight * (mobile ? 1.42 : 1.58));
      const itemCount = Math.max(photos.length, mobile ? 5 : 7);
      const travelWidth = cardWidth * itemCount * 1.2;

      for (let row = 0; row < rows; row += 1) {
        const rowHeight = height / rows;
        const y = row * rowHeight + (rowHeight - cardHeight) / 2;
        const sign = direction === "left" || (direction === "alternate" && row % 2 === 0) ? -1 : 1;
        const offset = ((phase * travelWidth * sign) % travelWidth + travelWidth) % travelWidth;
        for (let index = -2; index < itemCount + 3; index += 1) {
          const x = index * cardWidth * 1.2 + (sign < 0 ? -offset : offset);
          const wave = animation === "wave" ? Math.sin(phase * Math.PI * 2 + row) * (mobile ? 5 : 10) : 0;
          context.save();
          context.globalAlpha = 0.78;
          context.shadowColor = config.effect === "neon" ? palette[2] : "rgba(0,0,0,.4)";
          context.shadowBlur = config.effect === "neon" ? 16 : 7;
          context.fillStyle = palette[(row + index + 100) % palette.length];
          context.beginPath();
          context.roundRect(x, y + wave, cardWidth, cardHeight, mobile ? 7 : 10);
          context.fill();
          const image = imageCache[(index + row + 100) % Math.max(imageCache.length, 1)];
          if (image) {
            context.globalAlpha = 0.9;
            drawImageCover(image, x, y + wave, cardWidth, cardHeight, mobile ? 7 : 10);
          }
          context.restore();
        }
      }

      // Reference-style cinematic scrim keeps the portrait and text legible.
      context.fillStyle = "rgba(2, 8, 20, .48)";
      context.fillRect(0, 0, width, height);
      const edge = context.createLinearGradient(0, 0, width, 0);
      edge.addColorStop(0, "rgba(2,8,20,.72)");
      edge.addColorStop(0.32, "rgba(2,8,20,.1)");
      edge.addColorStop(0.68, "rgba(2,8,20,.1)");
      edge.addColorStop(1, "rgba(2,8,20,.72)");
      context.fillStyle = edge;
      context.fillRect(0, 0, width, height);

      // Central portrait: smaller on mobile so the photo wall remains visible.
      const portraitRadius = Math.min(mobile ? 43 : 68, height * (mobile ? 0.28 : 0.3));
      const ringRadius = portraitRadius + (mobile ? 8 : 11);
      context.save();
      context.shadowColor = "rgba(69, 91, 255, .72)";
      context.shadowBlur = mobile ? 18 : 28;
      context.fillStyle = "rgba(26, 33, 83, .9)";
      context.beginPath();
      context.arc(centerX, centerY, ringRadius + (mobile ? 5 : 8), 0, Math.PI * 2);
      context.fill();
      context.shadowBlur = 0;
      context.beginPath();
      context.arc(centerX, centerY, ringRadius, 0, Math.PI * 2);
      context.clip();
      if (avatarImage) {
        const scale = Math.max((ringRadius * 2) / avatarImage.width, (ringRadius * 2) / avatarImage.height);
        const avatarWidth = avatarImage.width * scale;
        const avatarHeight = avatarImage.height * scale;
        context.drawImage(avatarImage, centerX - avatarWidth / 2, centerY - avatarHeight / 2, avatarWidth, avatarHeight);
      } else {
        context.fillStyle = "rgba(225, 231, 239, .9)";
        context.fill();
      }
      context.restore();
      context.strokeStyle = "rgba(233, 238, 255, .95)";
      context.lineWidth = mobile ? 3 : 4;
      context.beginPath();
      context.arc(centerX, centerY, ringRadius, 0, Math.PI * 2);
      context.stroke();

      // Keep identity copy below the portrait on small screens; place it beside it on desktop.
      const textX = mobile ? Math.max(12, width * 0.06) : centerX - Math.min(250, width * 0.21);
      const textY = mobile ? centerY - 12 : centerY - 6;
      context.textAlign = "left";
      context.shadowColor = "rgba(0,0,0,.72)";
      context.shadowBlur = 10;
      context.fillStyle = "#ffffff";
      context.font = `700 ${mobile ? 14 : 24}px Arial, sans-serif`;
      context.fillText(label.slice(0, mobile ? 19 : 34), textX, textY);
      context.shadowBlur = 0;
      context.globalAlpha = 0.86;
      context.font = `${mobile ? 10 : 14}px Arial, sans-serif`;
      if (username) context.fillText(`@${username.replace(/^@/, "")}`.slice(0, mobile ? 22 : 34), textX, textY + (mobile ? 15 : 21));
      if (bio) {
        context.font = `${mobile ? 9 : 13}px Arial, sans-serif`;
        context.fillText(bio.slice(0, mobile ? 25 : 52), textX, textY + (mobile ? 30 : 43));
      }
      context.globalAlpha = 1;

      if (!reducedMotion) frameRef.current = requestAnimationFrame(draw);
    };

    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handleMotionChange = () => { reducedMotion = motionQuery.matches; };
    motionQuery.addEventListener("change", handleMotionChange);
    const observer = new IntersectionObserver(([entry]) => {
      visibleRef.current = entry.isIntersecting;
      if (entry.isIntersecting && frameRef.current === null) {
        startedAt = performance.now();
        frameRef.current = requestAnimationFrame(draw);
      } else if (!entry.isIntersecting && frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    }, { threshold: 0.05 });
    observer.observe(canvas);

    return () => {
      stopped = true;
      resizeObserver.disconnect();
      observer.disconnect();
      motionQuery.removeEventListener("change", handleMotionChange);
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, [config, label, username, bio, avatarUrl]);

  return <canvas ref={canvasRef} role="img" aria-label={`${label} animated cover`} className="absolute inset-0 h-full w-full" />;
}
