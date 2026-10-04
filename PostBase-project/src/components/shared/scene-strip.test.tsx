// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from "vitest";
import { act, useState } from "react";
import { cleanupSurfaces, mountSurface, type MountedSurface } from "@/test/render";
import { SceneStrip, type SceneStripState } from "@/components/shared/scene-strip";

/**
 * The fixture's dot names, and the shape the component asks of every caller: each
 * says what its dot switches *to*, not where the dot sits. Passing this one
 * function as `labelFor` keeps every case in this file modelling that rule, so a
 * positional name is never what the tests demonstrate.
 *
 * The quotes are typographic on purpose — a straight one would not survive being
 * built into the attribute selector `byName` uses.
 */
const sceneTitles = [
  "New ideas are taking shape.",
  "Find your people.",
  "Make something meaningful.",
];
const dotName = (index: number) => `Show “${sceneTitles[index]}”`;

/**
 * The row of dots both carousels pick through, tested once here instead of twice
 * through them.
 *
 * What is pinned is the pairing that made it one component: the group carries a
 * name (on a plain `div` an `aria-label` is ignored, which is how both strips
 * once had none), the dot that is showing says so with `aria-current` rather
 * than by being the filled one, each dot is named for what it switches to rather
 * than for its place in the row, a pick reports its index, and the fill is told
 * which of the three states its dot is in.
 *
 * The keyboard is the other half, and it is the half a click cannot stand in for:
 * the strip is one tab stop rather than three, Left and Right walk the dots and
 * carry the focus with them, and a keystroke picks the scene the way a click does.
 *
 * The skin is deliberately left to the caller — `trackClassName`/`fillClassName`
 * are written by the callers and differ between them — so these read the class
 * the caller wrote rather than a look the component chose.
 */

/** Every dot in the strip, in order. */
function dots(ui: MountedSurface) {
  return [...ui.container.querySelectorAll('[role="group"] button')] as HTMLElement[];
}

/** The fill inside a dot — the element the state is drawn on. */
function fill(dot: HTMLElement) {
  const inner = dot.querySelector("span");
  if (!inner) throw new Error("the dot rendered no fill");
  return inner;
}

/**
 * A strip wired to its own state, the way a caller mounts it.
 *
 * Arrow keys are only meaningful against a strip that actually moves, so the
 * keyboard cases need a host that answers `onSelect`; the component itself stays
 * controlled, exactly as it is in the app.
 */
function Controlled({ count = 3, initial = 0 }: { count?: number; initial?: number }) {
  const [selected, setSelected] = useState(initial);
  return (
    <SceneStrip
      label="Live preview slides"
      count={count}
      selected={selected}
      labelFor={dotName}
      onSelect={setSelected}
      trackClassName="h-1"
      fillClassName={() => ""}
    />
  );
}

afterEach(() => {
  cleanupSurfaces();
});

describe("SceneStrip", () => {
  test("names the strip and marks the dot that is showing", () => {
    const ui = mountSurface(
      <SceneStrip
        label="Live preview slides"
        count={3}
        selected={1}
        labelFor={dotName}
        onSelect={() => {}}
        trackClassName="h-1 bg-navy-100"
        fillClassName={() => ""}
      />,
      { providers: "none" },
    );

    // The label has to sit on something that can carry one: the role is what
    // makes `aria-label` mean anything here.
    expect(
      ui.container.querySelector('[aria-label="Live preview slides"]')?.getAttribute("role"),
    ).toBe("group");

    const all = dots(ui);
    expect(all).toHaveLength(3);
    // Each dot carries the caller's name, since a dot has no words of its own.
    expect(all.map((dot) => dot.getAttribute("aria-label"))).toEqual([
      "Show “New ideas are taking shape.”",
      "Show “Find your people.”",
      "Show “Make something meaningful.”",
    ]);

    // Exactly one dot is current — the one showing — and it says so in words,
    // not only by being the filled one.
    expect(all.map((dot) => dot.getAttribute("aria-current"))).toEqual([null, "true", null]);
  });

  test("moves the current dot with the item showing", async () => {
    const strip = (selected: number) => (
      <SceneStrip
        label="Live preview slides"
        count={3}
        selected={selected}
        labelFor={dotName}
        onSelect={() => {}}
        trackClassName="h-1"
        fillClassName={() => ""}
      />
    );
    const ui = mountSurface(strip(0), { providers: "none" });
    expect(dots(ui)[0].getAttribute("aria-current")).toBe("true");

    await ui.render(strip(2));

    // The strip follows the item rather than staying on whatever it opened on.
    expect(dots(ui).map((dot) => dot.getAttribute("aria-current"))).toEqual([null, null, "true"]);
  });

  test("reports the index a viewer picks", async () => {
    const onSelect = vi.fn();
    const ui = mountSurface(
      <SceneStrip
        label="Live visual scenes"
        count={3}
        selected={0}
        labelFor={dotName}
        onSelect={onSelect}
        trackClassName="h-1"
        fillClassName={() => ""}
      />,
      { providers: "none" },
    );

    await ui.click(ui.byName(dotName(2)));

    // The index, not the dot: the caller decides what a pick means — including
    // the re-arm, which is why this is a callback and not a state change here.
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(2);
  });

  test("tells the fill which of the three states its dot is in", () => {
    const ui = mountSurface(
      <SceneStrip
        label="Live preview slides"
        count={3}
        selected={1}
        labelFor={dotName}
        onSelect={() => {}}
        trackClassName="h-1"
        fillClassName={(state: SceneStripState) => `fill-${state}`}
      />,
      { providers: "none" },
    );

    // A dot only knows "current or not" would leave the seen/upcoming halves of
    // a progress strip undrawable, which is exactly what the landing preview is.
    expect(dots(ui).map((dot) => [...fill(dot).classList].find((name) => name.startsWith("fill-")))).toEqual([
      "fill-seen",
      "fill-selected",
      "fill-upcoming",
    ]);
  });

  test("is never a form's submit button", () => {
    const ui = mountSurface(
      <SceneStrip
        label="Live preview slides"
        count={1}
        selected={0}
        labelFor={() => dotName(0)}
        onSelect={() => {}}
        trackClassName="h-1"
        fillClassName={() => ""}
      />,
      { providers: "none" },
    );

    expect(dots(ui)[0].getAttribute("type")).toBe("button");
  });

  test("is one tab stop, on the dot that is showing", () => {
    const ui = mountSurface(<Controlled initial={1} />, { providers: "none" });

    // One dot in the tab order, the rest reachable with the arrow keys: the strip
    // is one control rather than three, and the stop is the item a viewer is
    // looking at rather than a fixed first dot.
    expect(dots(ui).map((dot) => dot.getAttribute("tabindex"))).toEqual(["-1", "0", "-1"]);
  });

  test("walks the dots with the arrow keys, carrying the focus and the pick", async () => {
    const ui = mountSurface(<Controlled />, { providers: "none" });

    await ui.press(dots(ui)[0], "ArrowRight");

    // A keystroke picks, the way a click does — and the tab stop and the focus
    // move with it, since one that changed the scene and left the focus behind
    // would strand a keyboard user on a dot that is no longer theirs.
    expect(dots(ui).map((dot) => dot.getAttribute("aria-current"))).toEqual([null, "true", null]);
    expect(dots(ui).map((dot) => dot.getAttribute("tabindex"))).toEqual(["-1", "0", "-1"]);
    expect(document.activeElement).toBe(dots(ui)[1]);

    await ui.press(dots(ui)[1], "ArrowLeft");

    expect(dots(ui).map((dot) => dot.getAttribute("aria-current"))).toEqual(["true", null, null]);
    expect(document.activeElement).toBe(dots(ui)[0]);
  });

  test("wraps at both ends, and jumps with Home and End", async () => {
    const ui = mountSurface(<Controlled />, { providers: "none" });

    await ui.press(dots(ui)[0], "ArrowLeft");
    expect(document.activeElement).toBe(dots(ui)[2]);

    await ui.press(dots(ui)[2], "ArrowRight");
    expect(document.activeElement).toBe(dots(ui)[0]);

    await ui.press(dots(ui)[0], "End");
    expect(document.activeElement).toBe(dots(ui)[2]);

    await ui.press(dots(ui)[2], "Home");
    expect(document.activeElement).toBe(dots(ui)[0]);
  });

  test("leaves the keys it does not answer alone, so Tab still moves on", async () => {
    const ui = mountSurface(<Controlled />, { providers: "none" });

    // Dispatched here rather than through the harness's `press` because the
    // assertion is on the event itself: swallowing Tab would trap a keyboard user
    // inside the strip, which is the one key this must never take.
    const event = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    await act(async () => {
      dots(ui)[0].focus();
      dots(ui)[0].dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(false);
    expect(dots(ui)[0].getAttribute("aria-current")).toBe("true");
  });
});
