/**
 * A canvas and image harness for the two cover-canvas components.
 *
 * jsdom has no 2D context and never fires an image's `load`, so both components
 * stop at their first guard (`if (!canvas || !ctx) return`) and their draw code
 * — which is most of each file — is never reached. The suite's global setup
 * deliberately makes `getContext` return `null` so every other test copes with
 * the absence; this is the opt-in that fills it in for the two files whose whole
 * job is drawing.
 *
 * What it installs, and why each is needed:
 *
 * - **`getContext("2d")`** returns a recording no-op context. A `Proxy` answers
 *   every method the components call — `fill`, `drawImage`, `roundRect`, the
 *   gradients — and stores every property they set (`fillStyle`, `globalAlpha`),
 *   so none of the calls has to be enumerated and a method added later still
 *   works. The three calls whose *return value* the code reads are answered
 *   specifically: a gradient with `addColorStop`, a pattern, and `measureText`
 *   whose width scales with the text so the subtitle-trimming loop can run.
 * - **`Image`** fires `onload` the moment `src` is set, with non-zero
 *   dimensions. jsdom's image never loads, which is what left the cover wall and
 *   the Ken-Burns backgrounds unreached; a synchronous load is the smallest
 *   thing that lets those branches run.
 * - **`IntersectionObserver`** reports its target as intersecting immediately, so
 *   the frame loop starts without a real scroll.
 * - **`requestAnimationFrame`** runs the callback, but only a few times: the
 *   draw functions reschedule themselves for as long as the component is
 *   animating, so an unconditional synchronous call would recurse forever. A
 *   small cap is enough to execute a template's branch more than once.
 */
class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  crossOrigin = "";
  naturalWidth = 120;
  naturalHeight = 80;
  width = 120;
  height = 80;
  complete = true;

  #src = "";
  set src(value: string) {
    this.#src = value;
    this.onload?.();
  }
  get src(): string {
    return this.#src;
  }
}

/** The `getContext("2d")` value: a no-op recorder standing in for a real context. */
function makeContext(): CanvasRenderingContext2D {
  const gradient = { addColorStop: () => {} };
  const target: Record<string, unknown> = {};
  return new Proxy(target, {
    get(_target, property) {
      switch (property) {
        case "createLinearGradient":
        case "createRadialGradient":
          return () => gradient;
        case "createConicGradient":
          return () => gradient;
        case "createPattern":
          return () => ({ setTransform: () => {} });
        case "createImageData":
          return (width: number, height: number) => ({
            data: new Uint8ClampedArray(Math.max(1, width * height * 4)),
            width,
            height,
          });
        case "getImageData":
          return (x: number, y: number, width: number, height: number) => ({
            data: new Uint8ClampedArray(Math.max(1, width * height * 4)),
            width,
            height,
            x,
            y,
          });
        case "measureText":
          return (text: string) => ({ width: text.length * 12 });
        default:
          return typeof property === "string" ? () => {} : undefined;
      }
    },
    set(target, property, value) {
      target[property as string] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

/**
 * Installs the harness on the current jsdom environment, and returns a teardown
 * that puts the globals back so a later test in the same file starts clean.
 */
export function installCanvas(): () => void {
  const originalGetContext = HTMLCanvasElement.prototype.getContext;
  const originalImage = globalThis.Image;
  const originalRAF = globalThis.requestAnimationFrame;
  const originalCAF = globalThis.cancelAnimationFrame;
  const originalIO = (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;

  let frames = 0;
  HTMLCanvasElement.prototype.getContext = function getContext(this: HTMLCanvasElement, kind: string) {
    return kind === "2d" ? makeContext() : null;
  } as HTMLCanvasElement["getContext"];

  globalThis.Image = FakeImage as unknown as typeof Image;

  (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = class {
    #callback: IntersectionObserverCallback;
    constructor(callback: IntersectionObserverCallback) {
      this.#callback = callback;
    }
    observe(target: Element) {
      this.#callback([{ isIntersecting: true, target } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
    }
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  };

  globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    frames += 1;
    // A few frames are enough to run a template branch and its reschedule; more
    // would only replay the same path, since a real animation would.
    if (frames <= 4) callback(performance.now());
    return frames;
  }) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = (() => {}) as typeof cancelAnimationFrame;

  return () => {
    frames = 0;
    HTMLCanvasElement.prototype.getContext = originalGetContext;
    globalThis.Image = originalImage;
    globalThis.requestAnimationFrame = originalRAF;
    globalThis.cancelAnimationFrame = originalCAF;
    (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = originalIO;
  };
}
