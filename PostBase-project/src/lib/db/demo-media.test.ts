import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertDemoMediaConfigured,
  avatarSvg,
  ensureDemoAvatar,
  ensureDemoListingImage,
  ensureDemoPageCover,
  ensureDemoPostImage,
  ensureDemoVideo,
  listingPhotoSvg,
  pageCoverSvg,
  postArtworkSvg,
} from "./demo-media";
import { putObject } from "@/lib/r2";

/**
 * The seed's imagery is generated, not checked in: `postArtworkSvg` and
 * `avatarSvg` are pure functions of an index, and the `ensureDemo*` helpers
 * upload only when the object is missing so a re-run stays cheap.
 *
 * `@/lib/r2`'s `putObject` is mocked — the real one signs and sends an S3
 * request — while everything else in that module (the URL builder the tests key
 * against) stays real. The fetch stub answers the HEAD probe that decides
 * whether an upload is needed.
 */
vi.mock("@/lib/r2", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/r2")>();
  return { ...actual, putObject: vi.fn(async () => undefined) };
});

const putObjectMock = vi.mocked(putObject);

afterEach(() => {
  vi.unstubAllGlobals();
  putObjectMock.mockClear();
});

describe("postArtworkSvg", () => {
  it("is deterministic for a given index and varies by index", () => {
    const first = postArtworkSvg(3);
    expect(postArtworkSvg(3)).toBe(first);
    expect(postArtworkSvg(4)).not.toBe(first);
  });

  it("honours the requested size and draws an svg", () => {
    const svg = postArtworkSvg(0, 320, 240);
    expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('width="320"');
    expect(svg).toContain('height="240"');
    expect(svg).toContain('viewBox="0 0 320 240"');
  });
});

describe("listingPhotoSvg", () => {
  it("is deterministic for a given index and varies by index", () => {
    const first = listingPhotoSvg(2);
    expect(listingPhotoSvg(2)).toBe(first);
    expect(listingPhotoSvg(3)).not.toBe(first);
  });

  it("is square by default, because the card crops it into a square tile", () => {
    const svg = listingPhotoSvg(0);
    expect(svg).toContain('width="1200"');
    expect(svg).toContain('height="1200"');
    expect(svg).toContain('viewBox="0 0 1200 1200"');
  });

  it("honours the requested size", () => {
    const svg = listingPhotoSvg(1, 240);
    expect(svg).toContain('width="240"');
    expect(svg).toContain('height="240"');
  });

  it("does not draw the post artwork, so a shop grid cannot read as a feed", () => {
    // Same index, same palette source: the two compositions must differ, or the
    // marketplace would be a wall of the pictures the feed already shows.
    expect(listingPhotoSvg(5)).not.toBe(postArtworkSvg(5));
  });
});

describe("pageCoverSvg", () => {
  it("is a wide band by default, because the Page crops it into a short header", () => {
    const svg = pageCoverSvg(0);
    expect(svg).toContain('width="1600"');
    expect(svg).toContain('height="400"');
    expect(svg).toContain('viewBox="0 0 1600 400"');
  });

  it("is deterministic for a given index and varies by index", () => {
    const first = pageCoverSvg(1);
    expect(pageCoverSvg(1)).toBe(first);
    expect(pageCoverSvg(2)).not.toBe(first);
  });
});

describe("ensureDemoListingImage", () => {
  it("renders and uploads a jpeg when the object is missing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 404 })));

    const url = await ensureDemoListingImage(4);
    expect(url).toBe("https://test.r2.dev/seed/listings/listing-04.jpg");
    const [key, body, contentType] = putObjectMock.mock.calls[0];
    expect(key).toBe("seed/listings/listing-04.jpg");
    expect(body).toBeInstanceOf(Uint8Array);
    expect(contentType).toBe("image/jpeg");
  });

  it("returns the existing URL without uploading when the object is already there", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 200 })));

    const url = await ensureDemoListingImage(0);
    expect(url).toBe("https://test.r2.dev/seed/listings/listing-00.jpg");
    expect(putObjectMock).not.toHaveBeenCalled();
  });
});

describe("ensureDemoPageCover", () => {
  it("renders and uploads a jpeg when the object is missing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 404 })));

    const url = await ensureDemoPageCover(2);
    expect(url).toBe("https://test.r2.dev/seed/pages/cover-02.jpg");
    const [key, body, contentType] = putObjectMock.mock.calls[0];
    expect(key).toBe("seed/pages/cover-02.jpg");
    expect(body).toBeInstanceOf(Uint8Array);
    expect(contentType).toBe("image/jpeg");
  });
});

describe("avatarSvg", () => {
  it("draws the member's initials", () => {
    expect(avatarSvg(0, "TW")).toContain(">TW<");
  });

  it("escapes initials so they cannot break out of the markup", () => {
    // The text is interpolated into the svg, so a hostile initials string must
    // come out as entities rather than a tag.
    const svg = avatarSvg(0, '<script>&"');
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&lt;script&gt;&amp;");
  });

  it("uses the requested size", () => {
    expect(avatarSvg(1, "AB", 128)).toContain('width="128"');
  });
});

describe("assertDemoMediaConfigured", () => {
  it("throws, naming what is missing, when R2 credentials are absent", () => {
    // The test environment deliberately has no R2 account or keys, which is the
    // state this guard exists to report before a seed run writes anything.
    expect(() => assertDemoMediaConfigured()).toThrow(/Cloudflare R2 storage is not configured/);
  });
});

describe("ensureDemoAvatar", () => {
  it("returns the existing URL without uploading when the object is already there", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 200 })));

    const url = await ensureDemoAvatar(0, "TW");
    expect(url).toBe("https://test.r2.dev/seed/avatars/tw-0.png");
    expect(putObjectMock).not.toHaveBeenCalled();
  });

  it("renders and uploads a png when the object is missing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 404 })));

    const url = await ensureDemoAvatar(2, "J. R");
    expect(url).toBe("https://test.r2.dev/seed/avatars/jr-2.png");
    expect(putObjectMock).toHaveBeenCalledTimes(1);
    const [key, body, contentType] = putObjectMock.mock.calls[0];
    expect(key).toBe("seed/avatars/jr-2.png");
    expect(body).toBeInstanceOf(Uint8Array);
    expect(contentType).toBe("image/png");
  });
});

describe("ensureDemoPostImage", () => {
  it("renders and uploads a jpeg when the object is missing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 404 })));

    const url = await ensureDemoPostImage(7);
    expect(url).toBe("https://test.r2.dev/seed/posts/artwork-07.jpg");
    const [key, , contentType] = putObjectMock.mock.calls[0];
    expect(key).toBe("seed/posts/artwork-07.jpg");
    expect(contentType).toBe("image/jpeg");
  });
});

describe("ensureDemoVideo", () => {
  it("returns the existing URL without fetching a clip", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(ensureDemoVideo(0)).resolves.toBe("https://test.r2.dev/seed/videos/sample-clip-1.mp4");
    // Only the HEAD probe ran; the source clip was never downloaded.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(putObjectMock).not.toHaveBeenCalled();
  });

  it("mirrors a fetched clip into R2 and returns its URL", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) =>
        init?.method === "HEAD"
          ? new Response(null, { status: 404 })
          : new Response(new Uint8Array([0, 1, 2, 3]), { status: 200 }),
      ),
    );

    await expect(ensureDemoVideo(1)).resolves.toBe("https://test.r2.dev/seed/videos/sample-clip-2.mp4");
    const [key, body, contentType] = putObjectMock.mock.calls[0];
    expect(key).toBe("seed/videos/sample-clip-2.mp4");
    expect(body).toBeInstanceOf(Uint8Array);
    expect(contentType).toBe("video/mp4");
  });

  it("returns null when no mirror can be fetched", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 503 })));

    await expect(ensureDemoVideo(0)).resolves.toBeNull();
    expect(putObjectMock).not.toHaveBeenCalled();
  });
});
