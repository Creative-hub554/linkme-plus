import { beforeEach, expect, test, vi } from "vitest";
vi.mock("@/lib/db", async () => ({
  db: (await import("@/test/fake-db")).fakeDb,
}));
const auth = vi.hoisted(() => ({
  id: "11111111-1111-4111-8111-111111111111" as string | null,
}));
vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: async () => (auth.id ? { user: { id: auth.id } } : null),
    },
  },
}));
import { GET, POST } from "./route";
import { fakeDb, resetFakeDb } from "@/test/fake-db";
import { companies, pageRoles, pages } from "@/lib/db/schema";
const PAGE = "22222222-2222-4222-8222-222222222222";
const request = (body: unknown) =>
  new Request("http://localhost/api/companies", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  resetFakeDb();
  auth.id = "11111111-1111-4111-8111-111111111111";
});
test("visitors cannot list or create companies", async () => {
  auth.id = null;
  expect(
    (await GET(new Request("http://localhost/api/companies"))).status,
  ).toBe(401);
  expect((await POST(request({ pageId: PAGE }))).status).toBe(401);
  expect(fakeDb.reads).toEqual([]);
  expect(fakeDb.writes).toEqual([]);
});
test("a non-admin cannot create a company for someone else's Page", async () => {
  fakeDb.selectReturns(pageRoles, []);
  expect((await POST(request({ pageId: PAGE }))).status).toBe(403);
  expect(fakeDb.writes).toEqual([]);
});
test("a Page admin can create a company using the Page name", async () => {
  fakeDb
    .selectReturns(pageRoles, [{ id: "role" }])
    .selectReturns(pages, [{ name: "Studio" }])
    .selectReturns(companies, [])
    .insertReturns(companies, [{ id: "company", name: "Studio" }]);
  const response = await POST(
    request({ pageId: PAGE, name: "Untrusted name" }),
  );
  expect(response.status).toBe(201);
  expect(await response.json()).toEqual({
    company: { id: "company", name: "Studio" },
  });
  expect(fakeDb.writes[0]).toEqual({
    table: "companies",
    values: { pageId: PAGE, name: "Studio" },
  });
});
test("company selection is scoped to the viewer's admin roles", async () => {
  fakeDb
    .selectReturns(companies, [{ id: "company", name: "Studio" }])
    .selectReturns(pages, [{ id: PAGE, name: "Studio" }]);
  const response = await GET(new Request("http://localhost/api/companies"));
  expect(response.status).toBe(200);
  expect(fakeDb.reads).toEqual(["companies", "pages"]);
  expect(await response.json()).toMatchObject({
    companies: [{ name: "Studio" }],
    pages: [{ id: PAGE }],
  });
});
test("a concurrent company creator reuses the winning company", async () => {
  fakeDb.selectReturns(pageRoles, [{ id: "admin-role" }]).selectReturns(pages, [{ name: "Studio" }]).selectReturns(companies, []).insertReturns(companies, []).selectReturns(companies, [{ id: "winner", name: "Studio" }]);
  const response = await POST(request({ pageId: PAGE })); expect(response.status).toBe(200); expect(await response.json()).toEqual({ company: { id: "winner", name: "Studio" } });
});
