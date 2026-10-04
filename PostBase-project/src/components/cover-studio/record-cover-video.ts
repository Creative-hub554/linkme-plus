"use client";

/**
 * Turns the Cover Studio canvas into a real video file.
 *
 * There is no server-side encoder in this stack — a Worker cannot run ffmpeg —
 * so the clip is captured where it is drawn, from the live canvas, and only the
 * finished file is uploaded. `MediaRecorder` over `canvas.captureStream()` is the
 * one capture API available in every browser the studio supports, so the codec
 * is negotiated rather than assumed: Chromium and Firefox give WebM, Safari
 * hands back MP4.
 *
 * Kept apart from the page so the feature detection can be reasoned about (and
 * tested) without a browser.
 */

export interface RecordCoverVideoOptions {
  canvas: HTMLCanvasElement;
  /** how long to record, in milliseconds */
  durationMs: number;
  /** capture frame rate */
  fps?: number;
  /** called with 0..1 as the recording advances */
  onProgress?: (progress: number) => void;
}

export interface RecordedCoverVideo {
  blob: Blob;
  mimeType: string;
  durationMs: number;
}

/** Best first. `video/mp4` is last because only Safari produces it. */
const CANDIDATE_MIME_TYPES = [
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
  "video/mp4",
] as const;

/**
 * A painted canvas compresses to a few hundred KB per second at this bitrate;
 * four megabits is generous for a banner-sized clip and keeps the upload small.
 */
const VIDEO_BITS_PER_SECOND = 4_000_000;

const MIN_DURATION_MS = 1_000;
const MAX_DURATION_MS = 15_000;

export function isCoverVideoRecordingSupported(): boolean {
  if (typeof window === "undefined") return false;
  if (typeof MediaRecorder === "undefined") return false;
  if (typeof HTMLCanvasElement === "undefined") return false;
  return typeof HTMLCanvasElement.prototype.captureStream === "function";
}

export function pickCoverVideoMimeType(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  if (typeof MediaRecorder.isTypeSupported !== "function") return null;
  for (const type of CANDIDATE_MIME_TYPES) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return null;
}

export function coverVideoFileName(mimeType: string): string {
  return mimeType.includes("mp4") ? "cover-video.mp4" : "cover-video.webm";
}

/**
 * Records the canvas for `durationMs` and resolves the finished file.
 *
 * The canvas must already be animating: the caller starts the studio's
 * recording mode first, because a paused canvas records as a single still frame.
 */
export async function recordCoverVideo({
  canvas,
  durationMs,
  fps = 30,
  onProgress,
}: RecordCoverVideoOptions): Promise<RecordedCoverVideo> {
  if (!isCoverVideoRecordingSupported()) {
    throw new Error("This browser cannot record video. Try Chrome, Edge, or Safari.");
  }

  const safeDuration = Math.max(MIN_DURATION_MS, Math.min(MAX_DURATION_MS, Math.round(durationMs)));
  const stream = canvas.captureStream(fps);
  const mimeType = pickCoverVideoMimeType();
  const recorder = new MediaRecorder(stream, {
    videoBitsPerSecond: VIDEO_BITS_PER_SECOND,
    ...(mimeType ? { mimeType } : {}),
  });

  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) chunks.push(event.data);
  };
  const stopped = new Promise<void>((resolve) => {
    recorder.onstop = () => resolve();
  });

  const startedAt = performance.now();
  let progressTimer: number | null = null;

  try {
    // A timeslice makes the recorder emit chunks while it runs, so a clip is
    // never held as one allocation until the end.
    recorder.start(250);
    onProgress?.(0);

    if (onProgress) {
      progressTimer = window.setInterval(() => {
        const elapsed = performance.now() - startedAt;
        onProgress(Math.max(0, Math.min(1, elapsed / safeDuration)));
      }, 100);
    }

    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, safeDuration);
    });

    recorder.stop();
    await stopped;
  } finally {
    if (progressTimer !== null) window.clearInterval(progressTimer);
    // Releasing the capture tracks is what lets the canvas be recorded again.
    for (const track of stream.getTracks()) track.stop();
  }

  const type = recorder.mimeType || mimeType || "video/webm";
  const blob = new Blob(chunks, { type });
  if (blob.size === 0) {
    throw new Error("The recorded video came back empty. Try again.");
  }

  onProgress?.(1);
  return { blob, mimeType: type, durationMs: safeDuration };
}
