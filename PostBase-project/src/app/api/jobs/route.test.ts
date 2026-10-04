import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The jobs route's validation, writes, and company-admin guard.
 *
 * A company is administered through the Page it belongs to: `companies.page_id`
 * names the Page, and its `page_roles` admin rows are who may manage the
 * company's jobs. So `POST` reads the company and refuses a caller who is not an
 * admin of its Page (a company with **no** Page has no admin, so nobody may post
 * to it), and `PUT`/`DELETE` read the job, then its company, then that same
 * admin edge — a stranger meets `403` and a missing job `404` before either
 * write or update is attempted. `PUT` writes only the fields it was given; a
 * `DELETE` archives (`status: "archived"`) rather than removing the row.
 *
 * The ownership gap this file used to record is closed: `jobs` no longer filters
 * on the id alone, so a signed-in member can no longer edit or archive any
 * posting. What is still recorded rather than pinned is the **null-Page** case —
 * a company that belongs to no Page is administered by nobody, so its jobs
 * cannot be managed through this API; that is a deliberate choice, not a bug,
 * and the test below names it.
 */
vi.mock("@/lib/db", async () => {
  const { fakeDb } = await import("@/test/fake-db");
  return {
    db: fakeDb,
    withDbRetry: (operation: () => unknown) => operation(),
  };
});

const session = vi.hoisted(() => ({ userId: "member-1" as string | null }));

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: async () => (session.userId ? { user: { id: session.userId } } : null),
    },
  },
}));

import { DELETE, GET, POST, PUT } from "./route";
import { companies, jobApplications, jobs, pageRoles } from "@/lib/db/schema";
import { fakeDb, resetFakeDb } from "@/test/fake-db";
import { expectGatedNone, expectGatedSequence } from "@/test/expect-gated";

const JOB_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SECOND_JOB_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const COMPANY_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PAGE_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function jsonRequest(method: string, path: string, body?: unknown) {
  return new Request(`http://localhost${path}`, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  });
}

beforeEach(() => {
  resetFakeDb();
  vi.clearAllMocks();
  session.userId = "member-1";
});

describe("GET /api/jobs", () => {
  it("answers 500 when the list read fails, recording no read", async () => {
    const silence = vi.spyOn(console, "error").mockImplementation(() => {});
    fakeDb.failNextSelect(jobs, new Error("database unavailable"));
    try {
      const response = await GET(new Request("http://localhost/api/jobs", { method: "GET" }));

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: "Failed to fetch jobs" });
      // The read never resolved, so the fake recorded nothing.
      expectGatedNone("reads");
    } finally {
      silence.mockRestore();
    }
  });

  it("returns one job by id, with whether the viewer has applied", async () => {
    fakeDb
      .selectReturns(jobs, [{ id: JOB_ID, title: "Staff Engineer" }])
      .selectReturns(jobApplications, [{ id: "application-1", status: "pending" }]);

    const response = await GET(new Request(`http://localhost/api/jobs?id=${JOB_ID}`));

    expect(response.status).toBe(200);
    const body = await response.json();
    // The single-job branch, not a one-item list: named by its id, with the
    // viewer's own application beside it.
    expect(body.job.id).toBe(JOB_ID);
    expect(body.hasApplied).toBe(true);
    expect(body.applicationStatus).toBe("pending");
  });

  it("answers 404 for a job that does not exist", async () => {
    fakeDb.selectReturns(jobs, []);

    const response = await GET(new Request(`http://localhost/api/jobs?id=${JOB_ID}`));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Job not found" });
    // The application read is never made for a job that is not there.
    expect(fakeDb.reads).toEqual(["jobs"]);
  });

  it("refuses a malformed job id and company filter instead of casting them", async () => {
    const byId = await GET(new Request("http://localhost/api/jobs?id=not-a-uuid"));
    expect(byId.status).toBe(400);
    expect(await byId.json()).toEqual({ error: "Invalid job id" });

    const byCompany = await GET(new Request("http://localhost/api/jobs?companyId=not-a-uuid"));
    expect(byCompany.status).toBe(400);
    expect(await byCompany.json()).toEqual({ error: "Invalid company id" });

    expectGatedNone("reads");
  });
});

describe("GET /api/jobs list read — the viewer's applied flags", () => {
  /**
   * The list is what a card is rendered from, so the viewer's own `hasApplied`
   * rides every listed row — the same contract the single-job branch has always
   * answered. One read carries the whole page's flags (the page's ids, not a
   * query per row), and the visitor discipline carries over too: with no session
   * the flag is answered `false` and the applications table is never read.
   */

  it("carries hasApplied and applicationStatus on the listed rows, from one read for the whole page", async () => {
    fakeDb
      .selectReturns(jobs, [
        { id: JOB_ID, title: "Staff Engineer" },
        { id: SECOND_JOB_ID, title: "Product designer" },
      ])
      .selectReturns(jobs, [{ total: 2 }])
      .selectReturns(jobApplications, [
        { jobId: JOB_ID, status: "reviewing" },
        { jobId: SECOND_JOB_ID, status: "hired" },
      ]);

    const response = await GET(new Request("http://localhost/api/jobs"));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data[0].hasApplied).toBe(true);
    expect(body.data[0].applicationStatus).toBe("reviewing");
    expect(body.data[1].hasApplied).toBe(true);
    expect(body.data[1].applicationStatus).toBe("hired");
    // The flags are the third read (page, count, flags) — one read, not one per
    // row — bound to the viewer and the page's ids, and it selects the status
    // beside the job id: a card shows the state, not only the fact.
    expect(fakeDb.reads).toEqual(["jobs", "jobs", "job_applications"]);
    expect(fakeDb.selectWheres[2]).toContain("job_applications");
    expect(fakeDb.selectParams[2]).toContain("member-1");
    expect(fakeDb.selectParams[2]).toContain(JOB_ID);
    expect(fakeDb.selectParams[2]).toContain(SECOND_JOB_ID);
  });

  it("answers hasApplied false on every row when the member has applied nowhere", async () => {
    fakeDb
      .selectReturns(jobs, [{ id: JOB_ID, title: "Staff Engineer" }])
      .selectReturns(jobs, [{ total: 1 }])
      .selectReturns(jobApplications, []);

    const response = await GET(new Request("http://localhost/api/jobs"));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data[0].hasApplied).toBe(false);
    // Nothing applied means nothing to report: the status is null beside the
    // false flag, the pair the card keys its badge on.
    expect(body.data[0].applicationStatus).toBeNull();
  });

  it("answers hasApplied false and applicationStatus null for a visitor without the application read", async () => {
    session.userId = null;
    fakeDb
      .selectReturns(jobs, [{ id: JOB_ID, title: "Staff Engineer" }])
      .selectReturns(jobs, [{ total: 1 }]);

    const response = await GET(new Request("http://localhost/api/jobs"));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data[0].hasApplied).toBe(false);
    // The status is the flag's companion, not a row of its own: where the flag
    // is answered without the read, the status is answered null the same way.
    expect(body.data[0].applicationStatus).toBeNull();
    expect(fakeDb.reads).not.toContain("job_applications");
  });

  it("makes no application read for an empty page", async () => {
    fakeDb
      .selectReturns(jobs, [])
      .selectReturns(jobs, [{ total: 0 }]);

    const response = await GET(new Request("http://localhost/api/jobs"));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toEqual([]);
    expect(fakeDb.reads).not.toContain("job_applications");
  });
});

describe("GET /api/jobs as a visitor", () => {
  /**
   * Browsing is the posture the signed-out header advertises: no session, and
   * no 401 hollow page. `beforeEach` signs every other case in, so these set
   * `session.userId` to null explicitly — the visitor the header's links are
   * served to. The writes stay member-only, pinned in the describe below.
   */
  it("answers the public list with data, not a 401", async () => {
    session.userId = null;
    fakeDb
      .selectReturns(jobs, [{ id: JOB_ID, title: "Staff Engineer" }])
      .selectReturns(jobs, [{ total: 1 }]);

    const response = await GET(new Request("http://localhost/api/jobs"));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].title).toBe("Staff Engineer");
  });

  it("reads one job for a visitor and answers hasApplied false without the application read", async () => {
    session.userId = null;
    fakeDb.selectReturns(jobs, [{ id: JOB_ID, title: "Staff Engineer" }]);

    const response = await GET(new Request(`http://localhost/api/jobs?id=${JOB_ID}`));

    expect(response.status).toBe(200);
    const body = await response.json();
    // The visitor's answer, not a member's default: `false` because there is
    // nobody to have applied, which is why the per-viewer read is never made —
    // its table is absent from the reads the fake recorded.
    expect(body.hasApplied).toBe(false);
    expect(body.applicationStatus).toBeNull();
    expect(fakeDb.reads).not.toContain("job_applications");
  });
});

describe("writes stay member-only", () => {
  // The other half of the same posture: discovery is public, but a job is
  // posted, edited and archived by a member — the write guards answer 401
  // before they read or write anything.
  it("answers 401 on POST, PUT and DELETE without a session", async () => {
    session.userId = null;

    const post = await POST(
      jsonRequest("POST", "/api/jobs", { companyId: COMPANY_ID, title: "Designer" }),
    );
    const put = await PUT(jsonRequest("PUT", "/api/jobs", { id: JOB_ID, title: "Renamed" }));
    const del = await DELETE(
      new Request(`http://localhost/api/jobs?id=${JOB_ID}`, { method: "DELETE" }),
    );

    expect(post.status).toBe(401);
    expect(put.status).toBe(401);
    expect(del.status).toBe(401);
    expectGatedNone("writes");
  });
});

describe("POST /api/jobs", () => {
  it("refuses a job with no company or no title, writing nothing", async () => {
    const withoutTitle = await POST(jsonRequest("POST", "/api/jobs", { companyId: COMPANY_ID }));
    const withoutCompany = await POST(jsonRequest("POST", "/api/jobs", { title: "Designer" }));

    expect(withoutTitle.status).toBe(400);
    expect(withoutCompany.status).toBe(400);
    expectGatedNone("writes");
  });

  it("refuses a company id that is not uuid-shaped, writing nothing", async () => {
    const response = await POST(
      jsonRequest("POST", "/api/jobs", { companyId: "not-a-uuid", title: "Designer" }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid company id" });
    expectGatedNone("reads");
    expectGatedNone("writes");
  });

  it("answers 404 when the company does not exist, writing nothing", async () => {
    fakeDb.selectReturns(companies, []);

    const response = await POST(
      jsonRequest("POST", "/api/jobs", { companyId: COMPANY_ID, title: "Designer" }),
    );

    expect(response.status).toBe(404);
    expectGatedNone("writes");
  });

  it("refuses a job for a company the caller does not administer, writing nothing", async () => {
    fakeDb
      .selectReturns(companies, [{ id: COMPANY_ID, pageId: PAGE_ID }])
      // No admin row for the caller on the company's Page.
      .selectReturns(pageRoles, []);

    const response = await POST(
      jsonRequest("POST", "/api/jobs", { companyId: COMPANY_ID, title: "Designer" }),
    );

    expect(response.status).toBe(403);
    expectGatedNone("writes");
  });

  it("refuses a company that belongs to no Page, because then nobody administers it", async () => {
    // A company with a null `page_id` has no Page to be an admin of, so the
    // guard refuses before it ever reads `page_roles` — the deliberate limit of
    // deriving company admin from the Page.
    fakeDb.selectReturns(companies, [{ id: COMPANY_ID, pageId: null }]);

    const response = await POST(
      jsonRequest("POST", "/api/jobs", { companyId: COMPANY_ID, title: "Designer" }),
    );

    expect(response.status).toBe(403);
    expectGatedNone("writes");
    expect(fakeDb.reads).not.toContain("page_roles");
  });

  it("writes the job as active when the caller administers the company's Page", async () => {
    fakeDb
      .selectReturns(companies, [{ id: COMPANY_ID, pageId: PAGE_ID }])
      .selectReturns(pageRoles, [{ id: "role-1", role: "admin" }])
      .insertReturns(jobs, [{ id: JOB_ID, status: "active" }]);

    const response = await POST(
      jsonRequest("POST", "/api/jobs", { companyId: COMPANY_ID, title: "Designer" }),
    );

    expect(response.status).toBe(201);
    expectGatedSequence("writes", [
      {
        table: "jobs",
        values: expect.objectContaining({ companyId: COMPANY_ID, title: "Designer", status: "active" }),
      },
    ]);
  });

  it("answers 500 and writes nothing when the job insert fails", async () => {
    const silence = vi.spyOn(console, "error").mockImplementation(() => {});
    fakeDb
      .selectReturns(companies, [{ id: COMPANY_ID, pageId: PAGE_ID }])
      .selectReturns(pageRoles, [{ id: "role-1", role: "admin" }])
      .failNextInsert(jobs, new Error("database unavailable"));
    try {
      const response = await POST(
        jsonRequest("POST", "/api/jobs", { companyId: COMPANY_ID, title: "Designer" }),
      );

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: "Failed to create job" });
      expectGatedNone("writes");
    } finally {
      silence.mockRestore();
    }
  });
});

describe("PUT /api/jobs", () => {
  it("refuses an update with no id, writing nothing", async () => {
    const response = await PUT(jsonRequest("PUT", "/api/jobs", { title: "Renamed" }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Job ID is required" });
    expectGatedNone("reads");
    expectGatedNone("writes");
  });

  it("refuses an update with a malformed id, writing nothing", async () => {
    const response = await PUT(
      jsonRequest("PUT", "/api/jobs", { id: "not-a-uuid", title: "Renamed" }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid job id" });
    expectGatedNone("reads");
    expectGatedNone("writes");
  });

  it("answers 404 when the job does not exist, writing nothing", async () => {
    fakeDb.selectReturns(jobs, []);

    const response = await PUT(jsonRequest("PUT", "/api/jobs", { id: JOB_ID, title: "Renamed" }));

    expect(response.status).toBe(404);
    expectGatedNone("writes");
  });

  it("refuses a job the caller does not administer, writing nothing", async () => {
    fakeDb
      .selectReturns(jobs, [{ id: JOB_ID, companyId: COMPANY_ID }])
      .selectReturns(companies, [{ pageId: PAGE_ID }])
      .selectReturns(pageRoles, []);

    const response = await PUT(jsonRequest("PUT", "/api/jobs", { id: JOB_ID, title: "Renamed" }));

    expect(response.status).toBe(403);
    expectGatedNone("writes");
  });

  it("writes only the fields the request carried", async () => {
    fakeDb
      .selectReturns(jobs, [{ id: JOB_ID, companyId: COMPANY_ID }])
      .selectReturns(companies, [{ pageId: PAGE_ID }])
      .selectReturns(pageRoles, [{ id: "role-1", role: "admin" }])
      .updateReturns(jobs, [{ id: JOB_ID, title: "Renamed" }]);

    const response = await PUT(jsonRequest("PUT", "/api/jobs", { id: JOB_ID, title: "Renamed" }));

    expect(response.status).toBe(200);
    // The unmentioned columns are absent from the write (`undefined`), so a
    // partial update cannot blank a field it was not asked about.
    expectGatedSequence("writes", [{ table: "jobs", values: { title: "Renamed" } }]);
  });

  it("answers 500 and writes nothing when the update fails", async () => {
    const silence = vi.spyOn(console, "error").mockImplementation(() => {});
    fakeDb
      .selectReturns(jobs, [{ id: JOB_ID, companyId: COMPANY_ID }])
      .selectReturns(companies, [{ pageId: PAGE_ID }])
      .selectReturns(pageRoles, [{ id: "role-1", role: "admin" }])
      .failNextUpdate(jobs, new Error("database unavailable"));
    try {
      const response = await PUT(jsonRequest("PUT", "/api/jobs", { id: JOB_ID, title: "Renamed" }));

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: "Failed to update job" });
      expectGatedNone("writes");
    } finally {
      silence.mockRestore();
    }
  });
});

describe("DELETE /api/jobs", () => {
  it("refuses a delete with no id, reading and writing nothing", async () => {
    const response = await DELETE(new Request("http://localhost/api/jobs", { method: "DELETE" }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Job ID is required" });
    expectGatedNone("reads");
    expectGatedNone("writes");
  });

  it("refuses a delete with a malformed id, reading and writing nothing", async () => {
    const response = await DELETE(
      new Request("http://localhost/api/jobs?id=not-a-uuid", { method: "DELETE" }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid job id" });
    expectGatedNone("reads");
    expectGatedNone("writes");
  });

  it("answers 404 when the job does not exist, before any company read", async () => {
    fakeDb.selectReturns(jobs, []);

    const response = await DELETE(
      new Request(`http://localhost/api/jobs?id=${JOB_ID}`, { method: "DELETE" }),
    );

    expect(response.status).toBe(404);
    expectGatedNone("writes");
    expect(fakeDb.reads).not.toContain("companies");
  });

  it("refuses to archive a job the caller does not administer", async () => {
    fakeDb
      .selectReturns(jobs, [{ id: JOB_ID, companyId: COMPANY_ID }])
      .selectReturns(companies, [{ pageId: PAGE_ID }])
      .selectReturns(pageRoles, []);

    const response = await DELETE(
      new Request(`http://localhost/api/jobs?id=${JOB_ID}`, { method: "DELETE" }),
    );

    expect(response.status).toBe(403);
    expectGatedNone("writes");
    expectGatedNone("deletes");
  });

  it("archives the job rather than removing the row, for a company admin", async () => {
    fakeDb
      .selectReturns(jobs, [{ id: JOB_ID, companyId: COMPANY_ID }])
      .selectReturns(companies, [{ pageId: PAGE_ID }])
      .selectReturns(pageRoles, [{ id: "role-1", role: "admin" }])
      .updateReturns(jobs, [{ id: JOB_ID }]);

    const response = await DELETE(
      new Request(`http://localhost/api/jobs?id=${JOB_ID}`, { method: "DELETE" }),
    );

    expect(response.status).toBe(200);
    expectGatedSequence("writes", [{ table: "jobs", values: { status: "archived" } }]);
    expectGatedNone("deletes");
  });

  it("answers 404 when the archive update matches no row", async () => {
    fakeDb
      .selectReturns(jobs, [{ id: JOB_ID, companyId: COMPANY_ID }])
      .selectReturns(companies, [{ pageId: PAGE_ID }])
      .selectReturns(pageRoles, [{ id: "role-1", role: "admin" }])
      .updateReturns(jobs, []);

    const response = await DELETE(
      new Request(`http://localhost/api/jobs?id=${JOB_ID}`, { method: "DELETE" }),
    );

    // The job was read and authorized, but the archive matched nothing — the
    // row is answered as gone rather than reporting a success that did not land.
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Job not found" });
  });

  it("answers 500 and writes nothing when the archive update fails", async () => {
    const silence = vi.spyOn(console, "error").mockImplementation(() => {});
    fakeDb
      .selectReturns(jobs, [{ id: JOB_ID, companyId: COMPANY_ID }])
      .selectReturns(companies, [{ pageId: PAGE_ID }])
      .selectReturns(pageRoles, [{ id: "role-1", role: "admin" }])
      .failNextUpdate(jobs, new Error("database unavailable"));
    try {
      const response = await DELETE(
        new Request(`http://localhost/api/jobs?id=${JOB_ID}`, { method: "DELETE" }),
      );

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: "Failed to delete job" });
      expectGatedNone("writes");
    } finally {
      silence.mockRestore();
    }
  });
});
