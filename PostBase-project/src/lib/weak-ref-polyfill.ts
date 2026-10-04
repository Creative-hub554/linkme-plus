// React Server Components currently constructs WeakRef during SSR. Some edge
// runtimes used by Vinext do not expose it, so provide a small non-GC-aware
// fallback. Native WeakRef remains untouched when available.
if (typeof globalThis.WeakRef === "undefined") {
  class WeakRefFallback<T extends object> {
    private readonly target: T;

    constructor(target: T) {
      this.target = target;
    }

    deref(): T | undefined {
      return this.target;
    }
  }

  Object.defineProperty(globalThis, "WeakRef", {
    configurable: true,
    writable: true,
    value: WeakRefFallback,
  });
}

// The module is imported for its side effect alone, but marking it as a module
// (rather than a global script) keeps it import-able under `moduleDetection`.
export {};
