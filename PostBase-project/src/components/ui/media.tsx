"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

interface MediaImageProps {
  src: string;
  alt: string;
  className?: string;
  /**
   * What to show instead when {@link src} fails to load. Opt-in, and there is no
   * default: this project serves no static assets at all (there is no `public/`
   * directory), so the default that used to be here — `/images/placeholder.png`
   * — could never resolve. A broken image swapped itself for a second broken
   * image and made a second failing request to prove it. With no fallback the
   * browser shows the `alt`, which at least says what is missing.
   */
  fallback?: string;
  loading?: "lazy" | "eager";
  /** Told once per failing source, whether or not a fallback was given. */
  onError?: () => void;
}

/**
 * An image that reports its own failure.
 *
 * It holds *which source failed* rather than a copy of the source. Copying
 * `src` into state on mount — which this did — means a caller that swaps the
 * image never sees the new one: editing a profile cover changed the prop, and
 * the cover kept showing the old picture until something remounted it.
 */
export function MediaImage({
  src,
  alt,
  className,
  fallback,
  loading = "lazy",
  onError,
}: MediaImageProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  const useFallback = failedSrc === src && fallback !== undefined;
  const imgSrc = useFallback ? fallback : src;

  const handleError = () => {
    // `failedSrc === src` means the source already failed once — so this is the
    // fallback failing too, and swapping again would loop.
    if (failedSrc === src) return;
    setFailedSrc(src);
    onError?.();
  };

  return (
    <img
      src={imgSrc}
      alt={alt}
      className={cn("object-cover", className)}
      loading={loading}
      onError={handleError}
    />
  );
}
