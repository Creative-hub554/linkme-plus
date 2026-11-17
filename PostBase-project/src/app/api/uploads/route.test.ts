import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The upload route, driven through the handler.
 *
 * What this route replaces is the point of these cases. It used to answer with
 * a signed URL and trust three things the caller said about the file: its type,
 * its size, and that the PUT that followed would respect them. Now the route
 * reads the bytes, so the cases below are all about the server's own reading —
 * a real PNG is stored, a shell script wearing `image/png` is not, a PDF the
 * avatar purpose does not allow is refused, and a file over its limit is
 * refused before anything is written.
 */
vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: async () => ({ user: { id: "member-1" } }),
    },
  },
}));

vi.mock("@/lib/r2", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/r2")>();
  return {
    ...actual,
    assertStorageConfigured: vi.fn(),
    putObject: vi.fn(async () => {}),
  };
});

import { POST, GET } from "./route";
import { assertStorageConfigured, putObject } from "@/lib/r2";

const PNG_HEADER = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

// `Uint8Array<ArrayBuffer>` rather than bare `Uint8Array`: these become
// `BlobPart`s, and a view over a possibly-shared buffer is not one.
function pngBytes(padding = 0): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(PNG_HEADER.length + padding);
  bytes.set(PNG_HEADER);
  return bytes;
}

function textBytes(value: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(Math.max(64, value.length));
  bytes.set(Array.from(value, (character) => character.charCodeAt(0)));
  return bytes;
}

function uploadRequest(
  file: File,
  options: { purpose?: string; omitPurpose?: boolean; declaredName?: string } = {},
) {
  const form = new FormData();
  form.append("file", file);
  if (!options.omitPurpose) form.append("purpose", options.purpose ?? "post");
  return new Request("http://localhost/api/uploads", { method: "POST", body: form });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/uploads", () => {
  it("stores a real PNG under the caller's folder and answers with its URL", async () => {
    const file = new File([pngBytes()], "photo.png", { type: "image/png" });
    const response = await POST(uploadRequest(file));

    expect(response.status).toBe(201);
    const payload = await response.json();
    expect(payload.key).toContain("posts/member-1/");
    expect(payload.key.endsWith(".png")).toBe(true);
    expect(payload.type).toBe("image/png");
    expect(payload.size).toBe(file.size);
    expect(payload.url).toBe(`https://test.r2.dev/${payload.key}`);
    // FormData hands the route its own File for the same bytes, so the
    // assertion is about what was stored, not object identity.
    const [storedKey, storedFile, storedType] = vi.mocked(putObject).mock.calls[0];
    expect(storedKey).toBe(payload.key);
    expect(storedType).toBe("image/png");
    expect(storedFile).toBeInstanceOf(File);
    expect((storedFile as File).size).toBe(file.size);
  });

  it("classifies the bytes rather than the name or the declared type", async () => {
    // A shell script wearing an image type and a `.png` name. The old route
    // signed a URL for exactly this, under `image/png`.
    const file = new File([textBytes("#!/bin/sh\nrm -rf /")], "photo.png", { type: "image/png" });
    const response = await POST(uploadRequest(file));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "That file is not an allowed image, video, or PDF" });
    expect(vi.mocked(putObject)).not.toHaveBeenCalled();
  });

  it("stores a PDF as a PDF even when the file is named as an image", async () => {
    const file = new File([textBytes("%PDF-1.7")], "photo.png", { type: "image/png" });

    // …but a PDF is not an avatar, so the purpose refuses it.
    const refused = await POST(uploadRequest(file, { purpose: "avatar" }));
    expect(refused.status).toBe(400);
    expect((await refused.json()).error).toContain("application/pdf files are not allowed for avatar uploads");

    // Under a purpose that allows documents it is stored with the detected
    // type and the detected extension, not the caller's.
    const accepted = await POST(uploadRequest(file, { purpose: "document" }));
    expect(accepted.status).toBe(201);
    const payload = await accepted.json();
    expect(payload.type).toBe("application/pdf");
    expect(payload.key.endsWith(".pdf")).toBe(true);
    expect(vi.mocked(putObject)).toHaveBeenCalledWith(
      payload.key,
      expect.any(File),
      "application/pdf",
    );
  });

  it("refuses a file over the limit the detected type carries", async () => {
    const oversized = new File([pngBytes(11 * 1024 * 1024)], "huge.png", { type: "image/png" });
    const response = await POST(uploadRequest(oversized));

    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("The limit for image/png is 10MB");
    expect(vi.mocked(putObject)).not.toHaveBeenCalled();
  });

  it("refuses an unknown purpose", async () => {
    const file = new File([pngBytes()], "photo.png", { type: "image/png" });
    const response = await POST(uploadRequest(file, { purpose: "everything" }));

    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("Unknown upload purpose");
    expect(vi.mocked(putObject)).not.toHaveBeenCalled();
  });

  it("treats an absent purpose as a post upload", async () => {
    const file = new File([pngBytes()], "photo.png", { type: "image/png" });
    const response = await POST(uploadRequest(file, { omitPurpose: true }));

    expect(response.status).toBe(201);
    const payload = await response.json();
    expect(payload.key).toContain("posts/member-1/");
  });

  it("refuses a body that carries no file", async () => {
    const form = new FormData();
    form.append("purpose", "post");
    const response = await POST(new Request("http://localhost/api/uploads", { method: "POST", body: form }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "A file is required" });
  });

  it("answers a JSON body — the retired presign shape — with the new contract", async () => {
    const response = await POST(
      new Request("http://localhost/api/uploads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ filename: "photo.png", contentType: "image/png", size: 1024 }),
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Send the file as multipart form data" });
    expect(vi.mocked(putObject)).not.toHaveBeenCalled();
  });

  it("answers 503, storing nothing, when storage is not configured", async () => {
    vi.mocked(assertStorageConfigured).mockImplementationOnce(() => {
      throw new Error("Cloudflare R2 storage is not configured: missing R2_ACCOUNT_ID");
    });

    const response = await POST(uploadRequest(new File([pngBytes()], "photo.png", { type: "image/png" })));

    expect(response.status).toBe(503);
    expect(vi.mocked(putObject)).not.toHaveBeenCalled();
  });

  it("answers 500 when the object store refuses the write", async () => {
    const silence = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(putObject).mockRejectedValueOnce(new Error("store unavailable"));
    try {
      const response = await POST(uploadRequest(new File([pngBytes()], "photo.png", { type: "image/png" })));

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: "Failed to store that file" });
    } finally {
      silence.mockRestore();
    }
  });
});

describe("GET /api/uploads", () => {
  it("reports the purpose rules it enforces", async () => {
    const payload = await (await GET()).json();

    expect(payload.maxSizes.image).toBe(10 * 1024 * 1024);
    expect(payload.purposes).toEqual(
      expect.arrayContaining([
        { purpose: "avatar", types: ["image/jpeg", "image/png", "image/webp"] },
        { purpose: "document", types: ["application/pdf"] },
      ]),
    );
    expect(payload.purposes).toHaveLength(6);
  });
});
