import { describe, expect, it, vi } from "vitest";

/**
 * `createClient()` is the browser-side Supabase factory. It does one thing: hand
 * the configured URL and anon key to `createBrowserClient` and return whatever
 * that builds. Everything the app does with Supabase starts here, so the one
 * thing worth pinning is *which* credentials it forwards — a factory that read
 * the wrong variable would build a client that silently talks to nothing.
 *
 * The env vars are set before the module is imported, because the module reads
 * them at import time and holds them in constants; assigning them afterwards
 * would test values the module never saw. `vi.hoisted` is the hook that runs
 * ahead of the imports.
 *
 * `@supabase/ssr` is mocked: the real factory would try to build a client
 * against no running project, and what is under test is this module's wiring,
 * not Supabase's.
 */
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
});

const createBrowserClient = vi.fn((_url: string, _key: string) => ({ marker: "browser-client" }));

vi.mock("@supabase/ssr", () => ({
  createBrowserClient: (url: string, key: string) => createBrowserClient(url, key),
}));

import { createClient } from "./client";

describe("the browser Supabase client", () => {
  it("builds a client from the configured URL and anon key", () => {
    const client = createClient();

    expect(client).toEqual({ marker: "browser-client" });
    expect(createBrowserClient).toHaveBeenCalledWith(
      "https://project.supabase.co",
      "anon-key",
    );
  });
});
