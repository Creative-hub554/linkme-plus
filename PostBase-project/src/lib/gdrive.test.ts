import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DRIVE_SCOPE,
  archivedFileIdFromUrl,
  createDriveClient,
  driveConfigFromEnv,
  drivePublicUrl,
  type DriveConfig,
} from "./gdrive";

/**
 * The archive's cold tier, tested against a fake Drive.
 *
 * Every network call is stubbed at the `fetch` seam, which is also how the
 * client is built: `createDriveClient` takes the transport, so these tests
 * assert the protocol itself — session initiation, chunk ranges, `308`
 * bookkeeping, permission bodies — rather than that a library was imported.
 *
 * The protocol assertions matter because nothing else in the codebase can
 * catch a mistake here: a `Content-Range` off by one would still "work" in a
 * unit test that only checks the happy path, and would surface only as a
 * corrupted file on Drive days later, discovered when someone looks at the
 * photo the archive moved. The range arithmetic below is therefore asserted
 * byte by byte.
 */

const CONFIG: DriveConfig = {
  clientId: "client-id",
  clientSecret: "client-secret",
  refreshToken: "refresh-token",
};

function tokenResponse(overrides: Partial<{ access_token: string; expires_in: number }> = {}): Response {
  return Response.json({ access_token: "access-token", expires_in: 3600, ...overrides });
}

/** A `fetch` double that routes by URL substring, in call order. */
function stubFetch(
  routes: Array<{ match: string | RegExp; reply: (init?: RequestInit) => Response }>,
): { impl: typeof fetch; calls: Array<{ url: string; init?: RequestInit }> } {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const route = routes.find((r) => (typeof r.match === "string" ? url.includes(r.match) : r.match.test(url)));
    if (!route) throw new Error(`unexpected request: ${url}`);
    return route.reply(init);
  }) as typeof fetch;
  return { impl, calls };
}

const tokenRoute = { match: "oauth2.googleapis.com/token", reply: () => tokenResponse() };

function streamOf(...parts: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const part of parts) controller.enqueue(part);
      controller.close();
    },
  });
}

function bytes(...values: number[]): Uint8Array {
  return new Uint8Array(values);
}

/** Parses a `bytes a-b/c` header so range assertions read as numbers, not strings. */
function parseContentRange(init: RequestInit | undefined): { start: number; end: number; total: number } {
  const header = new Headers(init?.headers).get("Content-Range");
  expect(header, "every chunk PUT carries a Content-Range").toMatch(/^bytes \d+-\d+\/\d+$/);
  const [range, total] = header!.split("/");
  const [start, end] = range.replace("bytes ", "").split("-");
  return { start: Number(start), end: Number(end), total: Number(total) };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("driveConfigFromEnv", () => {
  it("reads the three required pieces and the optional folder", () => {
    const config = driveConfigFromEnv({
      GDRIVE_CLIENT_ID: " id ",
      GDRIVE_CLIENT_SECRET: "secret",
      GDRIVE_REFRESH_TOKEN: "token",
      GDRIVE_FOLDER_ID: " folder-1 ",
    });
    expect(config).toEqual({
      clientId: "id",
      clientSecret: "secret",
      refreshToken: "token",
      folderId: "folder-1",
    });
  });

  it("reads as unconfigured when any required piece is missing", () => {
    // A half-set-up archive must take the scheduled pass's "nothing to do"
    // branch, not fail mid-run: the operator finishing the setup should not
    // race against a cron that already started with what it had.
    const full = {
      GDRIVE_CLIENT_ID: "id",
      GDRIVE_CLIENT_SECRET: "secret",
      GDRIVE_REFRESH_TOKEN: "token",
    };
    for (const missing of Object.keys(full)) {
      const env = { ...full };
      delete (env as Record<string, string>)[missing];
      expect(driveConfigFromEnv(env), `missing ${missing}`).toBeNull();
    }
    expect(driveConfigFromEnv({})).toBeNull();
  });

  it("treats an empty folder id as no folder", () => {
    const config = driveConfigFromEnv({
      GDRIVE_CLIENT_ID: "id",
      GDRIVE_CLIENT_SECRET: "secret",
      GDRIVE_REFRESH_TOKEN: "token",
      GDRIVE_FOLDER_ID: "   ",
    });
    expect(config?.folderId).toBeUndefined();
  });
});

describe("drivePublicUrl", () => {
  it("serves images through lh3, the form an <img> tag can load anonymously", () => {
    expect(drivePublicUrl("AbC123", "image/jpeg")).toBe("https://lh3.googleusercontent.com/d/AbC123");
    // Case in the mime type is not a different media type.
    expect(drivePublicUrl("AbC123", "IMAGE/PNG")).toBe("https://lh3.googleusercontent.com/d/AbC123");
  });

  it("sends PDFs to Drive's own viewer so they render inline", () => {
    expect(drivePublicUrl("AbC123", "application/pdf")).toBe(
      "https://drive.google.com/file/d/AbC123/preview",
    );
  });

  it("falls back to the download endpoint for video and everything else", () => {
    expect(drivePublicUrl("AbC123", "video/mp4")).toBe("https://drive.google.com/uc?export=download&id=AbC123");
    expect(drivePublicUrl("AbC123", null)).toBe("https://drive.google.com/uc?export=download&id=AbC123");
    expect(drivePublicUrl("AbC123", undefined)).toBe(
      "https://drive.google.com/uc?export=download&id=AbC123",
    );
  });
});

describe("archivedFileIdFromUrl", () => {
  it("recovers the id from every URL shape drivePublicUrl emits", () => {
    expect(archivedFileIdFromUrl("https://lh3.googleusercontent.com/d/AbC-123_x")).toBe("AbC-123_x");
    expect(archivedFileIdFromUrl("https://drive.google.com/file/d/AbC123/preview")).toBe("AbC123");
    expect(archivedFileIdFromUrl("https://drive.google.com/uc?export=download&id=AbC123")).toBe("AbC123");
    // Parameter order and a trailing anchor are still the same file.
    expect(archivedFileIdFromUrl("https://drive.google.com/uc?id=AbC123&export=download#top")).toBe(
      "AbC123",
    );
  });

  it("refuses anything else — this parser decides what the app may delete", () => {
    // A stranger's Drive link pasted into a row must not parse into an id this
    // app would then try to delete from the operator's own Drive; the mapping
    // table is the second rail, and this is the first.
    for (const url of [
      "https://drive.google.com/drive/folders/AbC123",
      "https://evil.example.com/d/AbC123",
      "https://lh3.googleusercontent.com/d/AbC123/extra-segment",
      "https://drive.google.com/uc?export=download",
      "",
      null,
      undefined,
    ]) {
      expect(archivedFileIdFromUrl(url)).toBeNull();
    }
  });
});

describe("the access token", () => {
  it("is fetched once and reused until it nears expiry", async () => {
    vi.useFakeTimers({ now: new Date("2026-01-01T00:00:00Z") });
    const { impl, calls } = stubFetch([tokenRoute, ...deleteRoutes("file-1")]);
    const client = createDriveClient(CONFIG, { fetchImpl: impl });

    await client.deleteFile("file-1");
    vi.advanceTimersByTime(30 * 60 * 1000);
    await client.deleteFile("file-1");
    expect(calls.filter((call) => call.url.includes("oauth2"))).toHaveLength(1);

    // The margin: a token five minutes from death is refreshed before it can
    // die inside a running upload.
    vi.advanceTimersByTime(55 * 60 * 1000);
    await client.deleteFile("file-1");
    expect(calls.filter((call) => call.url.includes("oauth2"))).toHaveLength(2);
  });

  it("explains the seven-day Testing-mode trap when Google refuses the refresh", async () => {
    const { impl } = stubFetch([
      {
        match: "oauth2.googleapis.com/token",
        reply: () => Response.json({ error: "invalid_grant" }, { status: 400 }),
      },
    ]);
    const client = createDriveClient(CONFIG, { fetchImpl: impl });
    await expect(client.deleteFile("file-1")).rejects.toThrow(/invalid_grant[\s\S]*7 days[\s\S]*publish/i);
  });

  it("refuses an answer without an access token instead of sending it as blank", async () => {
    const { impl } = stubFetch([
      { match: "oauth2.googleapis.com/token", reply: () => Response.json({ expires_in: 3600 }) },
    ]);
    const client = createDriveClient(CONFIG, { fetchImpl: impl });
    await expect(client.deleteFile("file-1")).rejects.toThrow(/without an access_token/);
  });

  it("mints one fresh token and retries once when the server answers 401", async () => {
    // Each token request hands out the next name, and the DELETE only accepts
    // the second — so the retry only passes if the client really dropped the
    // cached token and came back with a new one.
    const tokens = ["first-token", "second-token"];
    let issued = 0;
    const { impl, calls } = stubFetch([
      { match: "oauth2.googleapis.com/token", reply: () => tokenResponse({ access_token: tokens[Math.min(issued++, 1)] }) },
      {
        match: "files/file-1",
        reply: (init) =>
          new Headers(init?.headers).get("Authorization") === "Bearer second-token"
            ? new Response(null, { status: 204 })
            : new Response(null, { status: 401 }),
      },
    ]);
    const client = createDriveClient(CONFIG, { fetchImpl: impl });
    await client.deleteFile("file-1");
    const deletes = calls.filter((call) => call.url.includes("files/file-1"));
    expect(deletes).toHaveLength(2);
    expect(new Headers(deletes[1].init?.headers).get("Authorization")).toBe("Bearer second-token");
    expect(calls.filter((call) => call.url.includes("oauth2"))).toHaveLength(2);
  });
});

/** Routes the fake Drive uses for permission and delete calls. */
function deleteRoutes(fileId: string) {
  return [
    {
      match: `files/${fileId}/permissions`,
      reply: () => Response.json({ id: fileId, type: "anyone", role: "reader" }),
    },
    { match: `files/${fileId}`, reply: () => new Response(null, { status: 204 }) },
  ];
}

describe("upload", () => {
  const initiateRoute = {
    match: "upload/drive/v3/files",
    reply: () =>
      Response.json({}, { status: 200, headers: { Location: "https://session.example/upload/1" } }),
  };

  it("POSTs metadata with the folder attached, then sends one ranged PUT", async () => {
    const { impl, calls } = stubFetch([
      tokenRoute,
      initiateRoute,
      { match: "session.example", reply: () => Response.json({ id: "file-1", size: "3", md5Hash: "abc" }) },
    ]);
    const client = createDriveClient(CONFIG, { fetchImpl: impl });

    const file = await client.upload({
      name: "posts/member-1/1790-abc.png",
      mimeType: "image/png",
      size: 3,
      body: streamOf(bytes(1, 2, 3)),
    });

    expect(file).toEqual({ id: "file-1", size: "3", md5Hash: "abc" });
    const initiate = calls.find((call) => call.url.includes("upload/drive/v3/files"))!;
    expect(initiate.url).toContain("uploadType=resumable");
    expect(initiate.url).toContain(encodeURIComponent("id,size,md5Hash,mimeType"));
    const metadata = JSON.parse(String(initiate.init?.body));
    expect(metadata).toEqual({ name: "posts/member-1/1790-abc.png", mimeType: "image/png" });

    const chunk = calls.find((call) => call.url.includes("session.example"))!;
    expect(parseContentRange(chunk.init)).toEqual({ start: 0, end: 2, total: 3 });
    expect(new Uint8Array(chunk.init?.body as ArrayBuffer)).toEqual(bytes(1, 2, 3));
  });

  it("adds the configured folder as the file's parent", async () => {
    const { impl, calls } = stubFetch([
      tokenRoute,
      initiateRoute,
      { match: "session.example", reply: () => Response.json({ id: "file-1" }) },
    ]);
    const client = createDriveClient({ ...CONFIG, folderId: "folder-9" }, { fetchImpl: impl });
    await client.upload({ name: "a.png", mimeType: "image/png", size: 1, body: streamOf(bytes(7)) });
    const initiate = calls.find((call) => call.url.includes("upload/drive/v3"))!;
    expect(JSON.parse(String(initiate.init?.body)).parents).toEqual(["folder-9"]);
  });

  it("walks a multi-chunk upload through 308 confirmations to completion", async () => {
    // The heart of resumable upload: every chunk's range, the resume offset
    // the server's Range header dictates, and the completion. A fake that
    // always said 200 would hide an off-by-one in exactly this arithmetic.
    let confirmed = -1;
    const { impl, calls } = stubFetch([
      tokenRoute,
      initiateRoute,
      {
        match: "session.example",
        reply: (init) => {
          const { start, end } = parseContentRange(init);
          // The server confirms each chunk exactly as sent — and, like Drive,
          // finishes the upload itself once the declared total has arrived.
          expect(start).toBe(confirmed + 1);
          confirmed = end;
          if (end === 7) return Response.json({ id: "file-2", size: "8" });
          return new Response(null, { status: 308, headers: { Range: `bytes=0-${end}` } });
        },
      },
    ]);
    // 4-byte chunks split an 8-byte input into two segments.
    const client = createDriveClient(CONFIG, { fetchImpl: impl, chunkSize: 4 });

    const file = await client.upload({
      name: "posts/member-1/movie.mp4",
      mimeType: "video/mp4",
      size: 8,
      // Deliberately split across read() boundaries so the leftover buffer —
      // the part a naive reader drops — is exercised: 3 + 5 bytes.
      body: streamOf(bytes(1, 2, 3), bytes(4, 5, 6, 7, 8)),
    });

    expect(file.id).toBe("file-2");
    const chunks = calls.filter((call) => call.url.includes("session.example"));
    expect(chunks.map((call) => parseContentRange(call.init))).toEqual([
      { start: 0, end: 3, total: 8 },
      { start: 4, end: 7, total: 8 },
    ]);
  });

  it("resends the same chunk when a 308 confirms nothing", async () => {
    let attempts = 0;
    const { impl, calls } = stubFetch([
      tokenRoute,
      initiateRoute,
      {
        match: "session.example",
        reply: () => {
          attempts += 1;
          // First answer: 308 without a Range header — bytes received so far:
          // none. The resend is the same range, and a real server then holds
          // the full two bytes of this single-chunk upload and completes it.
          if (attempts === 1) return new Response(null, { status: 308 });
          return Response.json({ id: "file-3" });
        },
      },
    ]);
    const client = createDriveClient(CONFIG, { fetchImpl: impl, chunkSize: 2 });

    const file = await client.upload({ name: "a", mimeType: "image/png", size: 2, body: streamOf(bytes(1, 2)) });
    expect(file.id).toBe("file-3");
    const chunks = calls.filter((call) => call.url.includes("session.example"));
    // First PUT: unanswered. Second: the same bytes again, now confirmed.
    expect(chunks).toHaveLength(2);
    expect(parseContentRange(chunks[0].init)).toEqual(parseContentRange(chunks[1].init));
  });

  it("gives up after three unanswered chunk PUTs instead of looping forever", async () => {
    const { impl } = stubFetch([
      tokenRoute,
      initiateRoute,
      { match: "session.example", reply: () => new Response(null, { status: 308 }) },
    ]);
    const client = createDriveClient(CONFIG, { fetchImpl: impl, chunkSize: 2 });
    await expect(
      client.upload({ name: "a", mimeType: "image/png", size: 2, body: streamOf(bytes(1, 2)) }),
    ).rejects.toThrow(/stalled/);
  });

  it("abandons a session the server partially confirmed rather than stitch bytes", async () => {
    // The stream can only move forward, so a partial confirmation cannot be
    // resumed from here — and silently continuing would corrupt the file. The
    // archive's promise is byte-identical copies, so the only correct answer
    // is to fail this object and let the next run start a fresh session.
    const { impl } = stubFetch([
      tokenRoute,
      initiateRoute,
      // Confirms only byte 0 of a two-byte chunk that was fully sent.
      { match: "session.example", reply: () => new Response(null, { status: 308, headers: { Range: "bytes=0-0" } }) },
    ]);
    const client = createDriveClient(CONFIG, { fetchImpl: impl, chunkSize: 2 });
    await expect(
      client.upload({ name: "a", mimeType: "image/png", size: 4, body: streamOf(bytes(1, 2, 3, 4)) }),
    ).rejects.toThrow(/abandoning session/);
  });

  it("fails loudly — before sending anything — when the body is shorter than the size R2 reported", async () => {
    const { impl, calls } = stubFetch([tokenRoute, initiateRoute]);
    const client = createDriveClient(CONFIG, { fetchImpl: impl, chunkSize: 4 });
    // R2 says 4 bytes, the stream delivers 2 — the discrepancy the size
    // verification in the archive pass depends on being *caught*, not skipped.
    // No PUT is made: a range naming bytes the buffer does not hold would let
    // Drive record a file padded with whatever trailed the body.
    await expect(
      client.upload({ name: "a", mimeType: "image/png", size: 4, body: streamOf(bytes(1, 2)) }),
    ).rejects.toThrow(/stream ended after 2 of the 4 bytes/);
    const chunks = calls.filter((call) => call.url.includes("session.example"));
    expect(chunks).toHaveLength(0);
  });

  it("surfaces a non-308 chunk failure with its status and body", async () => {
    const { impl } = stubFetch([
      tokenRoute,
      initiateRoute,
      { match: "session.example", reply: () => Response.json({ error: "expired" }, { status: 404 }) },
    ]);
    const client = createDriveClient(CONFIG, { fetchImpl: impl });
    await expect(
      client.upload({ name: "a", mimeType: "image/png", size: 1, body: streamOf(bytes(1)) }),
    ).rejects.toThrow(/chunk failed \(404\).*expired/);
  });

  it("fails at initiation when Drive refuses the session, with the reason", async () => {
    const { impl } = stubFetch([
      tokenRoute,
      { match: "upload/drive/v3/files", reply: () => Response.json({ error: "quota" }, { status: 403 }) },
    ]);
    const client = createDriveClient(CONFIG, { fetchImpl: impl });
    await expect(
      client.upload({ name: "a", mimeType: "image/png", size: 1, body: streamOf(bytes(1)) }),
    ).rejects.toThrow(/failed to start \(403\).*quota/);
  });

  it("uploads a zero-byte object with the protocol's wildcard range", async () => {
    const { impl, calls } = stubFetch([
      tokenRoute,
      initiateRoute,
      { match: "session.example", reply: () => Response.json({ id: "empty" }) },
    ]);
    const client = createDriveClient(CONFIG, { fetchImpl: impl });
    const file = await client.upload({
      name: "a",
      mimeType: "application/octet-stream",
      size: 0,
      body: streamOf(),
    });
    expect(file.id).toBe("empty");
    const chunk = calls.find((call) => call.url.includes("session.example"))!;
    expect(new Headers(chunk.init?.headers).get("Content-Range")).toBe("bytes */0");
  });
});

describe("makePublic", () => {
  it("asks for exactly a world-readable reader permission", async () => {
    const { impl, calls } = stubFetch([tokenRoute, ...deleteRoutes("file-1")]);
    const client = createDriveClient(CONFIG, { fetchImpl: impl });
    await client.makePublic("file-1");
    const call = calls.find((entry) => entry.url.includes("/permissions"))!;
    expect(call.init?.method).toBe("POST");
    expect(JSON.parse(String(call.init?.body))).toEqual({ type: "anyone", role: "reader" });
  });

  it("treats 409 as already public — the state a retried pass leaves behind", async () => {
    const { impl } = stubFetch([
      tokenRoute,
      { match: "/permissions", reply: () => Response.json({}, { status: 409 }) },
    ]);
    const client = createDriveClient(CONFIG, { fetchImpl: impl });
    await expect(client.makePublic("file-1")).resolves.toBeUndefined();
  });

  it("fails on any other refusal so the pass never writes a URL nobody can read", async () => {
    const { impl } = stubFetch([
      tokenRoute,
      { match: "/permissions", reply: () => Response.json({ error: "sharing disabled" }, { status: 403 }) },
    ]);
    const client = createDriveClient(CONFIG, { fetchImpl: impl });
    await expect(client.makePublic("file-1")).rejects.toThrow(/permission change failed \(403\)/);
  });
});

describe("deleteFile", () => {
  it("treats 404 as success, like deleting an absent R2 key", async () => {
    const { impl } = stubFetch([
      tokenRoute,
      { match: "files/gone", reply: () => new Response(null, { status: 404 }) },
    ]);
    const client = createDriveClient(CONFIG, { fetchImpl: impl });
    await expect(client.deleteFile("gone")).resolves.toBeUndefined();
  });

  it("surfaces any other failure for the caller's warning log", async () => {
    const { impl } = stubFetch([
      tokenRoute,
      { match: "files/file-1", reply: () => Response.json({ error: "boom" }, { status: 500 }) },
    ]);
    const client = createDriveClient(CONFIG, { fetchImpl: impl });
    await expect(client.deleteFile("file-1")).rejects.toThrow(/delete failed for "file-1" \(500\)/);
  });
});

describe("DRIVE_SCOPE", () => {
  it("is the full Drive scope the consent helper requests verbatim", () => {
    // `scripts/gdrive-auth.mjs` builds the consent URL from this same string;
    // asserting it here keeps the two from drifting into a consent that
    // silently asks for less than the archive needs.
    expect(DRIVE_SCOPE).toBe("https://www.googleapis.com/auth/drive");
  });
});
