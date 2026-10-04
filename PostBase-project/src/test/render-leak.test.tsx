// @vitest-environment jsdom
import { afterEach, describe, expect, test } from "vitest";
import { createPortal } from "react-dom";
import { assertNoLeakedSurfaces, cleanupSurfaces, mountSurface } from "@/test/render";

/**
 * The teardown-leak check, proven to fire.
 *
 * The check itself is the module-level `afterEach` in `render.tsx`, and a guard
 * that is only ever exercised against a clean tree is a guard that could stop
 * working without anything noticing — which is the exact failure it exists to
 * catch, one level up. So `assertNoLeakedSurfaces` is exported and driven here
 * against each thing it is meant to catch: a surface still mounted, a node left
 * in the body, and a listener left on the document. The message is asserted
 * rather than only the throw, so an edit that throws something else fails too.
 *
 * Driving the check is safe for this file. It drains the registry and unmounts
 * what it finds before it throws, and each case here takes its own node or
 * listener away again in a `finally` — otherwise this file would be the very
 * leak it is testing for, and the module hook would fail the next test.
 */
afterEach(() => {
  cleanupSurfaces();
});

/** Named, and rendering recognisable words, so a report can show both. */
function LeakySurface() {
  return <p>leaky words</p>;
}

/** Renders nothing into its own container — everything goes to the body. */
function PortalledSurface() {
  return createPortal(<p>portalled words</p>, document.body);
}

describe("the teardown-leak check", () => {
  test("fires on a surface that was left mounted, and says which and what", () => {
    mountSurface(<LeakySurface />);

    // A count alone would say a leak happened; the report says which mount it
    // was — component, `file:line`, the test it was in, and what it rendered —
    // so the failure reads without opening the file. Taken as a message rather
    // than a `toThrow` match because there are several things to pin.
    const report = (() => {
      try {
        assertNoLeakedSurfaces();
        return "";
      } catch (error) {
        return (error as Error).message;
      }
    })();

    expect(report).toMatch(/mounted surface\(s\) were still attached/);
    expect(report).toMatch(/LeakySurface \(render-leak\.test\.tsx:\d+\)/);
    expect(report).toContain("fires on a surface that was left mounted");
    expect(report).toMatch(/— rendered "<p>leaky words<\/p>"/);
  });

  test("describes a surface that rendered only into a portal", () => {
    mountSurface(<PortalledSurface />);

    const report = (() => {
      try {
        assertNoLeakedSurfaces();
        return "";
      } catch (error) {
        return (error as Error).message;
      }
    })();

    // The container is empty, so only the portalled body content can name what
    // was left mounted — the snippet must not fall back to "nothing".
    expect(report).toMatch(/— rendered ".*portalled words.*"/);
    expect(report).not.toContain("nothing");
  });

  test("fires on a node left in the document", () => {
    const stray = document.createElement("p");
    document.body.append(stray);

    try {
      expect(() => assertNoLeakedSurfaces()).toThrow(/left the document changed/);
      expect(() => assertNoLeakedSurfaces()).toThrow(/<p> node still in document\.body/);
    } finally {
      stray.remove();
    }
  });

  test("fires on a listener left on the document", () => {
    const listener = () => {};
    document.addEventListener("left-behind", listener);

    try {
      expect(() => assertNoLeakedSurfaces()).toThrow(
        /"left-behind:false" listener still on document/,
      );
    } finally {
      document.removeEventListener("left-behind", listener);
    }
  });

  test("ignores the framework's own permanent document listener", () => {
    const listener = () => {};
    document.addEventListener("selectionchange", listener);

    try {
      // React DOM registers exactly this listener on the owner document once
      // per root and never removes it, so counting it would fail every file
      // that ever mounts. The test removes its own copy either way.
      expect(() => assertNoLeakedSurfaces()).not.toThrow();
    } finally {
      document.removeEventListener("selectionchange", listener);
    }
  });

  test("does not misreport a once-listener that already fired", () => {
    let fired = 0;
    const listener = () => {
      fired += 1;
    };
    document.addEventListener("fired-once", listener, { once: true });

    try {
      document.dispatchEvent(new Event("fired-once"));
      expect(fired, "the once-listener ran").toBe(1);
      // The browser removed it as it fired, with no `removeEventListener`
      // call; the tracker has to have let go of it too.
      expect(() => assertNoLeakedSurfaces()).not.toThrow();
    } finally {
      document.removeEventListener("fired-once", listener);
    }
  });

  test("still reports a once-listener that never fired", () => {
    const listener = () => {};
    document.addEventListener("never-fired", listener, { once: true });

    try {
      expect(() => assertNoLeakedSurfaces()).toThrow(
        /"never-fired:false" listener still on document/,
      );
    } finally {
      document.removeEventListener("never-fired", listener);
    }
  });

  test("forgets a once-listener removed before it fired", () => {
    const listener = () => {};
    document.addEventListener("removed-early", listener, { once: true });
    document.removeEventListener("removed-early", listener);

    // Removal must route to the wrapped registration, or the wrapper would stay
    // registered and be reported as left behind.
    expect(() => assertNoLeakedSurfaces()).not.toThrow();
  });

  test("passes when the surface was let go", () => {
    const ui = mountSurface(<div />);
    ui.unmount();

    expect(() => assertNoLeakedSurfaces()).not.toThrow();
  });

  test("passes when nothing was mounted", () => {
    expect(() => assertNoLeakedSurfaces()).not.toThrow();
  });
});
