import { beforeEach, afterEach, expect, test, vi } from "vitest";
vi.mock("@/lib/db", async () => ({ db: (await import("@/test/fake-db")).fakeDb }));
const auth = vi.hoisted(() => ({ id: "owner" as string | null }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: async () => auth.id ? { user: { id: auth.id } } : null } } }));
const storage = vi.hoisted(() => ({ configured: true, put: vi.fn(), read: vi.fn(), remove: vi.fn() }));
vi.mock("@/lib/private-evidence", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/private-evidence")>(), privateEvidenceBucket: () => { if (!storage.configured) throw new Error("Missing"); return "private-evidence"; }, putPrivateEvidence: storage.put, readPrivateEvidence: storage.read, deletePrivateEvidence: storage.remove }));
import { fakeDb, resetFakeDb } from "@/test/fake-db";
import { privateEvidence, users } from "@/lib/db/schema";
import { GET, POST } from "./route";
const id = "11111111-1111-4111-8111-111111111111";
beforeEach(() => { resetFakeDb(); vi.clearAllMocks(); auth.id = "owner"; storage.configured = true; vi.stubEnv("AUTH_SECRET", "test-secret-for-private-evidence-more-than-32-characters"); });
afterEach(() => vi.unstubAllEnvs());
test("unsigned visitors cannot upload or read evidence", async () => {
  auth.id = null;
  expect((await POST(new Request("https://app.test/api/evidence", { method: "POST" }))).status).toBe(401);
  expect((await GET(new Request(`https://app.test/api/evidence?id=${id}`))).status).toBe(401);
  expect(storage.put).not.toHaveBeenCalled();
});
test("uploads are refused when private storage is missing", async () => {
  storage.configured = false;
  expect((await POST(new Request("https://app.test/api/evidence", { method: "POST" }))).status).toBe(503);
  expect(storage.put).not.toHaveBeenCalled();
});
test("a different ordinary member cannot obtain an evidence link", async () => {
  fakeDb.selectReturns(privateEvidence, [{ id, ownerId: "someone-else" }]).selectReturns(users, [{ role: "member" }]);
  expect((await GET(new Request(`https://app.test/api/evidence?id=${id}`))).status).toBe(404);
  expect(storage.read).not.toHaveBeenCalled();
});
test("owner links are short-lived and do not expose storage keys", async () => {
  fakeDb.selectReturns(privateEvidence, [{ id, ownerId: "owner", objectKey: "DO-NOT-EXPOSE" }]);
  const response = await GET(new Request(`https://app.test/api/evidence?id=${id}`));
  expect(response.status).toBe(200);
  const body = await response.text(); expect(body).not.toContain("DO-NOT-EXPOSE"); expect(body).toContain("signature=");
  expect(response.headers.get("cache-control")).toBe("private, no-store");
});
test("expired or forged evidence access never reaches object storage", async () => {
  fakeDb.selectReturns(privateEvidence, [{ id, ownerId: "owner", objectKey: "private" }]);
  expect((await GET(new Request(`https://app.test/api/evidence?id=${id}&download=true&expires=0&signature=forged`))).status).toBe(403);
  expect(storage.read).not.toHaveBeenCalled();
});
