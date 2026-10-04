import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The job-applications route: who may apply, who may decide, and how a status
 * changes.
 *
 * `POST` records the applicant as the **session's** user — a body that carries
 * its own `userId` is ignored, exactly as every other author id in the app is —
 * as a `pending` application, and refuses a second application to the same job
 * before writing. It also checks the **job exists** first, so an application can
 * no longer name a job that renders nowhere. `PUT` validates the status against
 * the `application_status` enum, reads the application, and refuses a caller who
 * does not administer the company that owns its job (the same company-via-Page
 * admin edge the `jobs` route checks), answering `404` for a missing row and
 * `403` for a stranger **before** the write. `GET` lists a job's applications
 * behind a required `jobId`, but only for an admin of the company that owns the
 * job — who applied is that company's own hiring information, not something any
 * signed-in member may read — answering `404` for a missing job and `403` for a
 * stranger **before** the list is read, and reporting the server's total in the
 * page envelope.
 *
 * The fake `@/lib/db` is table-keyed and does not evaluate `where`, so the
 * predicates here are not what the tests read — the route's answer to a read
 * that returned nothing, and its absence of a write, are. That limit is the same
 * one the post and comment route tests record.
 */
vi.mock("@/lib/db", async () => {
  const { fakeDb } = await import("@/test/fake-db");
  return {
    db: fakeDb,
    withDbRetry: (operation: () => unknown) => operation(),
  };
});

const session = vi.hoisted(() => ({ userId: "applicant-1" as string | null }));

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: async () => (session.userId ? { user: { id: session.userId } } : null),
    },
  },
}));

import { GET, POST, PUT } from "./route";
import { companies, jobApplications, jobs, pageRoles } from "@/lib/db/schema";
import { fakeDb, resetFakeDb } from "@/test/fake-db";
import { expectGatedNone, expectGatedSequence } from "@/test/expect-gated";

const JOB_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const APPLICATION_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
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
  session.userId = "applicant-1";
});

describe("POST /api/jobs/applications", () => {
  it("records the applicant as the session's user, not the body's", async () => {
    fakeDb
      .selectReturns(jobs, [{ id: JOB_ID }])
      .selectReturns(jobApplications, [])
      .insertReturns(jobApplications, [{ id: APPLICATION_ID, status: "pending" }]);

    const response = await POST(
      jsonRequest("POST", "/api/jobs/applications", {
        jobId: JOB_ID,
        coverLetter: "I would love to work here.",
        cvUrl: "https://test.r2.dev/cv/applicant-1.pdf",
        // A body that tries to claim the application on somebody else's behalf:
        // it must be ignored in favour of the session, as every author id is.
        userId: "someone-else",
      }),
    );

    expect(response.status).toBe(201);
    expectGatedSequence("writes", [
      {
        table: "job_applications",
        values: {
          jobId: JOB_ID,
          userId: "applicant-1",
          coverLetter: "I would love to work here.",
          cvUrl: "https://test.r2.dev/cv/applicant-1.pdf",
          status: "pending",
        },
      },
    ]);
  });

  it("answers 404 when the job does not exist, writing nothing", async () => {
    fakeDb.selectReturns(jobs, []);

    const response = await POST(
      jsonRequest("POST", "/api/jobs/applications", { jobId: JOB_ID }),
    );

    expect(response.status).toBe(404);
    expectGatedNone("writes");
    // The duplicate check is never reached, because there is no job to apply to.
    expect(fakeDb.reads).not.toContain("job_applications");
  });

  it("refuses a second application to the same job, writing nothing", async () => {
    // The duplicate check is the route's own guard: a row already there for
    // (job, user) means the request stops before the insert.
    fakeDb
      .selectReturns(jobs, [{ id: JOB_ID }])
      .selectReturns(jobApplications, [{ id: APPLICATION_ID }]);

    const response = await POST(
      jsonRequest("POST", "/api/jobs/applications", { jobId: JOB_ID }),
    );

    expect(response.status).toBe(400);
    expectGatedNone("writes");
  });

  it("refuses an application with no job, writing nothing", async () => {
    const response = await POST(
      jsonRequest("POST", "/api/jobs/applications", { coverLetter: "To whom?" }),
    );

    expect(response.status).toBe(400);
    // The message is the *presence* guard's, not the shape guard's — a missing
    // id must not be answered as a malformed one, or the two collapse.
    expect(await response.json()).toEqual({ error: "Job ID is required" });
    expectGatedNone("writes");
    // Nothing was read either: the job id is checked before any query.
    expectGatedNone("reads");
  });

  it("refuses a job id that is not uuid-shaped, writing nothing", async () => {
    const response = await POST(
      jsonRequest("POST", "/api/jobs/applications", { jobId: "not-a-uuid" }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid job id" });
    expectGatedNone("reads");
    expectGatedNone("writes");
  });

  it("answers 500 and writes nothing when the application insert fails", async () => {
    const silence = vi.spyOn(console, "error").mockImplementation(() => {});
    fakeDb
      .selectReturns(jobs, [{ id: JOB_ID }])
      .selectReturns(jobApplications, [])
      .failNextInsert(jobApplications, new Error("database unavailable"));
    try {
      const response = await POST(
        jsonRequest("POST", "/api/jobs/applications", { jobId: JOB_ID }),
      );

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: "Failed to create application" });
      expectGatedNone("writes");
    } finally {
      silence.mockRestore();
    }
  });
});

describe("PUT /api/jobs/applications", () => {
  it("requires both an application id and a status, writing nothing", async () => {
    const withoutId = await PUT(
      jsonRequest("PUT", "/api/jobs/applications", { status: "shortlisted" }),
    );
    const withoutStatus = await PUT(
      jsonRequest("PUT", "/api/jobs/applications", { id: APPLICATION_ID }),
    );

    expect(withoutId.status).toBe(400);
    expect(await withoutId.json()).toEqual({ error: "Application ID and status are required" });
    expect(withoutStatus.status).toBe(400);
    expect(await withoutStatus.json()).toEqual({
      error: "Application ID and status are required",
    });
    expectGatedNone("writes");
  });

  it("refuses an application id that is not uuid-shaped, reading and writing nothing", async () => {
    const response = await PUT(
      jsonRequest("PUT", "/api/jobs/applications", {
        id: "not-a-uuid",
        status: "shortlisted",
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid application id" });
    expectGatedNone("reads");
    expectGatedNone("writes");
  });

  it("refuses a status the schema does not allow, reading and writing nothing", async () => {
    const response = await PUT(
      jsonRequest("PUT", "/api/jobs/applications", {
        id: APPLICATION_ID,
        // A status no `application_status` value covers: refused before the
        // update, rather than failing the write with a 500 the caller cannot act on.
        status: "accepted",
      }),
    );

    expect(response.status).toBe(400);
    expectGatedNone("writes");
    expectGatedNone("reads");
  });

  it("answers 404 when the application does not exist, writing nothing", async () => {
    fakeDb.selectReturns(jobApplications, []);

    const response = await PUT(
      jsonRequest("PUT", "/api/jobs/applications", {
        id: APPLICATION_ID,
        status: "shortlisted",
      }),
    );

    expect(response.status).toBe(404);
    expectGatedNone("writes");
    // Ownership cannot be established, so the job is not read either.
    expect(fakeDb.reads).not.toContain("jobs");
  });

  it("refuses an application whose job the caller does not administer", async () => {
    fakeDb
      .selectReturns(jobApplications, [{ id: APPLICATION_ID, jobId: JOB_ID }])
      .selectReturns(jobs, [{ companyId: COMPANY_ID }])
      .selectReturns(companies, [{ pageId: PAGE_ID }])
      // No admin row for the caller on the company's Page.
      .selectReturns(pageRoles, []);

    const response = await PUT(
      jsonRequest("PUT", "/api/jobs/applications", {
        id: APPLICATION_ID,
        status: "shortlisted",
      }),
    );

    expect(response.status).toBe(403);
    expectGatedNone("writes");
  });

  it("refuses when the job's company belongs to no Page, because then nobody administers it", async () => {
    // The same deliberate limit as the jobs route: a company with a null
    // `page_id` has no Page to be an admin of, so its applications cannot be
    // decided — and `page_roles` is never read.
    fakeDb
      .selectReturns(jobApplications, [{ id: APPLICATION_ID, jobId: JOB_ID }])
      .selectReturns(jobs, [{ companyId: COMPANY_ID }])
      .selectReturns(companies, [{ pageId: null }]);

    const response = await PUT(
      jsonRequest("PUT", "/api/jobs/applications", {
        id: APPLICATION_ID,
        status: "shortlisted",
      }),
    );

    expect(response.status).toBe(403);
    expectGatedNone("writes");
    expect(fakeDb.reads).not.toContain("page_roles");
  });

  it("writes the status it was handed, for a company admin", async () => {
    fakeDb
      .selectReturns(jobApplications, [{ id: APPLICATION_ID, jobId: JOB_ID }])
      .selectReturns(jobs, [{ companyId: COMPANY_ID }])
      .selectReturns(companies, [{ pageId: PAGE_ID }])
      .selectReturns(pageRoles, [{ id: "role-1", role: "admin" }])
      .updateReturns(jobApplications, [{ id: APPLICATION_ID, status: "shortlisted" }]);

    const response = await PUT(
      jsonRequest("PUT", "/api/jobs/applications", {
        id: APPLICATION_ID,
        status: "shortlisted",
      }),
    );

    expect(response.status).toBe(200);
    expectGatedSequence("writes", [
      { table: "job_applications", values: { status: "shortlisted" } },
    ]);
  });

  it("answers 404 when the status update matches no row", async () => {
    fakeDb
      .selectReturns(jobApplications, [{ id: APPLICATION_ID, jobId: JOB_ID }])
      .selectReturns(jobs, [{ companyId: COMPANY_ID }])
      .selectReturns(companies, [{ pageId: PAGE_ID }])
      .selectReturns(pageRoles, [{ id: "role-1", role: "admin" }])
      .updateReturns(jobApplications, []);

    const response = await PUT(
      jsonRequest("PUT", "/api/jobs/applications", {
        id: APPLICATION_ID,
        status: "shortlisted",
      }),
    );

    // The application was read and authorized, but the write landed on no row:
    // it is reported as gone rather than as a success that did not happen.
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Application not found" });
  });

  it("answers 500 and writes nothing when the status update fails", async () => {
    const silence = vi.spyOn(console, "error").mockImplementation(() => {});
    fakeDb
      .selectReturns(jobApplications, [{ id: APPLICATION_ID, jobId: JOB_ID }])
      .selectReturns(jobs, [{ companyId: COMPANY_ID }])
      .selectReturns(companies, [{ pageId: PAGE_ID }])
      .selectReturns(pageRoles, [{ id: "role-1", role: "admin" }])
      .failNextUpdate(jobApplications, new Error("database unavailable"));
    try {
      const response = await PUT(
        jsonRequest("PUT", "/api/jobs/applications", {
          id: APPLICATION_ID,
          status: "shortlisted",
        }),
      );

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: "Failed to update application" });
      expectGatedNone("writes");
    } finally {
      silence.mockRestore();
    }
  });
});

describe("GET /api/jobs/applications", () => {
  it("requires a job id, reading nothing", async () => {
    const response = await GET(
      new Request("http://localhost/api/jobs/applications", { method: "GET" }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Job ID is required" });
    expectGatedNone("reads");
  });

  it("refuses a job id that is not uuid-shaped, reading nothing", async () => {
    const response = await GET(
      new Request("http://localhost/api/jobs/applications?jobId=not-a-uuid", { method: "GET" }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid job id" });
    expectGatedNone("reads");
  });

  it("answers 404 when the job does not exist, reading nothing further", async () => {
    fakeDb.selectReturns(jobs, []);

    const response = await GET(
      new Request(`http://localhost/api/jobs/applications?jobId=${JOB_ID}`, { method: "GET" }),
    );

    expect(response.status).toBe(404);
    // No job means no company to check and no applications to read.
    expect(fakeDb.reads).not.toContain("companies");
    expect(fakeDb.reads).not.toContain("job_applications");
  });

  it("refuses a caller who does not administer the job's company, reading no applications", async () => {
    // The list of who applied is the company's own hiring information: a
    // signed-in member who is not an admin of the job's company is refused
    // before the applications are ever read.
    fakeDb
      .selectReturns(jobs, [{ companyId: COMPANY_ID }])
      .selectReturns(companies, [{ pageId: PAGE_ID }])
      // No admin row for the caller on the company's Page.
      .selectReturns(pageRoles, []);

    const response = await GET(
      new Request(`http://localhost/api/jobs/applications?jobId=${JOB_ID}`, { method: "GET" }),
    );

    expect(response.status).toBe(403);
    expect(fakeDb.reads).not.toContain("job_applications");
  });

  it("refuses when the job's company belongs to no Page, because then nobody administers it", async () => {
    // The same deliberate limit as the `jobs` route and this route's `PUT`: a
    // company with a null `page_id` has no Page to be an admin of, so its
    // applications cannot be read — and `page_roles` is never consulted.
    fakeDb
      .selectReturns(jobs, [{ companyId: COMPANY_ID }])
      .selectReturns(companies, [{ pageId: null }]);

    const response = await GET(
      new Request(`http://localhost/api/jobs/applications?jobId=${JOB_ID}`, { method: "GET" }),
    );

    expect(response.status).toBe(403);
    expect(fakeDb.reads).not.toContain("page_roles");
    expect(fakeDb.reads).not.toContain("job_applications");
  });

  it("reports the server's total in the page envelope, for a company admin", async () => {
    fakeDb
      .selectReturns(jobs, [{ companyId: COMPANY_ID }])
      .selectReturns(companies, [{ pageId: PAGE_ID }])
      .selectReturns(pageRoles, [{ id: "role-1", role: "admin" }])
      .selectReturns(jobApplications, [{ id: APPLICATION_ID, status: "pending" }])
      .selectReturns(jobApplications, [{ total: 4 }]);

    const response = await GET(
      new Request(`http://localhost/api/jobs/applications?jobId=${JOB_ID}`, { method: "GET" }),
    );

    expect(response.status).toBe(200);
    // The total is the page's own count and drives the footer; four exist and
    // twenty fit in one page, so there is no next page.
    expect(await response.json()).toEqual({
      data: [{ id: APPLICATION_ID, status: "pending" }],
      pagination: { total: 4, page: 1, limit: 20, totalPages: 1, hasMore: false },
    });
  });

  it("answers 500 when the job read fails, recording no read", async () => {
    const silence = vi.spyOn(console, "error").mockImplementation(() => {});
    fakeDb.failNextSelect(jobs, new Error("database unavailable"));
    try {
      const response = await GET(
        new Request(`http://localhost/api/jobs/applications?jobId=${JOB_ID}`, { method: "GET" }),
      );

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: "Failed to fetch applications" });
      // The read never resolved, so the fake recorded nothing.
      expectGatedNone("reads");
    } finally {
      silence.mockRestore();
    }
  });
});
