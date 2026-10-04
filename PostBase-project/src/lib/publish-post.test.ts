import { afterEach, describe, expect, it, vi } from "vitest";
import { publishPost, uploadPostAttachment } from "./publish-post";

/**
 * Publishing is two requests whose order is the contract: the attachment is
 * stored *before* the post is created, because `/api/posts` records whatever
 * URL it is handed. A `blob:` preview URL would be persisted and then be dead
 * for everyone, so the upload's returned URL is what must reach the post.
 *
 * These tests drive that with a stubbed `fetch` rather than a mounted composer:
 * the module has no React in it, and the interesting decisions are all in the
 * request bodies and the error messages.
 */
type Call = { url: string; method: string; body: unknown; form: FormData | undefined };

let calls: Call[] = [];

function stubFetch(handler: (call: Call) => Response | undefined) {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = init?.body;
      const call: Call = {
        url,
        method: (init?.method ?? "GET").toUpperCase(),
        body: typeof body === "string" ? JSON.parse(body) : undefined,
        form: body instanceof FormData ? body : undefined,
      };
      calls.push(call);
      const response = handler(call);
      if (!response) throw new Error(`unstubbed fetch: ${call.method} ${url}`);
      return response;
    }),
  );
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("uploadPostAttachment", () => {
  it("posts the file and returns the stored URL and type", async () => {
    stubFetch((call) => {
      expect(call.url).toBe("/api/posts/media");
      expect(call.method).toBe("POST");
      // The file rides as multipart, not JSON.
      expect(call.form?.get("file")).toBeInstanceOf(File);
      return json({ url: "https://cdn.example.com/posts/1.jpg", type: "image/jpeg" });
    });

    const file = new File(["x"], "photo.jpg", { type: "image/jpeg" });
    await expect(uploadPostAttachment(file)).resolves.toEqual({
      url: "https://cdn.example.com/posts/1.jpg",
      type: "image/jpeg",
    });
  });

  it("falls back to the file's own type when the response omits one", async () => {
    stubFetch(() => json({ url: "https://cdn.example.com/posts/1.mp4" }));
    const file = new File(["x"], "clip.mp4", { type: "video/mp4" });
    await expect(uploadPostAttachment(file)).resolves.toEqual({
      url: "https://cdn.example.com/posts/1.mp4",
      type: "video/mp4",
    });
  });

  it("says the server was unreachable when the request itself rejects", async () => {
    // A dropped connection is not a rejection — the copy has to say so rather
    // than surface the browser's "Failed to fetch".
    stubFetch(() => {
      throw new TypeError("Failed to fetch");
    });
    const file = new File(["x"], "photo.jpg", { type: "image/jpeg" });
    await expect(uploadPostAttachment(file)).rejects.toThrow(
      "We couldn't reach the server to upload that file.",
    );
  });

  it("rejects when the route answers non-ok, or with no url", async () => {
    stubFetch(() => json({ error: "nope" }, 500));
    await expect(uploadPostAttachment(new File(["x"], "a.jpg", { type: "image/jpeg" }))).rejects.toThrow(
      "We couldn't upload that file.",
    );

    stubFetch(() => json({ type: "image/jpeg" }));
    await expect(uploadPostAttachment(new File(["x"], "a.jpg", { type: "image/jpeg" }))).rejects.toThrow(
      "We couldn't upload that file.",
    );
  });
});

describe("publishPost", () => {
  it("refuses an empty post with nothing attached", async () => {
    stubFetch(() => undefined);
    await expect(publishPost({ content: "   " })).rejects.toThrow(
      "Write something, or attach a photo or video.",
    );
    // Nothing was uploaded and nothing was posted.
    expect(calls).toEqual([]);
  });

  it("uploads the attachment first, then creates the post with the stored URL", async () => {
    stubFetch((call) =>
      call.url === "/api/posts/media"
        ? json({ url: "https://cdn.example.com/posts/1.jpg", type: "image/jpeg" })
        : json({ post: { id: "post-1" } }, 201),
    );

    const file = new File(["x"], "photo.jpg", { type: "image/jpeg" });
    const result = await publishPost({ content: "  hello world  ", file, audience: "followers" });

    expect(result.post).toEqual({ id: "post-1" });
    // The upload went first, and its URL — not the local file — is what the
    // post records.
    expect(calls.map((call) => call.url)).toEqual(["/api/posts/media", "/api/posts"]);
    expect(calls[1].body).toEqual({
      content: "hello world",
      type: "image",
      visibility: "followers",
      media: [{ url: "https://cdn.example.com/posts/1.jpg", type: "image/jpeg", altText: "Post image" }],
    });
    expect(result.media).toEqual([
      { url: "https://cdn.example.com/posts/1.jpg", type: "image/jpeg", altText: "Post image" },
    ]);
  });

  it("labels a video attachment and defaults the audience to public", async () => {
    stubFetch((call) =>
      call.url === "/api/posts/media"
        ? json({ url: "https://cdn.example.com/posts/1.mp4", type: "video/mp4" })
        : json({ post: { id: "post-2" } }, 201),
    );

    const file = new File(["x"], "clip.mp4", { type: "video/mp4" });
    await publishPost({ content: "watch this", file });

    expect(calls[1].body).toMatchObject({
      type: "video",
      visibility: "public",
      media: [{ type: "video/mp4", altText: "Post video" }],
    });
  });

  it("creates a text post with no media when no file is attached", async () => {
    stubFetch(() => json({ post: { id: "post-3" } }, 201));

    const result = await publishPost({ content: "just words" });

    expect(calls).toHaveLength(1);
    expect(calls[0].body).toEqual({
      content: "just words",
      type: "text",
      visibility: "public",
      media: [],
    });
    expect(result.media).toEqual([]);
  });

  it("rejects when the create fails or answers without a post id", async () => {
    stubFetch(() => json({ error: "boom" }, 500));
    await expect(publishPost({ content: "hello" })).rejects.toThrow(
      "We couldn't publish your post. Please try again.",
    );

    stubFetch(() => json({ post: {} }, 201));
    await expect(publishPost({ content: "hello" })).rejects.toThrow(
      "We couldn't publish your post. Please try again.",
    );
  });
});
