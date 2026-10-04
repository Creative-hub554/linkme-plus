import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * `src/middleware.ts` is the thin entry Next calls: its only job is to hand the
 * request to `updateSession` and return what it says. The matcher beside it is
 * the other half of the contract — it is what keeps static assets and the image
 * optimiser off this path.
 *
 * `updateSession` is mocked, so the test pins the delegation and the matcher
 * rather than re-testing the session logic (which has its own file).
 */
vi.mock("@/utils/supabase/middleware", () => ({
  updateSession: vi.fn(async () => new Response("from updateSession", { status: 202 })),
}));

import { config, middleware } from "./middleware";
import { updateSession } from "@/utils/supabase/middleware";

describe("middleware", () => {
  it("returns whatever updateSession returns, for the same request", async () => {
    const request = new NextRequest("http://localhost/feed");

    const response = await middleware(request);

    expect(response.status).toBe(202);
    await expect(response.text()).resolves.toBe("from updateSession");
    expect(updateSession).toHaveBeenCalledWith(request);
  });

  it("exposes a matcher that skips static assets and the image optimiser", () => {
    expect(Array.isArray(config.matcher)).toBe(true);
    expect(config.matcher.length).toBeGreaterThan(0);
    const pattern = config.matcher[0];
    expect(pattern).toContain("_next/static");
    expect(pattern).toContain("_next/image");
  });
});
