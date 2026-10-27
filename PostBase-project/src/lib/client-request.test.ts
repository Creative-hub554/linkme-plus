import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { clientRequest, jsonBody } from "@/lib/client-request";

/**
 * `clientRequest` is the one read every form uses to tell an unsuccessful write
 * from a successful one: the response status decides whether the payload is a
 * result or an error, and the error carries a sentence a reader can act on.
 */
const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

describe("clientRequest", () => {
  test("returns the payload and asks for a fresh read", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));
    await expect(clientRequest("/api/thing")).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith("/api/thing", { cache: "no-store" });
  });

  test("merges the caller's request options over the default", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: "1" }));
    await clientRequest("/api/thing", { method: "POST", body: "{}" });
    expect(fetchMock).toHaveBeenCalledWith("/api/thing", { cache: "no-store", method: "POST", body: "{}" });
  });

  test("asks a signed-out caller to sign in", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "Unauthorized" }, 401));
    await expect(clientRequest("/api/thing")).rejects.toThrow("Please sign in to continue.");
  });

  test("uses the server's sentence for a refusal", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "Applications are closed" }, 409));
    await expect(clientRequest("/api/thing")).rejects.toThrow("Applications are closed");
  });

  test("falls back to its own sentence when the server sends none", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}, 500));
    await expect(clientRequest("/api/thing")).rejects.toThrow("Request failed. Please try again.");
  });
});

describe("jsonBody", () => {
  test("serializes a JSON write as POST by default", () => {
    expect(jsonBody({ jobId: "job-1" })).toEqual({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: '{"jobId":"job-1"}',
    });
  });

  test("takes the verb it is given", () => {
    expect(jsonBody({ a: 1 }, "PATCH").method).toBe("PATCH");
  });
});
