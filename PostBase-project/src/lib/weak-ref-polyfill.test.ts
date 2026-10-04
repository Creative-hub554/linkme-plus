import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The WeakRef shim has one job and it is decided at import time, which is the
 * whole difficulty of testing it: the module only installs a fallback when the
 * global is missing, so a test has to arrange that absence *before* the import
 * runs and then put the real one back.
 *
 * `vi.resetModules()` is what makes that possible — the module body runs again
 * on the next import — and the native global is captured before anything is
 * touched so the restore cannot depend on the fallback's own state.
 */
const nativeWeakRef = globalThis.WeakRef;

type WeakRefHost = { WeakRef?: unknown };

afterEach(() => {
  Object.defineProperty(globalThis, "WeakRef", {
    configurable: true,
    writable: true,
    value: nativeWeakRef,
  });
  vi.resetModules();
});

describe("the WeakRef polyfill", () => {
  it("leaves a native WeakRef in place", async () => {
    vi.resetModules();
    await import("./weak-ref-polyfill");
    expect(globalThis.WeakRef).toBe(nativeWeakRef);
  });

  it("installs a non-GC fallback when WeakRef is missing", async () => {
    delete (globalThis as WeakRefHost).WeakRef;
    vi.resetModules();

    await import("./weak-ref-polyfill");

    const Fallback = globalThis.WeakRef as new (target: object) => { deref(): object | undefined };
    expect(Fallback).toBeTypeOf("function");
    // It is a substitute, not the global that was there.
    expect(Fallback).not.toBe(nativeWeakRef);

    const target = { id: 1 };
    const ref = new Fallback(target);
    // The fallback holds its target rather than observing it, so `deref` is
    // stable — which is exactly the guarantee React's SSR path needs.
    expect(ref.deref()).toBe(target);
    expect(ref.deref()).toBe(target);
  });
});
