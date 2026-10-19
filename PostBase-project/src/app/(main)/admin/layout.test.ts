import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The admin dashboard's gate.
 *
 * `/admin` is the one surface in the app whose presence itself is meant to be
 * invisible to members, and this page's protection lives entirely in its
 * layout — the client page cannot be trusted to decide, because anything the
 * browser can turn off the browser has turned off. So this pins the three
 * decisions the layout makes on the server:
 *
 * - nobody signed in is sent to sign in (a redirect, not a 404 — hidden);
 * - nobody whose `users.role` is not `admin` gets a `notFound()`, the response
 *   that does not admit the route exists (the admin API routes answer 403, but
 *   a page that is meant to be hideable answers with absence rather than a
 *   refusal);
 * - an admin's children are handed on untouched.
 *
 * The role is read through the same `users` table the admin API routes read,
 * with `ensureLocalUserProfile` stubbed out under the mock — the provisioning
 * helper has its own tests; here only its one gate-relevant property matters,
 * and that is pind in `fake-db` wiring: the layout reads, it never writes.
 */
const session = vi.hoisted(() => ({ user: null as { id: string } | null }));

const navigation = vi.hoisted(() => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: navigation.redirect,
  notFound: navigation.notFound,
}));

vi.mock("@/lib/auth", () => ({
  getUser: async () => session.user,
}));

vi.mock("@/lib/db/ensure-profile", () => ({
  ensureLocalUserProfile: vi.fn(async () => {}),
}));

vi.mock("@/lib/db", async () => {
  const { fakeDb } = await import("@/test/fake-db");
  return { db: fakeDb };
});

import AdminLayout from "./layout";
import { users } from "@/lib/db/schema";
import { fakeDb, resetFakeDb } from "@/test/fake-db";
import { expectGatedSequence } from "@/test/expect-gated";

const CHILDREN = "the dashboard";

beforeEach(() => {
  resetFakeDb();
  vi.clearAllMocks();
  session.user = null;
});

describe("the admin dashboard's gate", () => {
  it("sends a signed-out reader to login, reading nothing", async () => {
    await expect(AdminLayout({ children: CHILDREN })).rejects.toThrow("NEXT_REDIRECT:/login");

    expect(navigation.redirect).toHaveBeenCalledWith("/login");
    // Not even the role read: there is no user to read a role for.
    expectGatedSequence("reads", []);
  });

  it("hides the dashboard behind a 404 from a signed-in member, without rendering it", async () => {
    session.user = { id: "member-1" };
    fakeDb.selectReturns(users, [{ role: "member" }]);

    await expect(AdminLayout({ children: CHILDREN })).rejects.toThrow("NEXT_NOT_FOUND");

    expect(navigation.notFound).toHaveBeenCalledTimes(1);
    expectGatedSequence("reads", ["users"]);
  });

  it("answers a member whose local row has not landed with a 404, not a crash", async () => {
    session.user = { id: "fresh-1" };
    fakeDb.selectReturns(users, []);

    await expect(AdminLayout({ children: CHILDREN })).rejects.toThrow("NEXT_NOT_FOUND");

    expect(navigation.notFound).toHaveBeenCalledTimes(1);
  });

  it("hands an admin's children through untouched", async () => {
    session.user = { id: "admin-1" };
    fakeDb.selectReturns(users, [{ id: "admin-1", role: "admin" }]);

    await expect(AdminLayout({ children: CHILDREN })).resolves.toBe(CHILDREN);

    expect(navigation.notFound).not.toHaveBeenCalled();
    expect(navigation.redirect).not.toHaveBeenCalled();
  });

  it("refuses a moderator too: the dashboard is the admin's, not the review queue's", async () => {
    // The campaigns route admits moderators; the dashboard itself does not,
    // and this is the pin that keeps that split from drifting.
    session.user = { id: "mod-1" };
    fakeDb.selectReturns(users, [{ role: "moderator" }]);

    await expect(AdminLayout({ children: CHILDREN })).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
