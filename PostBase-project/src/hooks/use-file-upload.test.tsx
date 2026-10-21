// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { cleanupSurfaces, mountSurface } from "@/test/render";
import { useFileUpload } from "./use-file-upload";

/**
 * The hook owns a queue of uploads and drives each one through presign → PUT.
 * A test that reached into it directly would have to re-implement React's
 * batching, so the hook is mounted through a tiny harness and read back after
 * `act`, exactly as a component would see it.
 */
type Api = ReturnType<typeof useFileUpload>;

let latest: Api | null = null;
let completed: { url: string; key: string }[][] = [];

function Harness({ onComplete }: { onComplete?: (files: { url: string; key: string }[]) => void }) {
  // Captured on every render so the test always reads the latest state.
  latest = useFileUpload({ purpose: "avatar", onComplete });
  return null;
}

function mountHook(options: { onComplete?: (files: { url: string; key: string }[]) => void } = {}) {
  return mountSurface(<Harness {...options} />, { providers: "none" });
}

async function call<T>(fn: (api: Api) => T): Promise<T> {
  let result!: T;
  await act(async () => {
    result = fn(latest as Api);
  });
  return result;
}

function file(name = "photo.png") {
  return new File(["bytes"], name, { type: "image/png" });
}

function stubFetch(handler: (url: string, init: RequestInit) => Response) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => handler(String(input), init)),
  );
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

afterEach(() => {
  cleanupSurfaces();
  vi.unstubAllGlobals();
  completed = [];
});

describe("useFileUpload queue", () => {
  it("adds files as pending and returns their ids", async () => {
    mountHook();

    let ids: string[] = [];
    await call((api) => {
      ids = api.addFiles([file("a.png"), file("b.png")]);
    });

    expect(ids).toHaveLength(2);
    expect(latest?.uploads).toHaveLength(2);
    expect(latest?.uploads.every((u) => u.status === "pending")).toBe(true);
    expect(latest?.hasPendingUploads).toBe(true);
  });

  it("removes one upload and clears the rest", async () => {
    mountHook();
    await call((api) => api.addFiles([file("a.png"), file("b.png")]));

    const firstId = latest?.uploads[0].id as string;
    await call((api) => api.removeUpload(firstId));
    expect(latest?.uploads).toHaveLength(1);

    await call((api) => api.clearUploads());
    expect(latest?.uploads).toHaveLength(0);
    expect(latest?.hasPendingUploads).toBe(false);
  });
});

describe("useFileUpload uploadAll", () => {
  it("uploads in one step — the file and the purpose on one POST — marks complete, and reports the results", async () => {
    mountHook({ onComplete: (files) => completed.push(files) });

    const requests: { url: string; method: string; body?: FormData }[] = [];
    stubFetch((url, init) => {
      requests.push({
        url,
        method: (init?.method as string) ?? "GET",
        body: init?.body instanceof FormData ? init.body : undefined,
      });
      return json({ url: "https://cdn/u/1.png", key: "avatars/u/1.png", contentType: "image/png", purpose: "avatar" });
    });

    await call((api) => api.addFiles([file()]));
    await call((api) => api.uploadAll());

    // One request, and it is the old presign step's door: the reason the old
    // second request (a browser PUT to the presigned URL) is gone is that the
    // bucket has no CORS headers for it — what carries the file now is this one
    // multipart POST, with the purpose beside it.
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ url: "/api/uploads", method: "POST" });
    expect(requests[0].body!.get("purpose")).toBe("avatar");
    expect(requests[0].body!.get("file")).toBeInstanceOf(File);

    expect(latest?.uploads[0]).toMatchObject({
      status: "complete",
      url: "https://cdn/u/1.png",
      key: "avatars/u/1.png",
    });
    expect(latest?.isUploading).toBe(false);
    expect(latest?.successfulUploads).toHaveLength(1);
    expect(completed).toEqual([[{ url: "https://cdn/u/1.png", key: "avatars/u/1.png" }]]);
  });

  it("records a refused upload with the server's reason", async () => {
    mountHook();
    stubFetch(() => json({ error: "File type not allowed" }, 400));

    await call((api) => api.addFiles([file()]));
    const results = await call((api) => api.uploadAll());

    expect(results).toEqual([]);
    expect(latest?.uploads[0]).toMatchObject({ status: "error", error: "File type not allowed" });
    expect(latest?.hasErrors).toBe(true);
  });

  it("records a storage failure with the fallback message", async () => {
    mountHook();
    stubFetch(() => new Response(null, { status: 500 }));

    await call((api) => api.addFiles([file()]));
    await call((api) => api.uploadAll());

    expect(latest?.uploads[0]).toMatchObject({ status: "error", error: "Failed to upload file" });
  });

  it("does nothing when there is nothing pending", async () => {
    mountHook();
    const results = await call((api) => api.uploadAll());
    expect(results).toBeUndefined();
  });
});
