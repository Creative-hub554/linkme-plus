import { beforeEach, expect, test, vi } from "vitest";
vi.mock("@/lib/db", async () => ({ db: (await import("@/test/fake-db")).fakeDb }));
const auth = vi.hoisted(() => ({ id: "seller" as string | null }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: async () => auth.id ? { user: { id: auth.id } } : null } } }));
import { fakeDb, resetFakeDb } from "@/test/fake-db";
import { marketplaceListings } from "@/lib/db/schema";
import { GET } from "./route";
beforeEach(() => { resetFakeDb(); auth.id = "seller"; });
test("plan usage requires sign-in", async () => { auth.id = null; expect((await GET(new Request("https://app.test/api/entitlements"))).status).toBe(401); });
test("free seller quotas and counts belong only to the signed-in seller", async () => {
  fakeDb.selectReturns(marketplaceListings, [{ total: 50 }]).selectReturns(marketplaceListings, [{ total: 30 }]);
  const response = await GET(new Request("https://app.test/api/entitlements"));
  expect((await response.json()).seller).toMatchObject({ plan: "free", storedProducts: 50, publicProducts: 30, limits: { storedProducts: 50, publicProducts: 30 } });
  expect(fakeDb.selectParams.every(params => params.includes("seller"))).toBe(true);
});
