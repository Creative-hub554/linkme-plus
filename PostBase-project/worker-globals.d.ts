/**
 * The Cloudflare Worker ambient types, kept deliberately small.
 *
 * The obvious way to type these files is `/// <reference types="@cloudflare/workers-types" />`
 * — but that package (and the `wrangler types` output that inlines it) declares its own
 * `Response`, `Request`, `WebSocket`, `Element`, `ParentNode`, … This project compiles with
 * the DOM lib for the Next.js app, so the two sets collide: `res.json()` becomes `unknown`
 * and every DOM node stops matching its own interfaces — 387 errors, measured.
 *
 * So instead we declare only the names the three Worker files use, and where the runtime
 * only *extends* a DOM type we merge into it (`declare interface` is additive) rather than
 * redeclare it. The `Env` interface itself lives in the generated `worker-configuration.d.ts`;
 * regenerate it and the binding list with `npm run types:worker`.
 *
 * Without `--include-runtime false`, `wrangler types` inlines the colliding runtime types.
 */

interface ExecutionContext<Props = unknown> {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
  readonly props: Props;
}

interface DurableObjectId {
  toString(): string;
  equals(other: DurableObjectId): boolean;
  readonly name?: string;
}

interface DurableObjectStorage {
  get<T = unknown>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<boolean>;
  list<T = unknown>(options?: { prefix?: string; limit?: number }): Promise<Map<string, T>>;
}

interface DurableObjectState<Props = unknown> {
  readonly id: DurableObjectId;
  readonly storage: DurableObjectStorage;
  readonly props: Props;
  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>;
}

interface DurableObjectStub {
  fetch(input: Request | string, init?: RequestInit): Promise<Response>;
}

interface DurableObjectNamespace {
  get(id: DurableObjectId): DurableObjectStub;
  idFromName(name: string): DurableObjectId;
  idFromString(id: string): DurableObjectId;
  newUniqueId(): DurableObjectId;
}

/** A service binding, whose `fetch` talks to another Worker. */
interface Fetcher {
  fetch(input: Request | string, init?: RequestInit): Promise<Response>;
}

interface KVNamespace {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

interface R2Bucket {
  get(key: string): Promise<unknown>;
  put(key: string, value: unknown): Promise<unknown>;
  delete(key: string): Promise<void>;
}

interface Queue<T = unknown> {
  send(message: T): Promise<void>;
}

/** The two ends of a socket a Durable Object holds open. */
declare const WebSocketPair: {
  new (): { 0: WebSocket; 1: WebSocket };
};

/** The edge runtime accepts the server socket after the response has started. */
interface WebSocket {
  accept(): void;
}

/** A 101 response hands the client socket back to the runtime. */
interface ResponseInit {
  webSocket?: WebSocket | null;
}
