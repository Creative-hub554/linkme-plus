import { beforeEach, expect, test, vi } from "vitest";
vi.mock("@/lib/db", async () => ({
  db: (await import("@/test/fake-db")).fakeDb,
}));
vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: async () => ({ user: { id: "owner" } }) } },
}));
import { GET } from "./route";
import { posts, marketplaceListings } from "@/lib/db/schema";
import { fakeDb, resetFakeDb } from "@/test/fake-db";
beforeEach(resetFakeDb);
test("promotion sources are scoped to owned listings and administered public Page posts", async () => {
  fakeDb.selectReturns(marketplaceListings, []).selectReturns(posts, []);
  expect(
    (await GET(new Request("http://localhost/api/advertising/sources"))).status,
  ).toBe(200);
  expect(fakeDb.selectParams[0]).toContain("owner");
  expect(fakeDb.selectParams[1]).toContain("owner");
  expect(fakeDb.selectParams[1]).toContain("admin");
  expect(fakeDb.selectParams[1]).toContain("public");
});

test("a failed promotion source read answers 500 rather than an empty picker", async () => {
  fakeDb.failNextSelect(marketplaceListings);
  const listingsFailure = await GET(
    new Request("http://localhost/api/advertising/sources"),
  );
  expect(listingsFailure.status).toBe(500);
  expect(await listingsFailure.json()).toEqual({
    error: "Unable to load promotion sources",
  });

  fakeDb.selectReturns(marketplaceListings, []).failNextSelect(posts);
  const postsFailure = await GET(
    new Request("http://localhost/api/advertising/sources"),
  );
  expect(postsFailure.status).toBe(500);
  expect(await postsFailure.json()).toEqual({
    error: "Unable to load promotion sources",
  });
});
