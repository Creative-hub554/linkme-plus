import { describe, expect, test } from "vitest";
import {
  coverVideoFileName,
  isCoverVideoRecordingSupported,
  pickCoverVideoMimeType,
  recordCoverVideo,
} from "@/components/cover-studio/record-cover-video";

describe("cover video recording", () => {
  test("reports itself unsupported where the capture APIs do not exist", () => {
    // This suite runs in a plain Node environment, which is exactly the case the
    // guard exists for: no `MediaRecorder`, no canvas capture.
    expect(isCoverVideoRecordingSupported()).toBe(false);
    expect(pickCoverVideoMimeType()).toBeNull();
  });

  test("fails with a readable message rather than a broken recorder", async () => {
    await expect(
      recordCoverVideo({ canvas: {} as HTMLCanvasElement, durationMs: 5000 }),
    ).rejects.toThrow(/cannot record video/i);
  });

  test("names the file after the codec the browser produced", () => {
    expect(coverVideoFileName("video/webm;codecs=vp9")).toBe("cover-video.webm");
    expect(coverVideoFileName("video/webm")).toBe("cover-video.webm");
    expect(coverVideoFileName("video/mp4")).toBe("cover-video.mp4");
  });
});
