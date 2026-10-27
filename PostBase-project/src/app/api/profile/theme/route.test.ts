import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The theme studio's persistence route, driven through the handlers.
 *
 * `GET` answers with the stored config or explicit `null` — the editor falls
 * back to the Standard defaults itself, so it must be able to tell "unset" from
 * "stored". `POST` takes the config plus decoration files, pairs each staged
 * (`url: null`) decoration with the file at its position, uploads before
 * writing so a failed upload cannot leave a half-saved config, replaces the
 * stored config in one update, and deletes the decoration objects the replaced
 * config held but the new one dropped — the same lifecycle the cover-config
 * route gives replaced photos.
 *
 * The last describe drives the real `ensureLocalUserProfile` (un-mocked, against
 * the fake db) through the `GET` handler, the way an email sign-up reaches the
 * route: no profile row exists yet, provisioning creates one, and the answer is
 * the Standard config the column's default seeds — proving the seed lives in
 * the schema/migration contract, not in any write this request makes.
 */
vi.mock("@/lib/db", async () => {
  const { fakeDb } = await import("@/test/fake-db");
  return {
    db: fakeDb,
    withDbRetry: (operation: () => unknown) => operation(),
  };
});

const session = vi.hoisted(() => ({ userId: "member-1" as string | null }));

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: async () => (session.userId ? { user: { id: session.userId } } : null),
    },
  },
}));

vi.mock("@/lib/db/ensure-profile", () => ({
  // Typed so a test can delegate to the real implementation through the mock.
  ensureLocalUserProfile: vi.fn(async (_user: unknown) => {}),
}));

vi.mock("@/lib/r2", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/r2")>();
  return {
    ...actual,
    assertStorageConfigured: vi.fn(),
    putObject: vi.fn(async () => {}),
    deleteStoredObjects: vi.fn(async () => [] as string[]),
  };
});

vi.mock("@/lib/profile-theme", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/profile-theme")>();
  return {
    ...actual,
    // Every test uses the real validator. One test stubs its answer so the
    // route's own decoration-count guard can be reached: a config the validator
    // accepts is capped at the same maximum, so no real request can exceed it.
    normalizeProfileThemeConfig: vi.fn(actual.normalizeProfileThemeConfig),
  };
});

import { GET, POST } from "./route";
import { ensureLocalUserProfile } from "@/lib/db/ensure-profile";
import { profiles, users } from "@/lib/db/schema";
import { assertStorageConfigured, deleteStoredObjects, putObject } from "@/lib/r2";
import { fakeDb, resetFakeDb } from "@/test/fake-db";
import {
  defaultProfileThemeBlocks,
  MAX_PROFILE_THEME_DECORATIONS,
  normalizeProfileThemeConfig,
  profileThemeLayouts,
  profileThemeStyles,
  standardProfileThemeConfig,
} from "@/lib/profile-theme";
import { expectGatedInsert, expectGatedNone, expectGatedRead, expectGatedSequence } from "@/test/expect-gated";

const OLD_DECORATION = "https://test.r2.dev/profile-photos/member-1/petal.png";
const KEPT_DECORATION = "https://test.r2.dev/profile-photos/member-1/star.png";

/** The smallest config the model accepts, with no staged decorations. */
const VALID_CONFIG = {
  layoutId: profileThemeLayouts[0]!.id,
  styleId: profileThemeStyles[0]!.id,
  standard: false,
  motion: true,
  blocks: defaultProfileThemeBlocks,
  decorations: [{ id: "deco-kept", url: KEPT_DECORATION, zone: "corner-top-left" }],
};

/** The same config, one decoration restaged: null url, file pending. */
function configWithOneStaged() {
  return {
    ...VALID_CONFIG,
    decorations: [{ id: "deco-new", url: null, zone: "corner-top-right" }],
  };
}

function imageFile(name: string) {
  return new File(["decoration-bytes"], name, { type: "image/png" });
}

function saveRequest(config: unknown, decorations: File[] = []) {
  const form = new FormData();
  form.append("config", typeof config === "string" ? config : JSON.stringify(config));
  for (const decoration of decorations) form.append("decorations", decoration);
  return new Request("http://localhost/api/profile/theme", { method: "POST", body: form });
}

beforeEach(() => {
  resetFakeDb();
  vi.clearAllMocks();
  session.userId = "member-1";
});

describe("GET /api/profile/theme", () => {
  it("requires a session before reading anything", async () => {
    session.userId = null;

    const response = await GET(new Request("http://localhost/api/profile/theme", { method: "GET" }));

    expect(response.status).toBe(401);
    expectGatedNone("reads");
  });

  it("answers null when no theme has been stored yet", async () => {
    fakeDb.selectReturns(profiles, [{ themeConfig: null }]);

    const response = await GET(new Request("http://localhost/api/profile/theme", { method: "GET" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ themeConfig: null });
  });

  it("answers with the stored config", async () => {
    fakeDb.selectReturns(profiles, [{ themeConfig: VALID_CONFIG }]);

    const response = await GET(new Request("http://localhost/api/profile/theme", { method: "GET" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ themeConfig: VALID_CONFIG });
  });

  it("answers 503 when the read fails, rather than inventing a stored theme", async () => {
    fakeDb.failNextSelect(profiles);

    const response = await GET(new Request("http://localhost/api/profile/theme", { method: "GET" }));

    expect(response.status).toBe(503);
  });
});

/**
 * A profile provisioned by this very request: the local user record exists
 * (sign-up made it through GoTrue in this branch), the profile row does not.
 */
const withProfilePendingProvisioning = async () => {
  const actual = await vi.importActual<typeof import("@/lib/db/ensure-profile")>("@/lib/db/ensure-profile");
  vi.mocked(ensureLocalUserProfile).mockImplementationOnce((user: unknown) =>
    actual.ensureLocalUserProfile(user as Parameters<typeof actual.ensureLocalUserProfile>[0]),
  );
  return fakeDb;
};

describe("a newly provisioned profile", () => {
  it("keeps the seed in the schema contract, not in any write", () => {
    // What a first-time reader meets is not placed by `ensureLocalUserProfile`
    // or by either route method: the column itself is `NOT NULL DEFAULT` with
    // the Standard config (migration 0014, and the drizzle schema they share).
    // If either party later writes the config explicitly, the seed stops being
    // the one migration 0014 shipped and these are the two flags that lied.
    expect(profiles.themeConfig.notNull).toBe(true);
    expect(profiles.themeConfig.hasDefault).toBe(true);
    expect(standardProfileThemeConfig.standard).toBe(true);
  });

  it("answers the seeded Standard config for a profile this GET provisioned", async () => {
    await withProfilePendingProvisioning();
    // The provisioning sequence in order: the local user exists, the profile
    // row does not, the insert runs, and the route's read then sees the row a
    // real database hands back with the column default filled in. The repair
    // step makes one read per table; the route's own read is the second read of
    // `profiles`.
    fakeDb
      .selectReturns(users, [{ id: "member-1" }])
      .selectReturns(profiles, [])
      .selectReturns(profiles, [{ themeConfig: standardProfileThemeConfig }]);

    const response = await GET(new Request("http://localhost/api/profile/theme", { method: "GET" }));

    expect(response.status).toBe(200);
    // The exact shape a saved theme uses — the editor opened the studio from
    // this answer alone, no separate "nothing stored yet" case.
    expect(await response.json()).toEqual({ themeConfig: standardProfileThemeConfig });

    // The provisioning insert named no themeConfig at all: an exact match pins
    // the omission, so the value behind what GET read can only have come from
    // the column default the two statements above pin.
    expectGatedInsert(profiles, {
      values: { userId: "member-1", displayName: "Member", avatarUrl: null },
    });
    // Both profile reads are gated to the signed-in member — the repair step's
    // and the route's own.
    expectGatedRead(profiles, { where: '"user_id" = $1', params: ["member-1"] });
    expectGatedRead(profiles, { nth: 1, where: '"user_id" = $1', params: ["member-1"] });
  });

  it("answers the seeded Standard config when the records do not exist at all", async () => {
    await withProfilePendingProvisioning();
    // An email sign-up can reach the route before any local record exists, so
    // provisioning inserts the user row first and the profile row after it.
    // Neither insert may carry a themeConfig: both values come from defaults,
    // and the profile's is the Standard config the reader is handed.
    fakeDb
      .selectReturns(users, [])
      .selectReturns(users, [{ id: "member-1" }])
      .selectReturns(profiles, [])
      .selectReturns(profiles, [{ themeConfig: standardProfileThemeConfig }]);

    const response = await GET(new Request("http://localhost/api/profile/theme", { method: "GET" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ themeConfig: standardProfileThemeConfig });
    expectGatedSequence("writes", [
      {
        table: "users",
        values: {
          id: "member-1",
          email: "member@local.invalid",
          username: "member",
          emailVerified: expect.any(Date),
        },
      },
      { table: "profiles", values: { userId: "member-1", displayName: "Member", avatarUrl: null } },
    ]);
  });
});

describe("POST /api/profile/theme", () => {
  it("requires a session before touching anything", async () => {
    session.userId = null;

    const response = await POST(saveRequest(VALID_CONFIG));

    expect(response.status).toBe(401);
    expectGatedNone("writes");
  });

  it("refuses a multipart body without a config", async () => {
    const form = new FormData();
    const response = await POST(new Request("http://localhost/api/profile/theme", { method: "POST", body: form }));

    expect(response.status).toBe(500);
    expectGatedNone("writes");
  });

  it("answers 500 with the parse message when the config is not JSON", async () => {
    const response = await POST(saveRequest("not json"));

    // The parse failure is answered by its own message, not by the outer
    // handler carrying whatever `JSON.parse` happened to throw.
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Theme configuration must be valid JSON" });
    expect(putObject).not.toHaveBeenCalled();
    expectGatedNone("writes");
  });

  it("refuses a config the model does not accept, uploading and writing nothing", async () => {
    for (const broken of [
      "not json",
      JSON.stringify({ ...VALID_CONFIG, layoutId: "floating-layout" }),
      JSON.stringify({ ...VALID_CONFIG, standard: "yes" }),
      JSON.stringify({ ...VALID_CONFIG, decorations: [{ id: "d", url: "petal.png", zone: "corner-top-left" }] }),
    ]) {
      const response = await POST(saveRequest(broken));
      expect(response.status).toBe(500);
    }
    expect(putObject).not.toHaveBeenCalled();
    expectGatedNone("writes");
  });

  it("requires every staged decoration's file, one file per null url", async () => {
    const response = await POST(saveRequest(configWithOneStaged()));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "Every unsaved decoration needs its file" });
    expect(putObject).not.toHaveBeenCalled();
    expectGatedNone("writes");
  });

  it("refuses more decoration files than the studio allows, before uploading", async () => {
    // A config the validator accepts never carries more than the maximum, so
    // this count guard is unreachable through a real request; the validator's
    // own cap is pinned in its own test. Stubbing the accepted answer pins the
    // route's last-line refusal, which must not fall through to the upload path.
    const staged = Array.from({ length: MAX_PROFILE_THEME_DECORATIONS + 1 }, (_, index) => ({
      id: `deco-${index}`,
      url: null,
      zone: "corner-top-left" as const,
    }));
    vi.mocked(normalizeProfileThemeConfig).mockReturnValueOnce({
      ...VALID_CONFIG,
      decorations: staged.map((decoration) => ({
        ...decoration,
        url: "https://placeholder.invalid/decoration",
      })),
    });

    const response = await POST(
      saveRequest(
        { ...VALID_CONFIG, decorations: staged },
        staged.map((_, index) => imageFile(`deco-${index}.png`)),
      ),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: `You can pin up to ${MAX_PROFILE_THEME_DECORATIONS} decorations`,
    });
    expect(putObject).not.toHaveBeenCalled();
    expectGatedNone("writes");
  });

  it("uploads staged decoration files in order and stores the finished config", async () => {
    fakeDb.selectReturns(profiles, [{ themeConfig: null }]);

    const response = await POST(
      saveRequest(configWithOneStaged(), [imageFile("petal.png")]),
    );

    expect(response.status).toBe(201);
    expect(putObject).toHaveBeenCalledTimes(1);
    const { themeConfig } = (await response.json()) as { themeConfig: { decorations: Array<{ url: string }>; blocks: unknown; standard: boolean } };
    // The null became the uploaded URL, in file order.
    expect(themeConfig.decorations).toEqual([{ id: "deco-new", url: expect.stringContaining("/profile-photos/member-1/"), zone: "corner-top-right" }]);
    expect(themeConfig.standard).toBe(false);
    expectGatedSequence("writes", [
      { table: "profiles", values: { themeConfig } },
    ]);
  });

  it("keeps already-stored decoration urls when they are still in the config", async () => {
    fakeDb.selectReturns(profiles, [{ themeConfig: VALID_CONFIG }]);

    const response = await POST(saveRequest(VALID_CONFIG));

    expect(response.status).toBe(201);
    expect(putObject).not.toHaveBeenCalled();
    const { themeConfig } = (await response.json()) as { themeConfig: { decorations: Array<{ url: string; id: string }> } };
    expect(themeConfig.decorations).toEqual([{ id: "deco-kept", url: KEPT_DECORATION, zone: "corner-top-left" }]);
  });

  it("deletes decoration objects the replaced config held and the new one dropped", async () => {
    fakeDb.selectReturns(profiles, [
      {
        themeConfig: {
          ...VALID_CONFIG,
          decorations: [
            { id: "old-one", url: OLD_DECORATION, zone: "corner-top-left" },
            { id: "deco-kept", url: KEPT_DECORATION, zone: "corner-top-left" },
          ],
        },
      },
    ]);

    const response = await POST(saveRequest(VALID_CONFIG));

    expect(response.status).toBe(201);
    // Only the dropped object: the kept decoration keeps its URL and keeps its
    // bytes.
    expect(vi.mocked(deleteStoredObjects)).toHaveBeenCalledWith([OLD_DECORATION]);
  });

  it("deletes nothing when the first save replaces nothing", async () => {
    fakeDb.selectReturns(profiles, [{ themeConfig: null }]);

    const response = await POST(saveRequest(VALID_CONFIG));

    expect(response.status).toBe(201);
    expect(vi.mocked(deleteStoredObjects)).toHaveBeenCalledWith([]);
  });

  it("answers 503 when decoration storage is not configured, before any write", async () => {
    fakeDb.selectReturns(profiles, [{ themeConfig: null }]);
    vi.mocked(assertStorageConfigured).mockImplementationOnce(() => {
      throw new Error("Storage is not configured");
    });

    const response = await POST(
      saveRequest(configWithOneStaged(), [imageFile("petal.png")]),
    );

    expect(response.status).toBe(503);
    expect(putObject).not.toHaveBeenCalled();
    expectGatedNone("writes");
  });

  it("refuses a decoration file that is not an image, before any write", async () => {
    const response = await POST(
      saveRequest(
        {
          ...VALID_CONFIG,
          decorations: [{ id: "deco-gif", url: null, zone: "corner-top-left" }],
        },
        [new File(["bytes"], "note.pdf", { type: "application/pdf" })],
      ),
    );

    // The generic file validator rejects the type first; either way nothing
    // was written and nothing was stored.
    expect([400, 500]).toContain(response.status);
    expect(putObject).not.toHaveBeenCalled();
    expectGatedNone("writes");
  });

  it("saves the Standard view: the theme off, no uploads", async () => {
    fakeDb.selectReturns(profiles, [{ themeConfig: VALID_CONFIG }]);

    const response = await POST(saveRequest({ ...VALID_CONFIG, standard: true, motion: false, decorations: [] }));

    expect(response.status).toBe(201);
    const { themeConfig } = (await response.json()) as { themeConfig: { standard: boolean } };
    expect(themeConfig.standard).toBe(true);
  });
});
