import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The auth catch-all: both verbs are a bare passthrough to the auth library.
 *
 * There is no app-level decision here — no id, role or ownership the route
 * itself reads — so what a test can pin is exactly that: the incoming `Request`
 * is handed to `auth.handler` unchanged and its `Response` is returned as-is,
 * for `GET` and `POST` alike. Everything about sessions, cookies and CSRF is the
 * library's, and mocking the handler is the boundary that says so.
 */
const handler = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth", () => ({
  auth: { handler },
}));

import { GET, POST } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("/api/auth/[...all]", () => {
  it("forwards GET to the auth handler and returns its response", async () => {
    handler.mockResolvedValueOnce(new Response("signed in", { status: 200 }));
    const request = new Request("http://localhost/api/auth/get-session", { method: "GET" });

    const response = await GET(request);

    expect(handler).toHaveBeenCalledTimes(1);
    // The same request object, not a rebuilt or rewritten one.
    expect(handler).toHaveBeenCalledWith(request);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("signed in");
  });

  it("forwards POST to the auth handler and returns its response", async () => {
    handler.mockResolvedValueOnce(new Response("created", { status: 201 }));
    const request = new Request("http://localhost/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "a@b.c" }),
    });

    const response = await POST(request);

    expect(handler).toHaveBeenCalledWith(request);
    expect(response.status).toBe(201);
    expect(await response.text()).toBe("created");
  });
});
