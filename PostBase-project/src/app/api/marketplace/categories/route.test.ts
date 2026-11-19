import { beforeEach, expect, test, vi } from "vitest";
vi.mock("@/lib/db", async () => ({
  db: (await import("@/test/fake-db")).fakeDb,
}));
import { GET } from "./route";
import { fakeDb, resetFakeDb } from "@/test/fake-db";
import { categories } from "@/lib/db/schema";
beforeEach(resetFakeDb);
test("lists marketplace categories without exposing other modules' categories", async () => {
  fakeDb.selectReturns(categories, [{ id: "category", name: "Electronics" }]);
  const response = await GET();
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    categories: [{ id: "category", name: "Electronics" }],
  });
  expect(fakeDb.selectParams[0]).toEqual(["marketplace"]);
});
test("answers 500 with its own message when the category read fails", async () => {
  fakeDb.failNextSelect(categories, new Error("database unavailable"));
  const response = await GET();
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: "Unable to load categories" });
});
