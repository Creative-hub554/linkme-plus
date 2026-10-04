/**
 * What a test leaves in the document that no mounted surface owns.
 *
 * A surface is unmounted and its tree (and portals) removed by
 * `cleanupSurfaces`, so anything still in the document afterwards, or any
 * listener still on `document`/`window`, was put there by the test or by a
 * component that never let go. Both are the same class of bug as a leaked
 * surface: the next test starts against a document that is not the one it
 * expects, and the failure — if it appears at all — appears somewhere else.
 *
 * **Stray nodes** are found by identity against a snapshot taken before the
 * test. A node already there when the test began is not this test's doing and
 * is never flagged, which also means a file that clears `document.body` in its
 * `afterEach` simply has nothing to find: the clear removed it, and that is a
 * teardown the file already owns.
 *
 * **Listeners** are the half jsdom cannot be asked about, so they are tracked
 * by wrapping `addEventListener`/`removeEventListener` on `EventTarget`. Only
 * `document` and `window` are watched: React's own delegation is attached to
 * the mount container (an element), so watching every target would count the
 * framework's listeners as leaks. The same snapshot rule applies — a listener
 * already registered when the test began is left alone.
 *
 * A listener registered with `{ once: true }` is removed by the browser the
 * moment it fires, with no `removeEventListener` call, so tracking the caller's
 * listener alone would report it as left behind. Those are registered through a
 * wrapper that untracks itself as it fires; the caller's own listener is still
 * the identity a leak is reported by, and a `removeEventListener` before firing
 * is routed to the wrapper so removal keeps working.
 */

type Listener = EventListenerOrEventListenerObject;

/** A caller's registration, and what the browser actually holds for it. */
interface Registration {
  /** The listener as passed in — the identity a leak is reported by. */
  listener: Listener;
  /** What was handed to the browser: the listener itself, or a once-wrapper. */
  held: Listener;
}

/** `type:capture` → caller listener → its registration. */
type ByKey = Map<string, Map<Listener, Registration>>;

/** The listeners seen per target — only document and window are watched. */
const tracked = new WeakMap<EventTarget, ByKey>();

let installed = false;

/**
 * Listeners a framework registers on the document for its own use and never
 * removes, so they are not a test's leak.
 *
 * React DOM attaches exactly one `selectionchange` listener to the owner
 * document when it sets up a root (`listenToAllSupportedEvents` in
 * react-dom-client), marked so it is only ever added once and never removed.
 * Every other event it delegates goes on the root container, which this does
 * not watch, so this is the whole of what the framework leaves at document
 * scope.
 */
const FRAMEWORK_LISTENERS = new Set(["selectionchange"]);

/** The targets worth watching: the ones a component reaches past its own tree. */
function watchedTargets(): EventTarget[] {
  return [document, window];
}

function isWatched(target: EventTarget): boolean {
  return typeof document !== "undefined" && watchedTargets().includes(target);
}

/** The `type`/`capture` identity of a listener registration. */
function keyOf(
  type: string,
  options?: AddEventListenerOptions | EventListenerOptions | boolean,
): string {
  const capture = typeof options === "boolean" ? options : Boolean(options?.capture);
  return `${type}:${capture}`;
}

function removeTracked(target: EventTarget, key: string, listener: Listener): void {
  tracked.get(target)?.get(key)?.delete(listener);
}

/**
 * Starts watching. Idempotent, and a no-op without a document — `render` is
 * imported by node-environment files too, and there is nothing to watch there.
 */
export function installDomLeakTracking(): void {
  if (installed || typeof EventTarget === "undefined" || typeof document === "undefined") return;
  installed = true;

  const addDescriptor = Object.getOwnPropertyDescriptor(EventTarget.prototype, "addEventListener");
  const removeDescriptor = Object.getOwnPropertyDescriptor(
    EventTarget.prototype,
    "removeEventListener",
  );
  const originalAdd = addDescriptor?.value as EventTarget["addEventListener"] | undefined;
  const originalRemove = removeDescriptor?.value as EventTarget["removeEventListener"] | undefined;
  if (!originalAdd || !originalRemove) return;

  EventTarget.prototype.addEventListener = function (
    this: EventTarget,
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ) {
    if (!listener || !isWatched(this) || FRAMEWORK_LISTENERS.has(type)) {
      return originalAdd.call(this, type, listener, options);
    }

    const key = keyOf(type, options);
    let byKey = tracked.get(this);
    if (!byKey) {
      byKey = new Map();
      tracked.set(this, byKey);
    }
    let registrations = byKey.get(key);
    if (!registrations) {
      registrations = new Map();
      byKey.set(key, registrations);
    }
    // The same listener on the same type and capture is a duplicate the browser
    // ignores, so it is one registration here too — whether or not either call
    // asks for `once`.
    if (registrations.has(listener)) return;

    const once = typeof options === "object" && options !== null && options.once === true;
    // `this` is the EventTarget the listener was registered on; the wrapper
    // below runs with its own `this`, so the target has to be captured here.
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const target = this;
    const held: Listener = once
      ? function onceWrapper(this: EventTarget, event: Event) {
          removeTracked(target, key, listener);
          if (typeof listener === "function") listener.call(this, event);
          else listener.handleEvent(event);
        }
      : listener;

    registrations.set(listener, { listener, held });
    return originalAdd.call(this, type, held, options);
  };

  EventTarget.prototype.removeEventListener = function (
    this: EventTarget,
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions,
  ) {
    const key = keyOf(type, options);
    const registration = listener ? tracked.get(this)?.get(key)?.get(listener) : undefined;
    if (registration) {
      removeTracked(this, key, listener as Listener);
      return originalRemove.call(this, type, registration.held, options);
    }
    return originalRemove.call(this, type, listener, options);
  };
}

export interface DomBaseline {
  nodes: Set<ChildNode>;
  listeners: Map<EventTarget, Map<string, Set<Listener>>>;
}

/** A copy of the document's stray-node and watched-listener state, by identity. */
export function snapshotDom(): DomBaseline {
  const listeners = new Map<EventTarget, Map<string, Set<Listener>>>();
  for (const target of watchedTargets()) {
    const byKey = tracked.get(target);
    if (!byKey) continue;
    const copy = new Map<string, Set<Listener>>();
    for (const [key, registrations] of byKey) copy.set(key, new Set(registrations.keys()));
    listeners.set(target, copy);
  }
  return { nodes: new Set(document.body.childNodes), listeners };
}

/**
 * The nodes and listeners present now that were not in the baseline, described
 * for a failure message. Empty means the test left nothing behind.
 */
export function domLeaks(baseline: DomBaseline): string[] {
  const leaks: string[] = [];

  for (const node of document.body.childNodes) {
    if (!baseline.nodes.has(node)) {
      leaks.push(`a <${node.nodeName.toLowerCase()}> node still in document.body`);
    }
  }

  for (const target of watchedTargets()) {
    const label = target === document ? "document" : "window";
    const before = baseline.listeners.get(target);
    const now = tracked.get(target);
    if (!now) continue;
    for (const [key, registrations] of now) {
      const already = before?.get(key);
      for (const listener of registrations.keys()) {
        if (!already?.has(listener)) leaks.push(`a "${key}" listener still on ${label}`);
      }
    }
  }

  return leaks;
}
