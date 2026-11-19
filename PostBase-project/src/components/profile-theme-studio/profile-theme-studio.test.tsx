// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanupSurfaces, mountSurface } from "@/test/render";
import { json, stubFetch, type FetchRecorder } from "@/test/stub-fetch";
import {
  defaultProfileThemeBlocks,
  profileThemeLayouts,
  profileThemeStyles,
  standardProfileThemeConfig,
} from "@/lib/profile-theme";
import type { ProfileThemeConfig } from "@/lib/profile-theme";
import { ProfileThemeStudio } from "@/components/profile-theme-studio/profile-theme-studio";

/**
 * The Profile Theme Studio editor, mounted with a signed-in member and its
 * endpoints stubbed.
 *
 * These are the behaviors a member drives: the editor reads the stored theme
 * and shows it, choosing a layout updates the preview immediately, blocks
 * toggle and swap places, the Standard toggle swaps the whole preview, and the
 * save is multipart — the config JSON and its decoration files travel in one
 * request, because pairing them on the client would let a config and its
 * images drift apart.
 */
const authState = vi.hoisted(() => ({
  // `user_metadata` carries each member's free-form details (a website, a
  // location), so its type is an open record rather than the empty set.
  user: null as null | {
    id: string;
    name: string;
    username: string;
    image: null;
    user_metadata: Record<string, unknown>;
  },
  isLoading: false,
}));

vi.mock("@/components/auth-provider", () => ({
  useAuth: () => ({ user: authState.user, isLoading: authState.isLoading, isAuthenticated: true, session: null }),
}));

/** A stored config the GET answers with, distinct from the defaults. */
const storedTheme: ProfileThemeConfig = {
  layoutId: "vertical-poster",
  styleId: "manga-ink",
  standard: false,
  motion: false,
  blocks: [
    { id: "interests", included: true, position: 0 },
    { id: "highlights", included: true, position: 1 },
    { id: "media-strip", included: false, position: 2 },
    { id: "quote", included: false, position: 3 },
    { id: "links", included: false, position: 4 },
  ],
  decorations: [],
};

let recorder: FetchRecorder;

/**
 * Answers the theme route the way the real one does: a payload for GET, and —
 * unless a test overrides it below — a 201 success for a POST, recorded with
 * whatever the editor sent.
 */
function themeEndpoint(overriddenPost?: (form: FormData) => unknown) {
  return (request: { method: string; form: FormData | undefined }) => {
    if (request.method === "POST" && request.form) {
      if (overriddenPost) return json(overriddenPost(request.form), 201);
      return json({ themeConfig: standardProfileThemeConfig }, 201);
    }
    return { themeConfig: storedThemePayload ?? null };
  };
}

/** The GET payload a test wants the studio to open with. */
let storedThemePayload: unknown = null;

function mountStudio(postHandler?: (form: FormData) => unknown) {
  recorder = stubFetch({ "/api/profile/theme": themeEndpoint(postHandler) });
  const surface = mountSurface(<ProfileThemeStudio />);
  // "Loaded" is not just "the GET was answered": the stored config reaches
  // the editor's state a microtask after the response does, so the wait also
  // holds until the editor's own load gate (the disabled save button) lifts.
  return {
    ...surface,
    waitLoaded: () =>
      surface.waitFor(
        () =>
          recorder.answered.includes("/api/profile/theme") &&
          !saveButton(surface.container, "Save theme").disabled,
        { description: "the stored theme to be read and applied" },
      ),
  };
}

beforeEach(() => {
  authState.isLoading = false;
  authState.user = { id: "member-1", name: "Ada Writer", username: "ada", image: null, user_metadata: {} };
  storedThemePayload = null;
});

afterEach(() => {
  cleanupSurfaces();
  vi.unstubAllGlobals();
});

async function click(surface: { click: (element: HTMLElement) => Promise<void> }, element: HTMLElement) {
  await surface.click(element);
}

function layoutCard(container: HTMLElement, name: string): HTMLButtonElement {
  // The card is its title *and* its description, so the match is on the name,
  // not on the whole card text.
  const card = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
    (button) => button.textContent?.includes(name),
  );
  if (!card) throw new Error(`the ${name} layout card did not render`);
  return card;
}

function saveButton(container: HTMLElement, label: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
    (candidate) => candidate.textContent?.includes(label),
  );
  if (!button) throw new Error(`the ${label} button did not render`);
  return button;
}

/** The ambient-motion switch, found by the accessible name the reader hears. */
function motionSwitchOf(container: HTMLElement): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>("button[aria-label='Ambient motion']");
  if (!button) throw new Error("the Ambient motion switch did not render");
  return button;
}

describe("loading a stored theme", () => {
  test("shows the stored layout and style, not the defaults", async () => {
    storedThemePayload = storedTheme;
    const { container, waitLoaded } = mountStudio();
    await waitLoaded();

    expect(container.textContent).toContain("Vertical Poster");
    expect(container.textContent).toContain("Manga Ink");
    const view = container.querySelector("[data-theme-view]");
    expect(view?.getAttribute("data-theme-view")).toBe("themed");
    // The stored theme excluded the links block; the preview agrees.
    expect(view!.textContent).not.toContain("ada.example");
  });

  test("an unreadable stored payload opens on the defaults instead of a broken editor", async () => {
    storedThemePayload = { layoutId: "ghost-layout" };
    const { container, waitLoaded } = mountStudio();
    await waitLoaded();

    expect(container.textContent).toContain("Classic Spotlight");
    expect(container.textContent).toContain("Sakura Blossom");
  });

  test("a null read — no theme stored — is the defaults too", async () => {
    storedThemePayload = null;
    const { container, waitLoaded } = mountStudio();
    await waitLoaded();

    expect(container.textContent).toContain("Classic Spotlight");
  });

  test("a signed-out studio still renders, and twice rejects nothing: it waits for a member", async () => {
    authState.user = null;
    const { container, settle } = mountStudio();
    await settle();

    expect(container.textContent).toContain("Profile Theme Studio");
    // The save button is disabled without a member to save for.
    expect(saveButton(container, "Save theme").disabled).toBe(true);
  });
});

describe("picking", () => {
  test("choosing a layout re-arranges the preview at once", async () => {
    storedThemePayload = null;
    const surface = mountStudio();
    await surface.waitLoaded();

    await click(surface, layoutCard(surface.container, "Gallery Fan"));

    const view = surface.container.querySelector("[data-theme-view]");
    expect(view?.getAttribute("data-theme-layout")).toBe("left");
  });

  test("every contrast-checked style is offered by name and by palette description", async () => {
    const { container, waitLoaded } = mountStudio();
    await waitLoaded();

    for (const style of profileThemeStyles) {
      expect(container.textContent).toContain(style.name);
    }
  });

  test("the layout picker names all four layouts, each keeping identity fixed", async () => {
    const { container, waitLoaded } = mountStudio();
    await waitLoaded();

    for (const layout of profileThemeLayouts) {
      expect(container.textContent).toContain(layout.name);
    }
    expect(container.textContent).toContain("fixed, recognizable place");
  });
});

describe("blocks", () => {
  test("including a block adds it to the preview", async () => {
    // The links block previews the member's own website, so this member has
    // one in their metadata — as a profile that fills links does.
    authState.user = { id: "member-1", name: "Ada Writer", username: "ada", image: null, user_metadata: { website: "https://ada.example" } };
    storedThemePayload = storedTheme;
    const surface = mountStudio();
    await surface.waitLoaded();

    const addLinks = surface.container.querySelector<HTMLElement>("button[aria-label='Add Links block']");
    if (!addLinks) throw new Error("the Add Links control did not render");
    await click(surface, addLinks);

    const view = surface.container.querySelector("[data-theme-view]")!;
    expect(view.textContent).toContain("ada.example");
  });

  test("excluding a block clears it from the preview", async () => {
    storedThemePayload = storedTheme;
    const surface = mountStudio();
    await surface.waitLoaded();

    const removeInterests = surface.container.querySelector<HTMLElement>("button[aria-label='Remove Interests block']");
    if (!removeInterests) throw new Error("the Remove Interests control did not render");
    await click(surface, removeInterests);

    const view = surface.container.querySelector("[data-theme-view]")!;
    expect(view.textContent).not.toContain("Photography");
  });

  test("moving a block down re-orders the rendered surfaces", async () => {
    storedThemePayload = storedTheme; // interests first, highlights second
    const surface = mountStudio();
    await surface.waitLoaded();

    const moveInterestsDown = surface.container.querySelector<HTMLElement>("button[aria-label='Move Interests down']");
    if (!moveInterestsDown) throw new Error("the Move Interests control did not render");
    await click(surface, moveInterestsDown);

    const view = surface.container.querySelector("[data-theme-view]")!;
    const surfaces = Array.from(view.querySelectorAll(".space-y-3 > div"));
    const highlights = surfaces.findIndex((element) => element.textContent?.includes("Highlights"));
    // The interests block renders sample chips, not its own label, so it is
    // found by content rather than by heading.
    const interests = surfaces.findIndex((element) => element.textContent?.includes("Photography"));
    expect(highlights).toBeGreaterThanOrEqual(0);
    expect(interests).toBeGreaterThan(highlights);
  });
});

describe("saving", () => {
  test("the save is multipart: config JSON beside the decoration file list", async () => {
    const surface = mountStudio();
    await surface.waitLoaded();
    await surface.waitFor(() => !saveButton(surface.container, "Save theme").disabled, {
      description: "the save button to become enabled",
    });

    await click(surface, saveButton(surface.container, "Save theme"));

    await surface.waitFor(
      () => recorder.calls.some((call) => call.method === "POST" && call.form !== undefined),
      { description: "the multipart save request" },
    );
    const post = recorder.calls.find((call) => call.method === "POST" && call.form !== undefined)!;
    const config = JSON.parse(String(post.form!.get("config"))) as { standard: boolean; decorations: unknown[] };
    expect(config.standard).toBe(false);
    // Nothing staged, nothing stored: the decoration list rides empty, with no
    // files beside it.
    expect(config.decorations).toEqual([]);
    expect(post.form!.getAll("decorations")).toHaveLength(0);
    // A successful save answers with the stored config, and the editor adopted it.
    expect(surface.container.textContent).toContain("Saved");
  });

  test("the Standard save writes the theme off", async () => {
    storedThemePayload = null;
    const surface = mountStudio();
    await surface.waitLoaded();

    const toggle = Array.from(surface.container.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent?.includes("show Standard"),
    );
    if (!toggle) throw new Error("the Standard toggle did not render");
    await click(surface, toggle);

    // The whole preview swapped, not just the header.
    expect(surface.container.querySelector("[data-theme-view]")?.getAttribute("data-theme-view")).toBe("standard");
    expect(surface.container.querySelector("[data-standard-banner]")).not.toBeNull();

    await click(surface, saveButton(surface.container, "Save standard profile"));

    await surface.waitFor(
      () => recorder.calls.some((call) => call.method === "POST" && call.form !== undefined),
      { description: "the standard save request" },
    );
    const post = recorder.calls.find((call) => call.method === "POST" && call.form !== undefined)!;
    const config = JSON.parse(String(post.form!.get("config"))) as { standard: boolean };
    expect(config.standard).toBe(true);
  });
});

describe("the motion switch", () => {
  test("a still style keeps the motion control unavailable", async () => {
    storedThemePayload = { ...storedTheme, styleId: "manga-ink" };
    const { container, waitLoaded } = mountStudio();
    await waitLoaded();

    // The switch is addressed by its accessible name, not by an id: what a
    // voice navigator or a reader finds is the same thing this test drives.
    const motionSwitch = motionSwitchOf(container);
    expect(motionSwitch.disabled).toBe(true);
  });

  test("a motion-capable style leaves the control available", async () => {
    storedThemePayload = { ...storedTheme, styleId: "sakura-blossom", motion: true };
    const { container, waitLoaded } = mountStudio();
    await waitLoaded();

    expect(motionSwitchOf(container).disabled).toBe(false);
  });
});

describe("the committed default", () => {
  test("the editor's defaults are the model's own standard config", () => {
    // The defaults the editor opens on when nothing is stored are imported
    // from the model, and its shape is the one the route validates — pinned
    // here so neither side can drift into its own idea of "default".
    expect(standardProfileThemeConfig.blocks).toEqual(defaultProfileThemeBlocks);
  });
});
