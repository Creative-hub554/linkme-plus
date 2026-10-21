/**
 * Where the app's storage ops get the platform's R2 binding.
 *
 * Vinext gives route handlers no `env`, and nothing in the runtime hands
 * `env.UPLOADS` down — but the Worker entry (`worker/index.ts`) receives it,
 * and the app's `src/lib/*` modules are the same instances inside that
 * entry's bundle (the per-request database scope already rides this fact).
 * So the entry registers the binding once per isolate here, and the storage
 * helpers in `@/lib/r2` resolve it lazily. Where there is no Worker (the Node
 * dev server, seed scripts), the slot stays empty and the callers fall back
 * to the S3-API path in `@/lib/r2-sigv4` — which is why the credentials keep
 * existing for local scripts even though the hosted runtimes need none.
 *
 * A single module-level handle is safe the way the binding is: an R2 binding
 * is a stable stub, not a per-request socket, and the Worker is responsible
 * for re-registering it whenever a new env arrives (a fresh isolate, or a
 * config change) — every call resolves through this module, so a late
 * registration takes effect immediately.
 */

let workerBucket: unknown;

/**
 * Registers the platform's `UPLOADS` binding for this isolate — and, by taking
 * whatever it is handed (including `undefined`), the only way both directions
 * work: a runtime whose env carries no binding clears the slot just as plainly.
 * Keeping the assignment unconditional is what lets a test register a stub and
 * then hand back exactly the value it found.
 */
export function setWorkerR2Bucket(bucket: unknown): void {
  workerBucket = bucket;
}

/** The registered binding, typed as the runtime's own bucket type, or `null` for a Node runtime. */
export function workerR2Bucket(): R2Bucket | null {
  return (workerBucket as R2Bucket | undefined) ?? null;
}
