import { beforeEach, expect, test, vi } from "vitest";
vi.mock("@/lib/db", async () => ({
  db: (await import("@/test/fake-db")).fakeDb,
}));
import { fakeDb, resetFakeDb } from "@/test/fake-db";
import { accountRestrictions } from "@/lib/db/schema";
import { isRestrictedAccount } from "./account-restrictions";
beforeEach(resetFakeDb);
test("enforces bans and live suspensions while allowing expired suspensions", async () => {
  fakeDb
    .selectReturns(accountRestrictions, [{ kind: "ban", until: null }])
    .selectReturns(accountRestrictions, [
      { kind: "suspension", until: new Date(Date.now() + 86400000) },
    ])
    .selectReturns(accountRestrictions, [
      { kind: "suspension", until: new Date(0) },
    ])
    .selectReturns(accountRestrictions, []);
  expect(await isRestrictedAccount("member")).toBe(true);
  expect(await isRestrictedAccount("member")).toBe(true);
  expect(await isRestrictedAccount("member")).toBe(false);
  expect(await isRestrictedAccount("member")).toBe(false);
  expect(fakeDb.selectParams.every((params) => params.includes("member"))).toBe(
    true,
  );
});
test("database failure cannot silently permit a restricted account", async () => {
  fakeDb.failNextSelect(accountRestrictions, new Error("offline"));
  await expect(isRestrictedAccount("member")).rejects.toThrow("offline");
});
