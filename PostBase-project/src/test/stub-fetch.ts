import { vi } from "vitest";

/**
 * Stubbing `fetch` for a mounted surface, in one place.
 *
 * Every rendered-surface test needs the same three things and each file was
 * writing them out by hand: a `json()` body builder, a list of what the app
 * asked for, and a `URL`-parsing `vi.fn` that dispatches on the path. Only the
 * middle changes between files — one surface answers `/api/pages`, another
 * `/api/groups` — so the plumbing is here and a test file declares nothing but
 * the endpoints it answers and the requests it wants to read back.
 *
 * An endpoint is keyed by pathname (the query is kept on the request, for a
 * path that answers differently by query — `/api/groups?id=…`) and is either a
 * payload, answered as JSON 200, or a function for a path that answers more
 * than one way — a `PUT` that writes and a `GET` that reads, say. The function
 * gets the whole request and may return either a payload or a built `Response`,
 * so a route that answers 201 or 403 says so itself.
 *
 * What a path with no endpoint answers is the file's decision: the default is
 * an empty 200, and a surface whose states hinge on a missing thing passes a
 * `fallback` that answers 404.
 */

/** A JSON `Response`, the shape every stubbed endpoint answers in. */
export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** One request the stub was asked to answer. */
export interface StubRequest {
  /** The pathname and query, as the app asked for it. */
  path: string;
  /** Just the path, query stripped — the key endpoints are declared by. */
  pathname: string;
  /** The method, upper-cased; a fetch with no `method` is a GET. */
  method: string;
  /** The query string, decoded. */
  query: URLSearchParams;
  /** A JSON body, decoded; `undefined` for a GET or a multipart upload. */
  body: Record<string, unknown> | undefined;
  /** A multipart body, kept whole — an upload is not JSON. */
  form: FormData | undefined;
}

/** A payload answered as-is, JSON 200: any JSON value. */
export type StubPayload = string | number | boolean | null | object;

/** Builds a `Response` — or a payload — from the request, for a path that answers more than one way. */
export type StubHandler = (request: StubRequest) => unknown | Response;

/**
 * What an endpoint answers: a payload (JSON 200), or a handler.
 *
 * `StubPayload` is named rather than `unknown` on purpose: a union with
 * `unknown` collapses to `unknown`, and then a handler written inline loses the
 * contextual type for its `request` parameter. Keeping a non-absorbing union
 * lets a bare `(request) => …` in an endpoint map infer `StubRequest`.
 */
export type StubEndpoint = StubPayload | StubHandler;

export interface StubFetchOptions {
  /** What a path with no declared endpoint answers. Defaults to an empty 200. */
  fallback?: (request: StubRequest) => Response;
}

/**
 * The requests the stub saw, and what state they left it in.
 *
 * `started`/`open` are what lets a surface be *waited for* rather than slept on:
 * a page that renders and then fetches behind it is briefly idle between two
 * requests, and judging it there is judging a half-built page. `answered` is the
 * other half — the pathnames a declared endpoint actually answered, so a test
 * can tell a surface that was given data from one that read nothing.
 */
export interface FetchRecorder {
  calls: StubRequest[];
  /** Every request made, including ones still open. */
  started: number;
  /** Requests the stub has been asked for but has not answered yet. */
  open: number;
  /** The pathnames a declared endpoint actually answered. */
  answered: string[];
}

export function stubFetch(
  endpoints: Record<string, StubEndpoint>,
  { fallback = () => json({}) }: StubFetchOptions = {},
): FetchRecorder {
  const recorder: FetchRecorder = { calls: [], started: 0, open: 0, answered: [] };

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "http://localhost");
      const raw = init?.body;
      const request: StubRequest = {
        path: `${url.pathname}${url.search}`,
        pathname: url.pathname,
        method: (init?.method ?? "GET").toUpperCase(),
        query: url.searchParams,
        // `String(FormData)` is "[object FormData]", which is not JSON — so a
        // multipart body is kept whole rather than parsed.
        body: typeof raw === "string" ? JSON.parse(raw) : undefined,
        form: raw instanceof FormData ? raw : undefined,
      };
      recorder.calls.push(request);
      recorder.started += 1;
      recorder.open += 1;
      try {
        if (!Object.prototype.hasOwnProperty.call(endpoints, url.pathname)) {
          return fallback(request);
        }
        recorder.answered.push(url.pathname);
        const endpoint = endpoints[url.pathname];
        if (typeof endpoint === "function") {
          const answer = (endpoint as StubHandler)(request);
          return answer instanceof Response ? answer : json(answer);
        }
        return json(endpoint);
      } finally {
        recorder.open -= 1;
      }
    }),
  );

  return recorder;
}
