// @vitest-environment jsdom
import { afterEach, describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { IconButton } from "@/components/ui/icon-button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cleanupSurfaces, mountSurface } from "@/test/render";

/**
 * `IconButton` exists so a control's name is written once and used for both the
 * accessible name and the hint.
 *
 * The first half of this file renders to a string, which is the right tool for
 * the *shape* of the output: which element the control is, what attributes it
 * carries, and what is deliberately absent from the markup. The second half
 * mounts into a document, which is the only way to assert the strings a reader
 * actually sees — a shut tooltip renders nothing at all, so "the hint is the
 * same variable as the name" used to be a property of the component's source
 * rather than of any output. Now it is asserted: the tooltip's own text, against
 * the name the control answers to.
 *
 * The relationship `detail` exists to keep is what both halves are protecting:
 * the accessible name is the hint, plus at most a suffix. A name that did not
 * contain the hint would be a WCAG 2.5.3 failure, and it would mean a member
 * reading the hint was told something the control does not do.
 */
function markup(node: React.ReactNode) {
  return renderToStaticMarkup(<TooltipProvider>{node}</TooltipProvider>);
}

afterEach(() => {
  cleanupSurfaces();
});

describe("IconButton", () => {
  test("names the button after its label", () => {
    const html = markup(
      <IconButton label="Bookmark post">
        <span aria-hidden>★</span>
      </IconButton>
    );
    expect(html).toContain('aria-label="Bookmark post"');
  });

  test("attaches a tooltip to that same button", () => {
    const html = markup(
      <IconButton label="Share post">
        <span aria-hidden>★</span>
      </IconButton>
    );
    // Radix keeps the content shut until hover or focus; `data-state` on the
    // trigger is the evidence that a tooltip is attached at all.
    expect(html).toContain('data-state="closed"');
    expect(html).toContain('aria-label="Share post"');
  });

  test("keeps each button's label to itself", () => {
    const html = markup(
      <>
        <IconButton label="React to post">
          <span aria-hidden>★</span>
        </IconButton>
        <IconButton label="Comment on post">
          <span aria-hidden>★</span>
        </IconButton>
      </>
    );
    expect(html).toContain('aria-label="React to post"');
    expect(html).toContain('aria-label="Comment on post"');
  });

  test("keeps the hint inside the accessible name when there is a detail", () => {
    const html = markup(
      <IconButton label="Notifications" detail="3 unread">
        <span aria-hidden>★</span>
      </IconButton>
    );
    // The name carries both, hint first.
    expect(html).toContain('aria-label="Notifications, 3 unread"');
    // Nothing anywhere in the markup should announce the name without the hint
    // it is built from.
    expect(html).not.toContain('aria-label="3 unread"');
  });

  test("names the button with the label alone when there is no detail", () => {
    const html = markup(
      <IconButton label="Notifications">
        <span aria-hidden>★</span>
      </IconButton>
    );
    expect(html).toContain('aria-label="Notifications"');
    expect(html).not.toContain("unread");
  });

  test("renders a link, not a button, when it is given somewhere to go", () => {
    const html = markup(
      <IconButton label="Search" href="/search">
        <span aria-hidden>★</span>
      </IconButton>
    );
    // The address is the point: a button with a route `push` in its handler has
    // nowhere for a middle-click or "open in new tab" to go, and nothing for a
    // screen reader to announce as a link.
    expect(html).toContain('href="/search"');
    expect(html).toContain('aria-label="Search"');
    expect(html).toContain('data-state="closed"');
    expect(html).not.toContain("<button");
  });

  test("stays a button when it has nowhere to navigate to", () => {
    const html = markup(
      <IconButton label="Search">
        <span aria-hidden>★</span>
      </IconButton>
    );
    expect(html).toContain("<button");
    expect(html).not.toContain("<a");
  });

  test("names a link the same way it names a button", () => {
    const html = markup(
      <IconButton label="Notifications" detail="3 unread" href="/notifications">
        <span aria-hidden>★</span>
      </IconButton>
    );
    expect(html).toContain('aria-label="Notifications, 3 unread"');
  });

  test("passes the rest of the button's props through", () => {
    const html = markup(
      <IconButton label="Send comment" disabled type="button">
        <span aria-hidden>★</span>
      </IconButton>
    );
    expect(html).toContain("disabled");
    expect(html).toContain('type="button"');
  });
});

describe("IconButton in a document", () => {
  test("shows exactly the hint, and nothing until the control is asked", async () => {
    const ui = mountSurface(
      <IconButton label="Bookmark post">
        <span aria-hidden>★</span>
      </IconButton>
    );
    // Portalled out of the mount and shut to begin with — a hint that was
    // always on screen would be a label, not a hint.
    expect(ui.tooltips()).toEqual([]);

    await ui.focus(ui.byName("Bookmark post"));
    await ui.waitFor(() => ui.tooltips().includes("Bookmark post"), {
      description: "the tooltip to open",
    });

    expect(ui.tooltips()).toEqual(["Bookmark post"]);
  });

  test("names the control with the very string its tooltip shows", async () => {
    const ui = mountSurface(
      <IconButton label="Share post">
        <span aria-hidden>★</span>
      </IconButton>
    );
    const control = ui.byName("Share post");
    await ui.focus(control);
    // The tooltip is portalled and opens on a timer, so it is waited for
    // rather than read in the tick the focus was given in.
    await ui.waitFor(() => ui.tooltips().length > 0, { description: "the tooltip to open" });

    // Not "the name contains the hint" — the same string, which is what the
    // one-`label` design is for.
    expect(control.getAttribute("aria-label")).toBe(ui.tooltips()[0]);
  });

  test("shows the hint while the name carries the detail behind it", async () => {
    const ui = mountSurface(
      <IconButton label="Notifications" detail="3 unread">
        <span aria-hidden>★</span>
      </IconButton>
    );
    const control = ui.byName("Notifications, 3 unread");
    await ui.focus(control);
    await ui.waitFor(() => ui.tooltips().length > 0, { description: "the tooltip to open" });

    // The count the badge already shows on screen stays out of the hint…
    expect(ui.tooltips()).toEqual(["Notifications"]);
    // …and reaches the name as a suffix of it, which is the WCAG 2.5.3
    // relationship, asserted here against what was really rendered.
    expect(control.getAttribute("aria-label")).toBe(`${ui.tooltips()[0]}, 3 unread`);
  });

  test("takes the hint away again when the control is no longer focused", async () => {
    const ui = mountSurface(
      <IconButton label="Comment on post">
        <span aria-hidden>★</span>
      </IconButton>
    );
    const control = ui.byName("Comment on post");
    await ui.focus(control);
    await ui.waitFor(() => ui.tooltips().includes("Comment on post"), {
      description: "the tooltip to open",
    });
    expect(ui.tooltips()).toEqual(["Comment on post"]);

    await ui.blur(control);
    await ui.waitFor(() => ui.tooltips().length === 0, {
      description: "the tooltip to close",
    });

    expect(ui.tooltips()).toEqual([]);
    // The name is unchanged: the hint comes and goes, the name does not.
    expect(control.getAttribute("aria-label")).toBe("Comment on post");
  });
});
