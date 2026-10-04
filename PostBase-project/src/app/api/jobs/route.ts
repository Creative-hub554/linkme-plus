import { db } from "@/lib/db";
import { jobs, companies, jobApplications, pageRoles } from "@/lib/db/schema";
import {
  optionalAuth,
  requireAuth,
  successResponse,
  errorResponse,
  paginatedResponse,
} from "@/lib/api-helpers";
import { eq, and, inArray, sql, count, desc } from "drizzle-orm";
import { isUuid } from "@/lib/cursor-pagination";

/**
 * A company is administered through the Page it belongs to.
 *
 * `companies.page_id` names the Page a company is part of, and the rows that
 * make somebody an admin of that Page are its `page_roles` admin rows — the same
 * edge the Page route checks before it lets anyone edit or delete. There is no
 * separate company-admin table, and a company with no Page (`page_id` null) has
 * no admin at all, so nobody administers it: posting to it, editing its jobs or
 * archiving them is refused rather than left open to any signed-in member.
 */
async function adminsCompany(userId: string, pageId: string | null): Promise<boolean> {
  if (!pageId) return false;
  const [role] = await db
    .select({ id: pageRoles.id })
    .from(pageRoles)
    .where(
      and(eq(pageRoles.pageId, pageId), eq(pageRoles.userId, userId), eq(pageRoles.role, "admin")),
    );
  return Boolean(role);
}

export async function GET(request: Request) {
  // Browsing is public: the jobs board is one of the product's discovery
  // surfaces, and the signed-out header advertises it to visitors. The session
  // is read because the single-job branch carries the viewer's own "have I
  // applied" flag — a visitor simply gets `hasApplied: false`, never a 401
  // hollow page.
  const { session } = await optionalAuth(request);

  const url = new URL(request.url);
  const jobId = url.searchParams.get("id");
  const companyId = url.searchParams.get("companyId");
  // Both are bound into `uuid` columns below, so a value that is not one is a
  // 400 rather than a cast failure the catch reports as a 500.
  if (jobId && !isUuid(jobId)) return errorResponse("Invalid job id", 400);
  if (companyId && !isUuid(companyId)) return errorResponse("Invalid company id", 400);
  const type = url.searchParams.get("type");
  const location = url.searchParams.get("location");
  const page = parseInt(url.searchParams.get("page") || "1");
  const limit = parseInt(url.searchParams.get("limit") || "20");
  const offset = (page - 1) * limit;

  try {
    if (jobId) {
      const [job] = await db
        .select({
          id: jobs.id,
          title: jobs.title,
          location: jobs.location,
          remoteStatus: jobs.remoteStatus,
          jobType: jobs.jobType,
          salaryMin: jobs.salaryMin,
          salaryMax: jobs.salaryMax,
          description: jobs.description,
          requirements: jobs.requirements,
          skills: jobs.skills,
          status: jobs.status,
          deadline: jobs.deadline,
          createdAt: jobs.createdAt,
          company: {
            id: companies.id,
            name: companies.name,
            logoUrl: companies.logoUrl,
            website: companies.website,
          },
        })
        .from(jobs)
        .innerJoin(companies, eq(jobs.companyId, companies.id))
        .where(eq(jobs.id, jobId));

      if (!job) {
        return errorResponse("Job not found", 404);
      }

      // Check if user applied — a member's own flag, so a visitor (no
      // session) is answered without the read at all rather than filtering by
      // a user id that does not exist.
      const applied = session
        ? (
            await db
              .select()
              .from(jobApplications)
              .where(
                and(
                  eq(jobApplications.jobId, jobId),
                  eq(jobApplications.userId, session.user.id),
                ),
              )
          )[0]
        : undefined;

      return successResponse({
        job,
        hasApplied: !!applied,
        applicationStatus: applied?.status || null,
      });
    }

    // List jobs
    const query = db
      .select({
        id: jobs.id,
        title: jobs.title,
        location: jobs.location,
        remoteStatus: jobs.remoteStatus,
        jobType: jobs.jobType,
        salaryMin: jobs.salaryMin,
        salaryMax: jobs.salaryMax,
        status: jobs.status,
        deadline: jobs.deadline,
        createdAt: jobs.createdAt,
        company: {
          id: companies.id,
          name: companies.name,
          logoUrl: companies.logoUrl,
        },
      })
      .from(jobs)
      .innerJoin(companies, eq(jobs.companyId, companies.id))
      .where(
        and(
          eq(jobs.status, "active"),
          companyId ? eq(jobs.companyId, companyId) : sql`1 = 1`,
          type ? eq(jobs.jobType, type) : sql`1 = 1`,
          location ? eq(jobs.location, location) : sql`1 = 1`
        )
      )
      .orderBy(desc(jobs.createdAt))
      .limit(limit)
      .offset(offset);

    const result = await query;

    const [{ total }] = await db
      .select({ total: count() })
      .from(jobs)
      .where(eq(jobs.status, "active"));

    // The viewer's own applied flags ride the rows the same way the single-job
    // branch answers `hasApplied` and `applicationStatus`: one read for the whole
    // page — the page's ids, not a query per row — carrying each application's
    // status beside its job, and answered `false`/null without the read at all
    // when nobody is signed in, the same visitor discipline the single read
    // follows.
    const applications =
      session && result.length > 0
        ? await db
            .select({ jobId: jobApplications.jobId, status: jobApplications.status })
            .from(jobApplications)
            .where(
              and(
                eq(jobApplications.userId, session.user.id),
                inArray(jobApplications.jobId, result.map((job) => job.id)),
              ),
            )
        : [];
    const applicationsByJob = new Map(applications.map((application) => [application.jobId, application]));

    return paginatedResponse(
      result.map((job) => ({
        ...job,
        hasApplied: applicationsByJob.has(job.id),
        applicationStatus: applicationsByJob.get(job.id)?.status ?? null,
      })),
      total,
      page,
      limit,
    );
  } catch (err) {
    console.error("Get jobs error:", err);
    return errorResponse("Failed to fetch jobs", 500);
  }
}

export async function POST(request: Request) {
  const { session, error } = await requireAuth(request);
  if (error) return error;

  try {
    const body = await request.json();
    const {
      companyId,
      title,
      location,
      remoteStatus,
      jobType,
      salaryMin,
      salaryMax,
      description,
      requirements,
      skills,
      deadline,
    } = body;

    if (!companyId || !title) {
      return errorResponse("Company ID and title are required");
    }
    if (typeof companyId !== "string" || !isUuid(companyId)) {
      return errorResponse("Invalid company id", 400);
    }

    // Check company admin role
    const [company] = await db
      .select({ id: companies.id, pageId: companies.pageId })
      .from(companies)
      .where(eq(companies.id, companyId));

    if (!company) {
      return errorResponse("Company not found", 404);
    }

    if (!(await adminsCompany(session.user.id, company.pageId))) {
      return errorResponse("Only a company admin can post a job", 403);
    }

    const [newJob] = await db
      .insert(jobs)
      .values({
        companyId,
        title,
        location,
        remoteStatus,
        jobType,
        salaryMin,
        salaryMax,
        description,
        requirements,
        skills,
        deadline: deadline ? new Date(deadline) : null,
        status: "active",
      })
      .returning();

    return successResponse({ job: newJob }, 201);
  } catch (err) {
    console.error("Create job error:", err);
    return errorResponse("Failed to create job", 500);
  }
}

export async function PUT(request: Request) {
  const { session, error } = await requireAuth(request);
  if (error) return error;

  try {
    const body = await request.json();
    const {
      id,
      title,
      location,
      remoteStatus,
      jobType,
      salaryMin,
      salaryMax,
      description,
      requirements,
      skills,
      status,
      deadline,
    } = body;

    if (!id) {
      return errorResponse("Job ID is required");
    }
    if (!isUuid(id)) {
      return errorResponse("Invalid job id", 400);
    }

    // The job's company is what decides who may edit it, so the job is read
    // first — a missing job is a 404 rather than an anonymous 500 from the
    // update, and the company read that follows is keyed by the row it found.
    const [job] = await db
      .select({ id: jobs.id, companyId: jobs.companyId })
      .from(jobs)
      .where(eq(jobs.id, id));

    if (!job) {
      return errorResponse("Job not found", 404);
    }

    const [company] = await db
      .select({ pageId: companies.pageId })
      .from(companies)
      .where(eq(companies.id, job.companyId));

    if (!(await adminsCompany(session.user.id, company?.pageId ?? null))) {
      return errorResponse("Only a company admin can edit this job", 403);
    }

    const [updated] = await db
      .update(jobs)
      .set({
        title: title ?? undefined,
        location: location ?? undefined,
        remoteStatus: remoteStatus ?? undefined,
        jobType: jobType ?? undefined,
        salaryMin: salaryMin ?? undefined,
        salaryMax: salaryMax ?? undefined,
        description: description ?? undefined,
        requirements: requirements ?? undefined,
        skills: skills ?? undefined,
        status: status ?? undefined,
        deadline: deadline ? new Date(deadline) : undefined,
      })
      .where(eq(jobs.id, id))
      .returning();

    return successResponse({ job: updated });
  } catch (err) {
    console.error("Update job error:", err);
    return errorResponse("Failed to update job", 500);
  }
}

export async function DELETE(request: Request) {
  const { session, error } = await requireAuth(request);
  if (error) return error;

  try {
    const url = new URL(request.url);
    const id = url.searchParams.get("id");

    if (!id) {
      return errorResponse("Job ID is required");
    }
    if (!isUuid(id)) {
      return errorResponse("Invalid job id", 400);
    }

    // Same ownership read as `PUT`: the job names its company, and the company's
    // Page names its admins. A stranger meets a 403 whether the job exists or
    // not, and a missing job is a 404 on the read rather than on the update.
    const [job] = await db
      .select({ id: jobs.id, companyId: jobs.companyId })
      .from(jobs)
      .where(eq(jobs.id, id));

    if (!job) {
      return errorResponse("Job not found", 404);
    }

    const [company] = await db
      .select({ pageId: companies.pageId })
      .from(companies)
      .where(eq(companies.id, job.companyId));

    if (!(await adminsCompany(session.user.id, company?.pageId ?? null))) {
      return errorResponse("Only a company admin can archive this job", 403);
    }

    const [deleted] = await db
      .update(jobs)
      .set({ status: "archived" })
      .where(eq(jobs.id, id))
      .returning();

    if (!deleted) {
      return errorResponse("Job not found", 404);
    }

    return successResponse({ success: true });
  } catch (err) {
    console.error("Delete job error:", err);
    return errorResponse("Failed to delete job", 500);
  }
}
