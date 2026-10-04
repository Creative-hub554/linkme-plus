// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanupSurfaces, mountSurface, type MountedSurface } from "@/test/render";
import { ProfileAvatarUpload } from "@/components/profile/profile-avatar-upload";

/**
 * The avatar uploader, driven through the file input it hides behind a button.
 *
 * The subject is the ladder of checks the widget makes before and after the
 * upload: a non-image is refused before anything is sent, an oversized one is
 * refused before anything is sent, and each HTTP answer — 401, 503, an ok
 * response with no URL, a generic failure — becomes the sentence the reader
 * sees rather than a raw status. The session refresh behind a successful upload
 * is the one other side effect, and it is allowed to fail.
 *
 * `URL.createObjectURL` does not exist in jsdom, and the only thing the widget
 * does with a real one is set it as an `src` and revoke it, so it is stubbed.
 */
const mocks = vi.hoisted(() => ({
  refreshSession: vi.fn(async () => ({ data: {} })),
}));

vi.mock("@/utils/supabase/client", () => ({
  createClient: () => ({ auth: { refreshSession: mocks.refreshSession } }),
}));

function photo(name = "me.png", type = "image/png"): File {
  return new File([new Uint8Array(16)], name, { type });
}

/** An oversized file without allocating ten megabytes of bytes. */
function oversizedPhoto(): File {
  const file = photo("huge.png");
  Object.defineProperty(file, "size", { value: 11 * 1024 * 1024 });
  return file;
}

function inputOf(ui: MountedSurface): HTMLInputElement {
  const input = ui.container.querySelector("input[type=file]");
  if (!input) throw new Error("the uploader rendered no file input");
  return input as HTMLInputElement;
}

function choose(ui: MountedSurface, file: File) {
  return ui.chooseFiles(inputOf(ui), [file]);
}

beforeEach(() => {
  mocks.refreshSession.mockClear();
  mocks.refreshSession.mockResolvedValue({ data: {} });
  URL.createObjectURL = vi.fn(() => "blob:avatar") as unknown as typeof URL.createObjectURL;
  URL.revokeObjectURL = vi.fn() as unknown as typeof URL.revokeObjectURL;
});

afterEach(() => {
  cleanupSurfaces();
  vi.unstubAllGlobals();
});

describe("ProfileAvatarUpload", () => {
  test("shows the member's initials when there is no photo", () => {
    const ui = mountSurface(<ProfileAvatarUpload name="Maya Chen" />, { providers: "none" });
    expect(ui.container.textContent).toContain("MC");
  });

  test("falls back to a single initial for a one-word name", () => {
    const ui = mountSurface(<ProfileAvatarUpload name="theo" />, { providers: "none" });
    expect(ui.container.textContent).toContain("T");
  });

  test("falls back to U for a name with no letters", () => {
    const ui = mountSurface(<ProfileAvatarUpload name="   " />, { providers: "none" });
    expect(ui.container.textContent).toContain("U");
  });

  test("refuses a non-image before sending anything", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const ui = mountSurface(<ProfileAvatarUpload name="Maya Chen" />, { providers: "none" });
    await choose(ui, photo("notes.pdf", "application/pdf"));
    await ui.waitFor(() => ui.container.textContent?.includes("Choose an image file.") ?? false, {
      description: "the not-an-image message",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("refuses a photo over ten megabytes before sending anything", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const ui = mountSurface(<ProfileAvatarUpload name="Maya Chen" />, { providers: "none" });
    await choose(ui, oversizedPhoto());
    await ui.waitFor(() => ui.container.textContent?.includes("10 MB or smaller") ?? false, {
      description: "the size message",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("uploads, reports the new photo and refreshes the session", async () => {
    const onUploaded = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ avatarUrl: "https://cdn.example/me.png" }), { status: 200 })),
    );
    const ui = mountSurface(<ProfileAvatarUpload name="Maya Chen" onUploaded={onUploaded} />, { providers: "none" });
    await choose(ui, photo());
    await ui.waitFor(() => ui.container.textContent?.includes("Profile photo updated.") ?? false, {
      description: "the success notice",
    });
    expect(onUploaded).toHaveBeenCalledWith("https://cdn.example/me.png");
    expect(mocks.refreshSession).toHaveBeenCalledTimes(1);
  });

  test("still reports success when the session refresh fails", async () => {
    mocks.refreshSession.mockRejectedValueOnce(new Error("offline"));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ avatarUrl: "https://cdn.example/me.png" }), { status: 200 })),
    );
    const ui = mountSurface(<ProfileAvatarUpload name="Maya Chen" />, { providers: "none" });
    await choose(ui, photo());
    await ui.waitFor(() => ui.container.textContent?.includes("Profile photo updated.") ?? false, {
      description: "the success notice despite the refresh failing",
    });
  });

  test("explains an expired session on a 401", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({}), { status: 401 })));
    const ui = mountSurface(<ProfileAvatarUpload name="Maya Chen" />, { providers: "none" });
    await choose(ui, photo());
    await ui.waitFor(() => ui.container.textContent?.includes("Your session expired") ?? false, {
      description: "the expired-session message",
    });
  });

  test("shows the server's reason when storage is unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "Photo storage is off" }), { status: 503 })),
    );
    const ui = mountSurface(<ProfileAvatarUpload name="Maya Chen" />, { providers: "none" });
    await choose(ui, photo());
    await ui.waitFor(() => ui.container.textContent?.includes("Photo storage is off") ?? false, {
      description: "the storage message",
    });
  });

  test("falls back to a generic storage message on a 503 with no body", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({}), { status: 503 })));
    const ui = mountSurface(<ProfileAvatarUpload name="Maya Chen" />, { providers: "none" });
    await choose(ui, photo());
    await ui.waitFor(() => ui.container.textContent?.includes("temporarily unavailable") ?? false, {
      description: "the generic storage message",
    });
  });

  test("complains when a successful answer carries no photo URL", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })));
    const ui = mountSurface(<ProfileAvatarUpload name="Maya Chen" />, { providers: "none" });
    await choose(ui, photo());
    await ui.waitFor(() => ui.container.textContent?.includes("without a photo URL") ?? false, {
      description: "the missing-url message",
    });
  });

  test("shows the server's reason on a generic failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "Nope" }), { status: 422 })),
    );
    const ui = mountSurface(<ProfileAvatarUpload name="Maya Chen" />, { providers: "none" });
    await choose(ui, photo());
    await ui.waitFor(() => ui.container.textContent?.includes("Nope") ?? false, {
      description: "the server's reason",
    });
  });

  test("falls back to a generic failure message with no body", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({}), { status: 422 })));
    const ui = mountSurface(<ProfileAvatarUpload name="Maya Chen" />, { providers: "none" });
    await choose(ui, photo());
    await ui.waitFor(() => ui.container.textContent?.includes("Unable to save profile photo") ?? false, {
      description: "the generic failure message",
    });
  });

  test("accepts an existing photo without a preview", () => {
    // Radix's avatar shows its fallback until the image itself has loaded, and
    // jsdom never loads one — so what this asserts is that the component hands
    // the stored URL to the avatar rather than crashing on it.
    const ui = mountSurface(
      <ProfileAvatarUpload name="Maya Chen" avatarUrl="https://cdn.example/old.png" />,
      { providers: "none" },
    );
    expect(ui.container.textContent).toContain("Upload profile photo");
  });
});
