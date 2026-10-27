import { beforeEach, expect, test, vi } from "vitest";
vi.mock("@/lib/db", async () => ({
  db: (await import("@/test/fake-db")).fakeDb,
}));
vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: async () => ({ user: { id: "viewer" } }) } },
}));
import { POST } from "./route";
import { adCampaigns, adEvents } from "@/lib/db/schema";
import { fakeDb, resetFakeDb } from "@/test/fake-db";
beforeEach(resetFakeDb);
const id = "22222222-2222-4222-8222-222222222222";
test("a duplicate member view cannot increment the campaign metrics twice", async () => {
  fakeDb.selectReturns(adCampaigns, [{ id }]).insertReturns(adEvents, []);
  const response = await POST(
    new Request("http://localhost/api/advertising/events", {
      method: "POST",
      body: JSON.stringify({ campaignId: id, event: "impression" }),
    }),
  );
  expect(await response.json()).toEqual({ recorded: false });
  expect(fakeDb.writes.map((item) => item.table)).toEqual(["ad_events"]);
});
