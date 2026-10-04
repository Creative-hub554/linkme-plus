// @vitest-environment jsdom
import { act } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { MediaImage } from "@/components/ui/media";
import { cleanupSurfaces, mountSurface } from "@/test/render";

/**
 * `MediaImage` had no tests while it was one of four exports in a UI-kit
 * leftover; the other three (`MediaGallery`, `MediaVideo`, `MediaAvatar`) had no
 * callers at all and are gone. What is left is the half the profile cover
 * actually uses, and it held two bugs worth a test each:
 *
 * - a default fallback of `/images/placeholder.png`, a path this project cannot
 *   serve, so a failed image was replaced by another failed image;
 * - `src` copied into state on mount, so a caller that swapped the image kept
 *   seeing the old one.
 *
 * The error is dispatched rather than caused: jsdom loads no images, and what
 * is under test is what the component does when one fails, not whether it can
 * fetch.
 */
function fail(element: Element) {
  return act(async () => {
    element.dispatchEvent(new Event("error"));
  });
}

afterEach(() => {
  cleanupSurfaces();
});

describe("MediaImage", () => {
  test("shows the image it was given", () => {
    const ui = mountSurface(<MediaImage src="https://cdn.example/a.jpg" alt="A cover" />, {
      providers: "none",
    });
    expect(ui.container.querySelector("img")?.getAttribute("src")).toBe("https://cdn.example/a.jpg");
    expect(ui.container.querySelector("img")?.getAttribute("alt")).toBe("A cover");
  });

  test("reports a failing image once", async () => {
    const onError = vi.fn();
    const ui = mountSurface(
      <MediaImage src="https://cdn.example/missing.jpg" alt="A cover" onError={onError} />,
      { providers: "none" },
    );
    const img = ui.container.querySelector("img")!;
    await fail(img);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  test("does not invent a fallback the app cannot serve", async () => {
    // No `fallback` prop, so there is nothing to swap to — and specifically not
    // `/images/placeholder.png`, which no request in this project can satisfy.
    const ui = mountSurface(<MediaImage src="https://cdn.example/missing.jpg" alt="A cover" />, {
      providers: "none",
    });
    const img = ui.container.querySelector("img")!;
    await fail(img);
    expect(img.getAttribute("src")).toBe("https://cdn.example/missing.jpg");
    expect(img.getAttribute("src")).not.toContain("placeholder");
  });

  test("swaps to a fallback the caller asked for, and only once", async () => {
    const onError = vi.fn();
    const ui = mountSurface(
      <MediaImage
        src="https://cdn.example/missing.jpg"
        alt="A cover"
        fallback="/fallback.jpg"
        onError={onError}
      />,
      { providers: "none" },
    );
    const img = ui.container.querySelector("img")!;
    await fail(img);
    expect(img.getAttribute("src")).toBe("/fallback.jpg");

    // The fallback failing too must not start a loop.
    await fail(img);
    expect(img.getAttribute("src")).toBe("/fallback.jpg");
    expect(onError).toHaveBeenCalledTimes(1);
  });

  test("shows a new source when the caller swaps it", async () => {
    // Editing a profile cover changes this prop. Holding a copy of the source in
    // state meant the picture on screen did not change with it.
    const ui = mountSurface(<MediaImage src="https://cdn.example/old.jpg" alt="A cover" />, {
      providers: "none",
    });
    expect(ui.container.querySelector("img")?.getAttribute("src")).toBe("https://cdn.example/old.jpg");
    await ui.render(<MediaImage src="https://cdn.example/new.jpg" alt="A cover" />);
    expect(ui.container.querySelector("img")?.getAttribute("src")).toBe("https://cdn.example/new.jpg");
  });
});
