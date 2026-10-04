import { describe, expect, it } from "vitest";
import { imperativeBeatSeams, surfaceOwnedClocks } from "@/test/convention-guards";
import { readComponentSources, readHookSources } from "@/test/source-scan";

/**
 * A guard for the beat's seam, from both of its ends: the shared hooks must not
 * *take* a per-beat callback, and the surfaces must not take the clock *back*.
 *
 * The ambient carousel used to take an `onTick` option and call it from its
 * interval, and the landing preview used it to move a second cycle — a style
 * drawn beside the slide — on the same beat. That seam is exactly the shape the
 * carousel was otherwise cleaned up to remove, and it leaked three ways at once:
 * a surface could run *anything* on the beat (open its own timer, write to the
 * DOM), the hook could reason about none of it, and the inline arrow a caller
 * naturally passes has to be held by reference or the effect that owns the
 * interval is torn down and rebuilt, resetting the cadence mid-beat. `beats` — a
 * count of the beats the clock has moved on — carries the same feature with no
 * identity to stabilise and nothing that can be run: a surface derives from it
 * (`beats % styles.length`), and anything a callback could have done, an effect
 * *on* the count still can.
 *
 * The other end is the same seam seen from outside. Both surfaces used to write
 * the clock themselves — bail out while paused, open an interval, list
 * `[playing, advance]` so a pause rebuilt it, clear it on teardown — and the only
 * thing that ever differed was 3s against 4.2s. A surface that opens a timer
 * again has taken the beat back, whatever it calls the callback it runs on it, so
 * the two detectors refuse a per-beat callback in a hook and a repeating clock in
 * a component that mounts one.
 *
 * Both detectors live in `@/test/convention-guards`, beside the mount, settle,
 * body-clear, stylesheet and runbook ones, so the same meta-test proves each
 * still fires. This file applies them: `imperativeBeatSeams` to every shared hook
 * and `surfaceOwnedClocks` to every component, with the discriminations the rules
 * rest on — an event callback on a hook that owns an interval, a canvas that
 * paints frames — stated as fixtures and, where it can be, against the real tree.
 *
 * And each limb is then brought back in the *real* file it would come back in: the
 * option patched into the hook's own interface, the callback patched into the hook's
 * own clock step, the walk widened in the hook's own `return`, the interval a surface
 * opens beside the carousel it mounts. A fixture proves a limb fires on a shape written
 * for it; a patch written against the file itself is what fails when that file is
 * renamed or refactored out from under the shape.
 */
const hookSources = readHookSources();
const componentSources = readComponentSources();

/**
 * A hook that takes a step callback and calls it from its own clock: the shape
 * that was removed, written back out.
 */
const callbackOnTheStep = [
  "export interface AmbientCarouselOptions {",
  "  cadenceMs: number;",
  "  onTick?: () => void;",
  "}",
  "export function useAmbientCarousel(options: AmbientCarouselOptions) {",
  "  const interval = window.setInterval(() => {",
  "    onTick?.();",
  "  }, options.cadenceMs);",
  "  return { interval };",
  "}",
].join("\n");

/** The same seam renamed: the step limb is the one a rename cannot dodge. */
const renamedCallbackOnTheStep = [
  "export interface BeatOptions {",
  "  cadenceMs: number;",
  "  handler?: (beat: number) => void;",
  "}",
  "export function useBeatThing(options: BeatOptions) {",
  "  const interval = window.setInterval(() => {",
  "    options.handler?.(1);",
  "  }, options.cadenceMs);",
  "  return { interval };",
  "}",
].join("\n");

/** The sanctioned shape: a cadence, and a count the surface reads. */
const beatAsAValue = [
  "export interface BeatOptions {",
  "  cadenceMs: number;",
  "}",
  "export function useBeatThing({ cadenceMs }: BeatOptions) {",
  "  const [beats, setBeats] = useState(0);",
  "  const interval = window.setInterval(() => {",
  "    advance();",
  "    setBeats((value) => value + 1);",
  "  }, cadenceMs);",
  "  return { beats, select };",
  "}",
].join("\n");

/** A surface mounting the carousel and driving it from an interval of its own. */
const surfaceDrivingItself = [
  "export function LiveVisual() {",
  "  const { index, playing } = useAmbientCarousel(3, { cadenceMs: 4200 });",
  "  useEffect(() => {",
  "    const id = window.setInterval(() => next(), 4200);",
  "    return () => window.clearInterval(id);",
  "  }, [playing]);",
  "  return <div>{index}</div>;",
  "}",
].join("\n");

/** The names a component mentions to mount the shared carousel. */
const AMBIENT_HOOK_NAMES = ["useAmbientCarousel", "useAmbientPlayback", "useCarouselRotation"];

/** The components that mention the carousel family at all. */
const mounting = Object.entries(componentSources).filter(([, source]) =>
  AMBIENT_HOOK_NAMES.some((name) => source.includes(name)),
);

describe("the shared hooks", () => {
  it("are found, so this guard is not silently scanning nothing", () => {
    expect(Object.keys(hookSources).length, "no shared hooks were read").toBeGreaterThan(3);
    // The two the rule is about: the hook that owns the clock, and the walk it
    // must not hand back.
    expect(Object.keys(hookSources)).toContain("../hooks/use-ambient-carousel.ts");
    expect(hookSources["../hooks/use-ambient-carousel.ts"]).toContain("setInterval(");
    expect(Object.keys(hookSources)).toContain("../hooks/use-carousel-rotation.ts");
  });

  it("publish the beat as a value, never as a callback the hook runs", () => {
    const offenders = Object.entries(hookSources).flatMap(([path, source]) =>
      imperativeBeatSeams(source).map((seam) => `${path}: ${seam}`),
    );

    expect(
      offenders,
      "A shared hook exposes an imperative per-beat callback. Publish the beat as a count the " +
        "caller reads (`beats`) and let the surface derive from it — an effect on the count can do " +
        "everything a callback could, and nothing a callback could do to the hook's own interval. " +
        "A surface here can never hang its own timer on the beat.",
    ).toEqual([]);
  });
});

describe("the surfaces", () => {
  it("that mount the carousel are found, so this guard is not silently scanning nothing", () => {
    expect(Object.keys(componentSources).length, "no components were read").toBeGreaterThan(20);
    const paths = mounting.map(([path]) => path);
    expect(paths).toContain("../components/landing/live-product-preview.tsx");
    expect(paths).toContain("../components/auth/login-live-visual.tsx");
  });

  it("leave the clock to the hook that owns it", () => {
    const offenders = Object.entries(componentSources).flatMap(([path, source]) =>
      surfaceOwnedClocks(source).map((clock) => `${path}: ${clock}`),
    );

    expect(
      offenders,
      "A component mounts the shared carousel and opens a repeating clock of its own. The beat is " +
        "`useAmbientCarousel`'s: state the cadence as `cadenceMs` and read `beats` (or the index it " +
        "moves), and let the hook own the interval — two surfaces that each write their own are two " +
        "surfaces that can tear their timers down differently, which is the defect the shared clock " +
        "removed.",
    ).toEqual([]);
  });

  it("is a rule about mounting the carousel, not about having a clock", () => {
    // The real-tree control: this component runs an interval of its own and
    // mounts no carousel, so the guard says nothing about it. That distinction is
    // the rule — a canvas painting frames, a typing indicator breathing and a
    // virtualized list re-measuring are their own animations, and only the beat
    // belongs to the hook.
    const ticker = componentSources["../components/realtime/typing-indicator.tsx"];
    expect(ticker, "the control component was not read").toContain("setInterval(");
    expect(surfaceOwnedClocks(ticker)).toEqual([]);
  });

  it("leaves a component that mounts no carousel alone, even with the clock written back in", () => {
    // The control above states the negative half on the file as it stands; this states it on
    // the file with the forbidden shape written back into it. The difference is the one thing a
    // static read cannot show: that the silence is the *gate* — the component naming no carousel
    // — rather than the detector happening not to see the clock such a component opens.
    const path = "../components/realtime/typing-indicator.tsx";
    const source = realSource(path);
    // The premise, asserted rather than assumed: a real component that runs a clock of its own
    // and names no member of the carousel family. One that started mounting the carousel would
    // open the gate, and this case would be pinning the wrong half of the rule.
    expect(source, `${path} no longer opens a clock of its own`).toContain("setInterval(");
    expect(
      source,
      `${path} mounts the carousel now, so the gate this case rests on has moved`,
    ).not.toMatch(/useAmbient|useCarouselRotation/);

    // The shape the detector exists to fire on — an interval a surface holds in an effect and
    // clears on teardown — written back beside the clock this component already runs. A fixture
    // states that shape on its own; this states it here, where the rule has to keep quiet, so an
    // edit that turned the rule into "any component with a clock" fails against the real file.
    const reintroduced = replaceOnce(
      source,
      "  // Auto-remove stale typing indicators after 5 seconds\n",
      "  // Auto-remove stale typing indicators after 5 seconds\n" +
        "  useEffect(() => {\n" +
        "    const id = window.setInterval(() => tick(), 1000);\n" +
        "    return () => window.clearInterval(id);\n" +
        "  }, []);\n",
    );
    expect(surfaceOwnedClocks(reintroduced)).toEqual([]);

    // …and the silence is the gate doing its job rather than the patch being invisible: mount
    // the carousel on the same file and the clock just written in *is* reported, its line read
    // back out of the patched source. Without this half the case would pass for a detector that
    // had stopped seeing intervals anywhere at all.
    const withImport = replaceOnce(
      reintroduced,
      'import { useWebSocket } from "@/hooks/use-websocket";\n',
      'import { useWebSocket } from "@/hooks/use-websocket";\n' +
        'import { useAmbientCarousel } from "@/hooks/use-ambient-carousel";\n',
    );
    const withCarousel = replaceOnce(
      withImport,
      "  const { lastMessage } = useWebSocket();\n",
      "  const { lastMessage } = useWebSocket();\n" +
        "  const { beats } = useAmbientCarousel(3, { cadenceMs: 1000 });\n",
    );

    const added = surfaceOwnedClocks(withCarousel).find((clock) =>
      clock.startsWith("window.setInterval"),
    );
    expect(
      added,
      `${path}: the clock this case wrote in was not reported once the carousel was named`,
    ).toBeDefined();
    const line = Number(/at line (\d+)$/.exec(added ?? "")?.[1]);
    expect(withCarousel.split("\n")[line - 1]).toContain("window.setInterval(");
  });

  it("and is deliberately not applied to the hook that owns the clock", () => {
    // The hook that owns the beat *does* install one and mounts the two halves it
    // is made of, so the very same detector applied a directory over would fire on
    // the design rather than on a defect. The application set is what draws the
    // line — `src/components` and not `src/hooks` — and this pins it, so a later
    // session that widens the set has to answer for it here.
    const owner = hookSources["../hooks/use-ambient-carousel.ts"];
    expect(owner).toContain("useAmbientPlayback");
    expect(surfaceOwnedClocks(owner)).not.toEqual([]);
  });
});

describe("imperativeBeatSeams", () => {
  it("catches the callback option the carousel used to take", () => {
    expect(imperativeBeatSeams(callbackOnTheStep)).toEqual([
      "onTick is a per-beat callback option",
    ]);
  });

  it("catches the clock running a callback whatever it is called", () => {
    // The vocabulary is not the enforcement: a step that mentions a function the
    // hook received is the same seam, and it is caught with no name to match on.
    expect(imperativeBeatSeams(renamedCallbackOnTheStep)).toEqual([
      "handler runs on the clock's own step",
    ]);
  });

  it("catches the callback option on a hook that owns no clock", () => {
    // The vocabulary is asked of *every* module, not only of one that owns a
    // timer, because the hook that owns none is where the seam would be handed on
    // from: `useCarouselRotation` is the position primitive a surface could still
    // reach for, and its `advance` is legal precisely because nothing there owns a
    // beat. So a step callback option on an unclocked hook is the same seam, and
    // the premise is real rather than hypothetical — the hook beside this file's
    // own fixtures is the one this asks about.
    const optionalOnAnUnclockedHook = [
      "export interface RotationOptions {",
      "  onTick?: () => void;",
      "}",
      "export function useRotation({ onTick }: RotationOptions) {",
      "  return { index: 0, advance: () => onTick?.() };",
      "}",
    ].join("\n");
    expect(imperativeBeatSeams(optionalOnAnUnclockedHook)).toEqual([
      "onTick is a per-beat callback option",
    ]);

    // And the declaration does not have to be optional: `declaresFunction` reads
    // the `?` as one of the two spellings a member can take, not as part of what a
    // function type *is*. A required callback is the same seam with nothing left
    // out — and it is the spelling a rename through an interface is likelier to
    // reach for, since an option a caller must pass needs no `?`.
    const requiredOnAnUnclockedHook = [
      "export interface RotationOptions {",
      "  onTick: (beat: number) => void;",
      "}",
      "export function useRotation({ onTick }: RotationOptions) {",
      "  return { index: 0, beats: 0 };",
      "}",
    ].join("\n");
    expect(imperativeBeatSeams(requiredOnAnUnclockedHook)).toEqual([
      "onTick is a per-beat callback option",
    ]);
  });

  it("leaves the count the surface reads alone", () => {
    expect(imperativeBeatSeams(beatAsAValue)).toEqual([]);
  });

  it("catches the walk handed back by the clock-owning hook, and only there", () => {
    // Returning the walk is how a surface would hang its own interval on the
    // beat, so the hook that owns the clock may not hand it back.
    const clocked = [
      "export function useThing(count: number) {",
      "  const [index, setIndex] = useState(0);",
      "  const advance = useCallback(() => setIndex((value) => (value + 1) % count), [count]);",
      "  const interval = window.setInterval(advance, 3000);",
      "  return { index, advance };",
      "}",
    ].join("\n");
    expect(imperativeBeatSeams(clocked)).toEqual(["advance useThing hands it back"]);

    // The same hook with no clock of its own is a position primitive: its walk
    // is the one thing the clock-owning hook above is built on, and it stays
    // public precisely because nothing here owns a beat to leak.
    const unclocked = [
      "export function useRotation(count: number) {",
      "  const [index, setIndex] = useState(0);",
      "  const advance = useCallback(() => setIndex((value) => (value + 1) % count), [count]);",
      "  return { index, advance };",
      "}",
    ].join("\n");
    expect(imperativeBeatSeams(unclocked)).toEqual([]);
  });

  it("leaves an event callback alone, even on a hook that owns an interval", () => {
    // The distinction the rule rests on: a hook answers *what happened* with a
    // callback (`onMessage`), and runs *the caller's code on its clock* with a
    // step. A heartbeat that pings is not a beat, and the hook that pings is not
    // handing the beat's walk back.
    const heartbeat = [
      "export interface UseSocketOptions {",
      "  onMessage?: (message: string) => void;",
      "  onComplete?: () => void;",
      "}",
      "export function useSocket({ onMessage }: UseSocketOptions) {",
      "  const ping = useCallback(() => send({ type: 'ping' }), []);",
      "  useEffect(() => {",
      "    const interval = setInterval(() => {",
      "      ping();",
      "    }, 30000);",
      "    return () => clearInterval(interval);",
      "  }, [ping]);",
      "  return { onMessage, ping };",
      "}",
    ].join("\n");
    expect(imperativeBeatSeams(heartbeat)).toEqual([]);
  });

  it("is not fired by the rule's own prose", () => {
    // The hook that documents the rejection names `onTick` in a comment, and the
    // tokenizer reads neither a comment nor a string, so the explanation cannot
    // trip the guard it explains.
    const prose = [
      "// A count, and not an `onTick` callback, because a callback is the leak.",
      "const note = 'setInterval(onTick)';",
      "export function useQuiet(count: number) {",
      "  return { beats: count };",
      "}",
    ].join("\n");
    expect(imperativeBeatSeams(prose)).toEqual([]);
  });

  it("pins what the three limbs deliberately do not read", () => {
    // A callback typed through an alias is not a function type by spelling, and
    // the step limb can only see what is named inside the step.
    const aliased = [
      "type BeatHandler = () => void;",
      "export interface BeatOptions {",
      "  onTick?: BeatHandler;",
      "}",
    ].join("\n");
    expect(imperativeBeatSeams(aliased)).toEqual([]);

    // A hook that returns its API by variable rather than as an object literal
    // is not read by the return limb — the walk handed back in a `return api` is
    // a shape the guard states it does not see rather than one it pretends to.
    const indirect = [
      "export function useThing() {",
      "  const interval = window.setInterval(() => {}, 1000);",
      "  const api = { advance: () => {} };",
      "  return api;",
      "}",
    ].join("\n");
    expect(imperativeBeatSeams(indirect)).toEqual([]);
  });
});

describe("surfaceOwnedClocks", () => {
  it("fires on the interval a surface used to write for itself", () => {
    expect(surfaceOwnedClocks(surfaceDrivingItself)).toEqual([
      "window.setInterval() at line 4",
    ]);
  });

  it("counts the frame loop too, and names the line it is on", () => {
    const animated = [
      "export function LivePreview() {",
      "  const { index } = useAmbientCarousel(3, { cadenceMs: 3000 });",
      "  useEffect(() => {",
      "    let frame = requestAnimationFrame(function draw() {",
      "      frame = requestAnimationFrame(draw);",
      "    });",
      "    return () => cancelAnimationFrame(frame);",
      "  }, [index]);",
      "  return null;",
      "}",
    ].join("\n");
    expect(surfaceOwnedClocks(animated)).toEqual([
      "requestAnimationFrame() at line 4",
      "requestAnimationFrame() at line 5",
    ]);
  });

  it("catches a surface mounting one half of the carousel by itself", () => {
    // The shape that predates the composition hook: `useAmbientPlayback` beside a
    // hand-rolled interval is exactly what `useAmbientCarousel` replaced, and the
    // half is named in the vocabulary so it cannot come back by another door.
    const half = [
      "export function LiveVisual() {",
      "  const [playing] = useAmbientPlayback();",
      "  const id = setInterval(next, 4200);",
      "  return <div>{playing}</div>;",
      "}",
    ].join("\n");
    expect(surfaceOwnedClocks(half)).toEqual(["setInterval() at line 3"]);

    // The other half of the same vocabulary, and the other door: reaching for the
    // position primitive alone and putting an interval around it is the shape
    // `useAmbientCarousel` was introduced to replace. `useCarouselRotation` is
    // named here for the same reason `useAmbientPlayback` is above — a half left
    // out of the vocabulary is a half that can come back through it.
    const positionHalf = [
      "export function LiveVisual() {",
      "  const { index } = useCarouselRotation(3);",
      "  const id = setInterval(next, 4200);",
      "  return <div>{index}</div>;",
      "}",
    ].join("\n");
    expect(surfaceOwnedClocks(positionHalf)).toEqual(["setInterval() at line 3"]);
  });

  it("leaves a component that animates without mounting the carousel alone", () => {
    const ticker = [
      "export function TypingIndicator() {",
      "  useEffect(() => {",
      "    const id = setInterval(() => setDot((dot) => (dot + 1) % 3), 400);",
      "    return () => clearInterval(id);",
      "  }, []);",
      "  return <span>{dot}</span>;",
      "}",
    ].join("\n");
    expect(surfaceOwnedClocks(ticker)).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* Each limb, brought back in the real file it would come back in             */
/* -------------------------------------------------------------------------- */

/**
 * The real file a case patches, keyed the way the source scan keys them.
 *
 * The two readers are merged because a limb is pinned where it applies rather than by
 * which directory it lives in — the hook-side limbs against `src/hooks`, the surface-side
 * one against `src/components` — and a path that was not read has to fail loudly instead
 * of handing a patch an empty string to substitute nothing into.
 */
function realSource(path: string): string {
  const source = hookSources[path] ?? componentSources[path];
  expect(source, `${path} was not read by the source scan`).toBeTruthy();
  return source ?? "";
}

/**
 * One substitution, which must land exactly once.
 *
 * These cases patch a real file's own text, so the anchor is what keeps them honest: a file
 * that no longer contains it fails the case rather than leaving a patch that changed
 * nothing and a detector that was quietly asked about a clean source. The mutation sweep's
 * own entries hold themselves to the same rule, for the same reason.
 */
function replaceOnce(source: string, find: string, replace: string): string {
  expect(
    source.split(find).length - 1,
    `the file no longer contains this anchor exactly once: ${find}`,
  ).toBe(1);
  return source.replace(find, replace);
}

/**
 * Every limb, brought back in the file it would actually come back in.
 *
 * The fixtures above state a limb's shape in the abstract; these state the shape *this
 * repo* would write, patched into the real hook or surface and handed to the same detector.
 * The difference is the one thing a fixture cannot notice — a rename or a refactor in the
 * file it stands in for. If `useCarouselRotation` stopped taking a parameter, or the
 * preview stopped reading `beats`, a hand-written shape would keep passing while the real
 * reintroduction walked straight past the guard. So each case patches the file's own text
 * through one anchored substitution, checks the *premise* the limb rests on is still true
 * of that file (that this hook owns no clock, that this one does), and requires the
 * detector to report that limb and nothing else.
 *
 * The patches are never run — they have to satisfy a source scan, not a compiler — and are
 * nevertheless written with the import they would need, because a case that brings a defect
 * back should read like the defect.
 */
describe("each limb, reintroduced in the real file", () => {
  it("catches a per-beat option on the hook that owns the clock", () => {
    const reintroduced = replaceOnce(
      realSource("../hooks/use-ambient-carousel.ts"),
      "  cadenceMs: number;\n}",
      "  cadenceMs: number;\n  onTick?: () => void;\n}",
    );

    expect(imperativeBeatSeams(reintroduced)).toEqual(["onTick is a per-beat callback option"]);
  });

  it("catches a per-beat option on the hook that owns no clock", () => {
    // The premise of the limb, asserted against the file rather than assumed: this is the
    // hook that owns no timer, which is why an option on it has to be caught *by name*
    // instead of by finding it inside a step. A clock added here is a change to the rule.
    const source = realSource("../hooks/use-carousel-rotation.ts");
    expect(source, "the rotation hook owns a clock now").not.toContain("setInterval(");

    const reintroduced = replaceOnce(
      source,
      "export function useCarouselRotation(count: number): CarouselRotation {",
      "export function useCarouselRotation(count: number, onAdvance?: () => void): CarouselRotation {",
    );

    expect(imperativeBeatSeams(reintroduced)).toEqual([
      "onAdvance is a per-beat callback option",
    ]);
  });

  it("catches a callback the clock's own step runs, renamed out of the vocabulary", () => {
    const path = "../hooks/use-ambient-carousel.ts";
    const withOption = replaceOnce(
      realSource(path),
      "  cadenceMs: number;\n}",
      "  cadenceMs: number;\n  handler?: () => void;\n}",
    );
    const reintroduced = replaceOnce(
      withOption,
      "      advance();\n",
      "      advance();\n      handler?.();\n",
    );

    // `handler` is deliberately outside the vocabulary: this is the limb a rename cannot
    // dodge, so the case must not be one the name-side limb could have answered instead.
    expect(imperativeBeatSeams(reintroduced)).toEqual(["handler runs on the clock's own step"]);
  });

  it("catches the walk the clock-owning hook hands back", () => {
    const source = realSource("../hooks/use-ambient-carousel.ts");
    expect(source, "the carousel no longer owns a clock — this limb's gate has changed").toContain(
      "setInterval(",
    );

    const reintroduced = replaceOnce(
      source,
      "  return { index, beats, select, playing, setPlaying };",
      "  return { index, beats, select, playing, setPlaying, advance };",
    );

    expect(imperativeBeatSeams(reintroduced)).toEqual(["advance useAmbientCarousel hands it back"]);
  });

  it("catches the clock a surface opens beside the carousel it mounts", () => {
    const surfaces = [
      {
        path: "../components/landing/live-product-preview.tsx",
        anchor: "  const styleIndex = beats % shortVideoTemplates.length;\n",
        tick: "selectSlide((slide + 1) % slides.length)",
        cadence: 3000,
      },
      {
        path: "../components/auth/login-live-visual.tsx",
        anchor: "  const active = moments[moment];\n",
        tick: "selectMoment((moment + 1) % moments.length)",
        cadence: 4200,
      },
    ];

    for (const { path, anchor, tick, cadence } of surfaces) {
      const withImport = replaceOnce(
        realSource(path),
        'import { useAmbientCarousel } from "@/hooks/use-ambient-carousel";\n',
        'import { useEffect } from "react";\n' +
          'import { useAmbientCarousel } from "@/hooks/use-ambient-carousel";\n',
      );
      const reintroduced = replaceOnce(
        withImport,
        anchor,
        `${anchor}  useEffect(() => {\n` +
          `    const id = window.setInterval(() => ${tick}, ${cadence});\n` +
          "    return () => window.clearInterval(id);\n" +
          "  }, [playing]);\n",
      );

      const clocks = surfaceOwnedClocks(reintroduced);
      expect(clocks, `${path}: the clock this surface opened was not seen`).toHaveLength(1);
      // …and the line it names is the line the clock is on, read back out of the patched
      // source rather than taken on trust from the detector's own report.
      const line = Number(/at line (\d+)$/.exec(clocks[0])?.[1]);
      expect(
        reintroduced.split("\n")[line - 1],
        `${path}: the reported line is not the clock's own`,
      ).toContain("window.setInterval(");
    }
  });

  it("catches the frame loop a surface opens beside the carousel", () => {
    // The frame loop is the other clock the vocabulary counts: a surface that animates a
    // layer of its own on rAF has taken the beat back exactly as an interval would. The
    // fixture above states that shape; this states it in the real surface, where the gate,
    // the clock vocabulary and the reported line are all read out of the file's own text —
    // so the frame loop's place in the vocabulary is not one fixture's to hold up.
    const path = "../components/landing/live-product-preview.tsx";
    const source = realSource(path);
    expect(source, `${path} no longer mounts the carousel`).toContain("useAmbientCarousel(");
    expect(surfaceOwnedClocks(source), `${path} already opens a clock`).toEqual([]);

    const withImport = replaceOnce(
      source,
      'import { useAmbientCarousel } from "@/hooks/use-ambient-carousel";\n',
      'import { useEffect } from "react";\n' +
        'import { useAmbientCarousel } from "@/hooks/use-ambient-carousel";\n',
    );
    const reintroduced = replaceOnce(
      withImport,
      "  const currentStyle = shortVideoTemplates[styleIndex];\n",
      "  const currentStyle = shortVideoTemplates[styleIndex];\n" +
        "  useEffect(() => {\n" +
        "    let frame = requestAnimationFrame(function draw() {\n" +
        "      frame = requestAnimationFrame(draw);\n" +
        "    });\n" +
        "    return () => cancelAnimationFrame(frame);\n" +
        "  }, [beats]);\n",
    );

    const frames = surfaceOwnedClocks(reintroduced).filter((clock) =>
      clock.startsWith("requestAnimationFrame()"),
    );
    expect(frames, `${path}: the frame loop this surface opened was not seen`).toHaveLength(2);
    // …and each reported line read back out of the patched source: the loop's own two
    // calls — the one that draws a frame, and the one inside it that asks for the next.
    for (const clock of frames) {
      const line = Number(/at line (\d+)$/.exec(clock)?.[1]);
      expect(reintroduced.split("\n")[line - 1]).toContain("requestAnimationFrame(");
    }
  });

  it("catches the required callback member on the hook that owns no clock", () => {
    // The same seam with nothing left optional, in the real interface. The reintroduction
    // above hands the hook an `onAdvance?` param; this hands its own interface a *required*
    // member instead, because the declaration walk reads `?` as one of two spellings a
    // member can take rather than as part of what a function type is — and a walk that
    // demanded the `?` would leave this spelling unreported. One case per spelling: neither
    // is left holding the limb alone.
    const source = realSource("../hooks/use-carousel-rotation.ts");
    expect(source, "the rotation hook owns a clock now").not.toContain("setInterval(");

    const reintroduced = replaceOnce(
      source,
      "  select: (picked: number) => void;\n}",
      "  select: (picked: number) => void;\n  onAdvance: (beat: number) => void;\n}",
    );

    expect(imperativeBeatSeams(reintroduced)).toEqual(["onAdvance is a per-beat callback option"]);
  });

  it("catches a surface driving the carousel's position half with a clock of its own", () => {
    // The vocabulary's gate, seen from the file. The fixture above states the half beside
    // an interval; this swaps the real surface's composition for that half alone and opens
    // an interval beside it — the defect the composition hook was introduced to end. Every
    // token of the swap is load-bearing: what gets scanned is now a file that names *only*
    // `useCarouselRotation`, so a half dropped from the vocabulary is a surface whose clock
    // this case would then not see.
    const path = "../components/landing/live-product-preview.tsx";
    const source = realSource(path);
    expect(source, `${path} no longer mounts the composition`).toContain("useAmbientCarousel(");
    expect(source, `${path} names the position half already`).not.toContain("useCarouselRotation");
    expect(surfaceOwnedClocks(source), `${path} already opens a clock`).toEqual([]);

    const withoutComposition = replaceOnce(
      source,
      'import { useAmbientCarousel } from "@/hooks/use-ambient-carousel";\n',
      'import { useEffect } from "react";\n' +
        'import { useCarouselRotation } from "@/hooks/use-carousel-rotation";\n',
    );
    const halfMounted = replaceOnce(
      withoutComposition,
      "  } = useAmbientCarousel(slides.length, { cadenceMs: 3000 });\n",
      "  } = useCarouselRotation(slides.length);\n",
    );
    const reintroduced = replaceOnce(
      halfMounted,
      "  const styleIndex = beats % shortVideoTemplates.length;\n",
      "  const styleIndex = beats % shortVideoTemplates.length;\n" +
        "  useEffect(() => {\n" +
        "    const id = window.setInterval(\n" +
        "      () => selectSlide((slide + 1) % slides.length),\n" +
        "      4200,\n" +
        "    );\n" +
        "    return () => window.clearInterval(id);\n" +
        "  }, [slide]);\n",
    );

    const clocks = surfaceOwnedClocks(reintroduced);
    expect(clocks, `${path}: the clock beside the half was not seen`).toHaveLength(1);
    // …and the line it names is the line the clock is on, read back out of the patched
    // source rather than taken on trust from the detector's own report.
    const line = Number(/at line (\d+)$/.exec(clocks[0])?.[1]);
    expect(reintroduced.split("\n")[line - 1]).toContain("window.setInterval(");
  });
});
