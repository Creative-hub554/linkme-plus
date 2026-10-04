import * as React from "react";
import { act } from "react";
import { afterEach, beforeEach, expect } from "vitest";
import {
  domLeaks,
  installDomLeakTracking,
  snapshotDom,
  type DomBaseline,
} from "@/test/dom-leaks";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "@/components/providers/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";

/**
 * Renders a component into a real document.
 *
 * The rest of this suite renders to a string, which is enough for what markup
 * says and useless for what a reader sees: a shut tooltip renders nothing, so
 * "the hint the tooltip shows" could not be asserted at all — only the shape of
 * the component that was supposed to produce it. A test file opts into jsdom
 * (`// @vitest-environment jsdom`) and mounts through `mountSurface` — the one
 * export a test mounts with — to read the strings that actually reach the
 * screen. This is the primitive `mountSurface` wraps, and nothing else calls it.
 *
 * The two things a DOM test needs that a string test does not:
 *
 * 1. **A tick.** Radix opens a tooltip on a timer even at zero delay, so the
 *    assertion has to let the timer run. `settle()` is that tick, and it is
 *    deliberately called by the test rather than hidden inside `focus()` — a
 *    test that forgets it should fail loudly rather than hang.
 * 2. **Real focus.** Radix opens a tooltip on hover or on focus, and only focus
 *    is reachable here, so the test focuses the control itself and reads the
 *    document.
 *
 * Pass `delayDuration={0}` to `TooltipProvider`: the default is 700 ms, and
 * waiting it out in every test is how a suite gets slow enough to be skipped.
 *
 * A test whose assertion is about something *arriving* — a stubbed request, a
 * portalled menu, a value the server sent — waits with `waitFor`, not `settle`.
 * A sleep long enough today is a sleep that is too short on a busy machine or
 * behind a chained request, and it fails as a flake rather than as a bug.
 */
function mount(node: React.ReactNode) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  // A surface is unmounted once by the test itself when it needs to mount
  // something else nearby, and again by `mountSurface`'s end-of-test cleanup.
  // The second call is a no-op rather than a second `root.unmount()`.
  let unmounted = false;

  act(() => {
    root.render(node);
  });    /**
     * The control inside what was mounted, by the name it answers to.
     */
  const byName = (name: string) => {
    const element = container.querySelector(`[aria-label="${name}"]`);
    if (!element) throw new Error(`no control named "${name}" was rendered`);
    return element as HTMLElement;
  };

  return {
    container,
    byName,

    /**
     * Give any timer the component is waiting on a chance to fire.
     *
     * A sleep, not a wait: it waits for nothing in particular, so asserting
     * straight after it is how a test comes to depend on the clock. Reach for
     * `waitFor` instead whenever the assertion is about something arriving.
     */
    async settle(ms = 20) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, ms));
      });
    },

    /**
     * Wait until `condition` holds, letting the component catch up meanwhile.
     *
     * A fixed sleep is not a wait. `await settle(20); expect(...)` passes only
     * while whatever it is waiting for takes under twenty milliseconds, so it
     * goes on passing right up until the machine is busy, a request is chained
     * behind another, or the stub is made slower — and then it fails, in a test
     * that has not changed and a component that has not changed. That is a flaky
     * suite by construction rather than by bad luck.
     *
     * This polls the document rather than the clock: it returns the moment the
     * thing being waited for is there, however long that took, and says what it
     * was waiting for when it never arrives. `condition` is read, not asserted —
     * by the time it runs React has committed, so it reads what a reader would
     * see, and a query that finds nothing is a `false` rather than a throw.
     *
     * The default budget is four seconds, not the one the first version used:
     * Vitest runs the test files in parallel, and the whole-page mounts here
     * (the a11y file renders every surface) contend with every other file for
     * the machine. A Radix menu opening on a `pointerdown` is near-instant
     * alone and can still miss a one-second budget under that load, which fails
     * as a flake in a test that has not changed. The budget only bounds how long
     * a wait that will *never* be satisfied takes to say so; a real arrival is
     * returned as soon as it happens, so a longer default costs nothing on the
     * passing path and does not turn a real break into a pass.
     */
    async waitFor(
      condition: () => boolean,
      { timeout = 4000, description = "the awaited state" } = {},
    ) {
      const deadline = Date.now() + timeout;
      for (;;) {
        if (condition()) return;
        if (Date.now() >= deadline) {
          throw new Error(`waited ${timeout}ms for ${description}, and it never arrived`);
        }
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 5));
        });
      }
    },

    async focus(element: HTMLElement) {
      await act(async () => {
        element.focus();
      });
    },

    /**
     * A real click, for controls that open something.
     *
     * `element.click()` rather than a synthesised pointer event: it is what the
     * browser does for a control that opens on a click, and it reaches a React
     * `onClick` through the root listener. It does not drive the controls Radix
     * opens on a press or a hover — a menu, a select, a tooltip — which is what
     * `pointerDown` and `hover` below are for.
     */
    async click(element: HTMLElement) {
      await act(async () => {
        element.click();
      });
    },

    /**
     * A real press on the *mouse* event, for the controls Radix drives on
     * `mousedown` rather than on a pointer or a click.
     *
     * Tabs are the case: a tab activates on `mousedown`, so a `click()` is too
     * late — the handler has long since passed — and a `pointerdown` is a
     * different event it never hears. Only the primary button without a modifier
     * activates one, so the event carries exactly that.
     */
    async mouseDown(element: HTMLElement) {
      await act(async () => {
        element.dispatchEvent(
          new MouseEvent("mousedown", {
            bubbles: true,
            cancelable: true,
            button: 0,
            ctrlKey: false,
          }),
        );
      });
    },

    /**
     * A real mouse press, for the controls Radix opens on one.
     *
     * Menus and selects listen for `pointerdown`, not the `click()` that
     * follows it, which is why `click()` opens neither. jsdom 30 implements
     * `PointerEvent`, so this is the event the component's own handler expects,
     * carrying the `button`/`ctrlKey`/`pointerType` fields it reads — a Radix
     * select accepts the press only when `pointerType` is `"mouse"`, and both
     * take it only on the primary button without a modifier.
     */
    async pointerDown(element: HTMLElement) {
      await act(async () => {
        element.dispatchEvent(
          new PointerEvent("pointerdown", {
            bubbles: true,
            cancelable: true,
            button: 0,
            buttons: 1,
            ctrlKey: false,
            pointerType: "mouse",
          }),
        );
      });
    },

    /**
     * The pointer moving onto a control, for the disclosures Radix opens on
     * hover. A submenu opens when the pointer moves onto its trigger and a
     * tooltip when it moves onto the control it explains, each after a short
     * delay the caller waits out with `waitFor`. `pointerType: "mouse"` because
     * Radix ignores a touch pointer here.
     */
    async hover(element: HTMLElement) {
      await act(async () => {
        element.dispatchEvent(
          new PointerEvent("pointermove", { bubbles: true, cancelable: true, pointerType: "mouse" }),
        );
      });
    },

    async blur(element: HTMLElement) {
      await act(async () => {
        element.blur();
      });
    },

    /**
     * Text into a field, as typing it would.
     *
     * Assigning `.value` is not enough for the controlled inputs this app uses:
     * React remembers the value it last rendered and discards what it reads back
     * unless it heard about the change, so the native setter is used — which is
     * what React's own value tracker watches — and then a bubbling `input`
     * event, which is what a keystroke produces.
     */
    async type(element: HTMLInputElement | HTMLTextAreaElement, text: string) {
      await act(async () => {
        const prototype =
          element instanceof HTMLTextAreaElement
            ? HTMLTextAreaElement.prototype
            : HTMLInputElement.prototype;
        const setValue = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
        setValue?.call(element, text);
        element.dispatchEvent(new Event("input", { bubbles: true }));
      });
    },

    /**
     * Choosing files in a file input, as a person does.
     *
     * `files` is read-only and jsdom has no `DataTransfer`, so the list is
     * defined over the property — which is legal, and is what the component's
     * own handler reads off the event's target. The `change` event that follows
     * is a real one, and is dispatched inside `act` because React renders the
     * result of it.
     */
    async chooseFiles(element: HTMLInputElement, files: File[]) {
      await act(async () => {
        Object.defineProperty(element, "files", { value: files, configurable: true });
        element.dispatchEvent(new Event("change", { bubbles: true }));
      });
    },

    /**
     * A real key, for the controls that only open on one.
     *
     * Radix's `Select` opens on a pointer or on a key, and jsdom can drive
     * neither a pointer (`click()` does not produce the `pointerdown` it listens
     * for) nor the layout a real mouse would need — but a bubbling `keydown`
     * does reach its own handler, which is the only way a test can open one. The
     * element is focused first, as a keyboard user would find it, and the event
     * is dispatched rather than simulated: the component's real handler runs.
     */
    async press(element: HTMLElement | null, key: string) {
      if (!element) throw new Error("no element to press a key on");
      await act(async () => {
        element.focus();
        element.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
      });
    },

    /**
     * The text of every tooltip currently in the document, in document order.
     *
     * Read from `document.body`, not the container: tooltips are portalled out
     * to the body, which is part of what makes "is it in the page?" a question
     * worth asking separately from "does the component render it?".
     */
    tooltips() {
      return [...document.querySelectorAll('[role="tooltip"]')].map((element) => element.textContent);
    },

    /**
     * Render again into the same document — a prop change, as the app would.
     *
     * Kept apart from `unmount()` on purpose: a component that keeps showing
     * what it was first given is exactly the bug a fresh mount would hide.
     */
    async render(node: React.ReactNode) {
      await act(async () => {
        root.render(node);
      });
    },

    unmount() {
      if (unmounted) return;
      unmounted = true;
      act(() => {
        root.unmount();
      });
      container.remove();
    },

    /**
     * Whether this surface has already been unmounted. The leak check below
     * reads it so that a test which unmounts its own surface by hand is not
     * mistaken for one that never let go.
     */
    isUnmounted() {
      return unmounted;
    },
  };
}

/**
 * The handle a mounted surface returns.
 *
 * Exported so a helper can name the parameter of a function that takes a
 * mounted surface — `tabReading(ui)`, say — without the suite handing out
 * `mount` itself: `mountSurface` is the one way a test mounts, and a test
 * cannot reach the primitive it wraps.
 */
export type MountedSurface = ReturnType<typeof mount>;

/**
 * The providers a real page or component is mounted inside, as a named choice
 * rather than a hand-written tree per test file.
 *
 * - `tooltip` — a surface whose controls are tooltips (a post card, the nav):
 *   `TooltipProvider` with `delayDuration={0}`, the one prop every caller
 *   otherwise repeated.
 * - `theme` — a surface that reads `useTheme` and nothing else.
 * - `theme+tooltip` — a whole page, which the layout wraps in both. The theme is
 *   the outer provider, as it is in `app/layout`.
 * - `none` — a fragment with no context of its own.
 *
 * Naming the wrapper here is what lets each test file's `renderX` say which
 * surface it mounts instead of restating the provider nesting, and it keeps one
 * file from quietly mounting a surface the app never mounts.
 */
export type SurfaceProviders = "none" | "tooltip" | "theme" | "theme+tooltip";

/**
 * Wraps a surface in its providers. Exported for the one case `mountSurface`
 * cannot cover: a test that re-renders the same surface (a prop or context
 * change) through `ui.render`, which needs the same tree mounted again rather
 * than a fresh mount.
 */
export function withSurfaceProviders(
  node: React.ReactNode,
  providers: SurfaceProviders,
): React.ReactNode {
  let tree = node;
  if (providers === "tooltip" || providers === "theme+tooltip") {
    tree = <TooltipProvider delayDuration={0}>{tree}</TooltipProvider>;
  }
  if (providers === "theme" || providers === "theme+tooltip") {
    tree = <ThemeProvider>{tree}</ThemeProvider>;
  }
  return tree;
}

/**
 * Every surface mounted through `mountSurface` since the last cleanup.
 *
 * Held here rather than unmounted on the spot so a test can mount more than
 * one surface, and so a test that throws mid-assertion still has its surface
 * unmounted by the file's `afterEach` — which is the whole reason the old
 * boilerplate was `try/finally` rather than a plain call at the end.
 */
// Installed at import time, before any test body can add a listener: the wrapper
// has to be in place to see the registrations a test makes.
installDomLeakTracking();

const mountedSurfaces: {
  ui: MountedSurface;
  label: string;
  testName: string | null;
  /**
   * The body's children as they were before this surface mounted.
   *
   * A portal renders into `document.body`, not the container, so what a
   * surface adds at body level is the difference from here. Captured *before*
   * the mount so a surface that is wholly a portal — an open dialog, a toast —
   * is not swallowed by its own baseline.
   */
  before: Set<ChildNode>;
}[] = [];

/** Every surface mounted since the last cleanup, oldest first. */
function takeSurfaces() {
  return mountedSurfaces.splice(0).reverse();
}

/**
 * Unmounts every surface `mountSurface` has mounted since the last cleanup.
 *
 * A test file calls this at the very top of its `afterEach`, *before* it clears
 * `document.body`. That order matters: a Radix portal is a child of the body,
 * so emptying the body first and then asking React to unmount throws
 * `NotFoundError: The node to be removed is not a child of this node` out of a
 * teardown that has nothing to do with what the test asserted. Unmounting
 * first removes the portals itself, and the body is empty afterwards anyway.
 *
 * It is safe to call more than once, and safe after a test that already
 * unmounted a surface itself: an unmounted surface is a no-op.
 */
export function cleanupSurfaces() {
  for (const { ui } of takeSurfaces()) ui.unmount();
}

/**
 * The teardown a file must own, enforced rather than trusted.
 *
 * Hooks fire in reverse registration order, and the `afterEach` below is
 * registered when `render` is imported — before the test file's own `afterEach`
 * — so it runs *after* it. A file that called `cleanupSurfaces()` has an empty
 * list by the time this runs and passes; a file that forgot has its surfaces
 * still in it, and that is a leak this turns into a visible failure rather than
 * one that quietly carries a mounted root (and its portals) into the next test.
 *
 * A surface a test unmounted by hand is not a leak, so the ones that count are
 * the still-mounted; they are unmounted here anyway, so the next test starts
 * clean even after this fires.
 *
 * Exported so the check can be proven to fire — a guard only ever run against a
 * clean tree is a guard never shown to work. `render-leak.test.tsx` drives it
 * against a surface that really is still mounted.
 */
export function assertNoLeakedSurfaces() {
  const surfaces = takeSurfaces();
  const leaked = surfaces.filter(({ ui }) => !ui.isUnmounted());
  // A container is a body child too; never read one as another's portalled content.
  const containers = new Set<Node>(surfaces.map(({ ui }) => ui.container));
  // What each leaked surface rendered, read *before* the unmount below empties
  // its container — once it is unmounted there is nothing left to describe.
  const details = leaked.map((entry) => {
    // A body node belongs to the surface that was newest when it appeared: added
    // after this one mounted, and already there when the next one did.
    const mountedLater = surfaces.slice(surfaces.indexOf(entry) + 1).map(({ before }) => before);
    const portalled = portalledHtml(entry.before, containers, mountedLater);
    return `  - ${entry.label} — rendered ${surfaceSnapshot(entry.ui, portalled)}`;
  });
  for (const { ui } of surfaces) {
    try {
      ui.unmount();
    } catch {
      // A portal already torn out of the body throws on unmount; that is a
      // symptom of the same missing teardown, and the error below names the
      // cause rather than the symptom.
    }
  }

  // Read *after* the surfaces are unmounted, so a container or portal they
  // owned is gone and only the test's own leftovers remain.
  const strays = domBaseline ? domLeaks(domBaseline) : [];
  if (leaked.length === 0 && strays.length === 0) return;

  const problems: string[] = [];
  if (leaked.length > 0) {
    const where = leaked[0].testName ? ` (in "${leaked[0].testName}")` : "";
    problems.push(
      `${leaked.length} mounted surface(s) were still attached when this test ended${where}:\n` +
        details.join("\n") +
        "\nThe file's afterEach must call `cleanupSurfaces()` at the top, before it clears " +
        "`document.body` — a Radix portal is a child of the body, so clearing first makes React's " +
        "own teardown throw. (The surfaces have been unmounted now.)",
    );
  }
  if (strays.length > 0) {
    problems.push(
      `The test left the document changed outside any surface: ${strays.join(", ")}. ` +
        "Remove the node or the listener in the test, or mount the component that owns it.",
    );
  }
  throw new Error(problems.join(" "));
}

/**
 * The baseline a stray node or listener is measured against.
 *
 * Taken before the test file's own `beforeEach` runs, so what it records is the
 * document as it was handed to this test — anything already there is some other
 * test's business, or the environment's, and is never reported here.
 */
let domBaseline: DomBaseline | null = null;

beforeEach(() => {
  domBaseline = typeof document !== "undefined" ? snapshotDom() : null;
});

afterEach(() => {
  assertNoLeakedSurfaces();
});

/**
 * Mounts a surface the way the app mounts it, so a test states only what it
 * asserts about the surface it was handed.
 *
 * This is `mount()` plus the two things every direct-mount behavior test was
 * otherwise repeating by hand: the provider tree above, and the `try/finally`
 * around each test body that only ever unwound the surface. The teardown is
 * owned by the file's `afterEach` through `cleanupSurfaces()` instead, so a
 * test that throws mid-assertion still unmounts. A test that mounts more than
 * one surface (an admin's view and a stranger's) may unmount the first itself
 * when it is done with it; that is a no-op at cleanup time.
 */
/**
 * The `file:line` a `mountSurface` call sits at, read from the stack.
 *
 * Reported when a surface leaks, so the failure names the mount that was never
 * let go rather than only counting it. The first frame inside a test file is
 * taken: the frames above it are `mountSurface` and `mount` themselves, in
 * `render.tsx`, which says nothing about *where* the leak is. A caller with no
 * usable stack still reads as a sentence rather than an empty string.
 */
function mountCallSite(): string {
  const stack = new Error().stack;
  for (const line of stack?.split("\n") ?? []) {
    const match = line.match(/([^()\s]+\.test\.[jt]sx?):(\d+):\d+/);
    if (match) {
      const file = match[1].split(/[\\/]/).pop() ?? match[1];
      return `${file}:${match[2]}`;
    }
  }
  return "an unknown call site";
}

/** The name sources a React element type may carry. */
type NamedType = {
  displayName?: string;
  name?: string;
  render?: { displayName?: string; name?: string };
};

/**
 * The name a mounted element carries, when it carries one.
 *
 * A component — plain, `memo`, `forwardRef` — has a name worth reporting; a
 * host element or a fragment does not, and is left to the call site alone.
 */
function surfaceName(node: React.ReactNode): string | null {
  if (!React.isValidElement(node)) return null;
  const type: unknown = node.type;
  if (typeof type === "function") {
    const component = type as NamedType;
    return component.displayName ?? component.name ?? null;
  }
  if (typeof type === "object" && type !== null) {
    const component = type as NamedType;
    return component.displayName ?? component.render?.displayName ?? component.render?.name ?? null;
  }
  return null;
}

/**
 * Mounts a surface the way the app mounts it, so a test states only what it
 * asserts about the surface it was handed.
 *
 * This is `mount()` plus the two things every direct-mount behavior test was
 * otherwise repeating by hand: the provider tree above, and the `try/finally`
 * around each test body that only ever unwound the surface. The teardown is
 * owned by the file's `afterEach` through `cleanupSurfaces()` instead, so a
 * test that throws mid-assertion still unmounts. A test that mounts more than
 * one surface (an admin's view and a stranger's) may unmount the first itself
 * when it is done with it; that is a no-op at cleanup time.
 *
 * The name and call site are captured here and only ever read by the leak
 * check, so a surface that is let go pays nothing for them beyond one stack.
 */
export function mountSurface(
  node: React.ReactNode,
  { providers = "tooltip" }: { providers?: SurfaceProviders } = {},
) {
  // Read first: a portal renders into the body during the mount below, so a
  // baseline taken afterwards would include exactly what the report must show.
  const before = new Set<ChildNode>(Array.from(document.body.childNodes));
  const ui = mount(withSurfaceProviders(node, providers));
  const name = surfaceName(node);
  const site = mountCallSite();
  mountedSurfaces.push({
    ui,
    label: name ? `${name} (${site})` : `a surface (${site})`,
    testName: currentTestName(),
    before,
  });
  return ui;
}

/**
 * The test the check is running for, for a report that stands on its own.
 *
 * Read from Vitest's own state and never allowed to throw: a report is the
 * last thing that should fail, so an unavailable name is simply left out.
 */
function currentTestName(): string | null {
  try {
    return expect.getState().currentTestName ?? null;
  } catch {
    return null;
  }
}

/**
 * A one-line snippet of what a leaked surface rendered, for the report.
 *
 * The container's own markup followed by anything it portalled into the body,
 * whitespace collapsed and truncated, so the failure says *what* was left
 * mounted as well as where. The container alone is not enough: Radix renders a
 * dialog's, menu's or tooltip's content into `document.body`, not the container,
 * so a surface that is *only* a portal would otherwise read as "nothing". A
 * surface that genuinely renders nothing still says so rather than showing "".
 */
function surfaceSnapshot(ui: MountedSurface, portalled: string): string {
  const own = ui.container.innerHTML.replace(/\s+/g, " ").trim();
  const html = [own, portalled].filter(Boolean).join(" ");
  if (!html) return "nothing";
  return `"${html.length > 120 ? `${html.slice(0, 117)}…` : html}"`;
}

/**
 * The markup of the body children a surface portalled there.
 *
 * A portal is appended to `document.body` directly, so it is found by
 * difference: body children this surface did not see before it mounted
 * (`before`) that are not another surface's container. A node added while a
 * *later* surface was already mounted belongs to that later one, so it is
 * dropped from this surface's snippet — the shared body is why this needs the
 * whole mount order, not just this surface's own baseline.
 */
function portalledHtml(
  before: Set<ChildNode>,
  containers: Set<Node>,
  mountedLater: Set<ChildNode>[],
): string {
  return Array.from(document.body.childNodes)
    .filter(
      (node) =>
        !before.has(node) &&
        !containers.has(node) &&
        mountedLater.every((later) => later.has(node)),
    )
    .map((node) => (node instanceof Element ? node.outerHTML : ""))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}
