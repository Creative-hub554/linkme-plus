// Mock environment variables
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.AUTH_SECRET = "test-secret";
process.env.R2_BUCKET_NAME = "test-bucket";
process.env.R2_PUBLIC_URL = "https://test.r2.dev";

// This file runs for every environment, including the node one, so anything
// that assumes a document is guarded: `window` is how a test says which
// environment it asked for (`// @vitest-environment jsdom` at the top of the
// file), and the pure tests must not be handed browser globals they cannot use.
//
// Tests that mount components opt themselves into jsdom. That is the whole of
// the setup they need beyond these two shims:
if (typeof window !== "undefined") {
  // React's `act()` refuses to run — and warns — unless it is told it is in a
  // test environment.
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

  // jsdom implements no `ResizeObserver`, and Radix measures the trigger it
  // positions a tooltip against with one. Without this, opening a tooltip in a
  // test throws `ResizeObserver is not defined` before any assertion runs.
  if (!("ResizeObserver" in globalThis)) {
    class ResizeObserverStub {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
  }

  // jsdom lays nothing out, so it has no `scrollIntoView` and no `matchMedia`.
  // Both are asked for by components that are perfectly happy without them in a
  // real browser (scrolling a message list to the bottom, honouring a reduced
  // motion preference), and both are loud failures here rather than silent ones.
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = function scrollIntoView() {};
  }

  // jsdom 30 has the `PointerEvent` type but none of pointer capture, and a
  // Radix select calls `target.hasPointerCapture(...)` the moment it is pressed
  // — so the press throws before the control can open. Nothing is dragging in a
  // test, so a stub that holds no capture is not a stand-in for behaviour: it is
  // the answer the caller expects, and the three methods are the whole contract.
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
    Element.prototype.setPointerCapture = () => {};
    Element.prototype.releasePointerCapture = () => {};
  }
  // jsdom has no canvas, so `getContext` logs "Not implemented" and returns
  // null — the app already copes with the null (the cover studio renders its
  // preview canvas and moves on), so the only thing the real method adds to a
  // test run is noise in the one place output is read carefully: the audit.
  if (typeof HTMLCanvasElement !== "undefined") {
    HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement["getContext"];
  }

  // This jsdom has no `localStorage` — and its absence is not quiet: the lookup
  // falls through to Node's own experimental getter, which prints
  // "localStorage is not available because --localstorage-file was not
  // provided" into the one output that is read closely. The app is written for
  // the absence (a theme is applied from memory when storage cannot be read),
  // but the warning makes every run look like it has a problem, so the gap is
  // filled the same way as the others.
  //
  // Defined rather than conditionally defined, and that is not laziness: this
  // environment makes `window` and `globalThis` the same object, so *reading*
  // `window.localStorage` to test for it is what invokes Node's getter and
  // prints the warning — the first version of this shim did exactly that and
  // produced the warning it was written to remove. `Object.getOwnPropertyDescriptor`
  // could have tested it without invoking anything, but a plain in-memory store
  // is what a test wants whether or not something is there, so it is simply
  // installed. Storage-like rather than the whole `Storage` interface: the app
  // only ever gets and sets, and a stub that pretends to more is its own trap.
  const entries = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      get length() {
        return entries.size;
      },
      key: (index: number) => [...entries.keys()][index] ?? null,
      getItem: (key: string) => entries.get(String(key)) ?? null,
      setItem: (key: string, value: string) => void entries.set(String(key), String(value)),
      removeItem: (key: string) => void entries.delete(String(key)),
      clear: () => entries.clear(),
    },
  });

  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }
}
