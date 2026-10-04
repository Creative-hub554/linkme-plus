import { db } from "@/lib/db";
import { jobApplications, jobs, companies, pageRoles, applicationStatusEnum } from "@/lib/db/schema";
import { requireAuth, successResponse, errorResponse, paginatedResponse } from "@/lib/api-helpers";
import { eq, and, count, desc } from "drizzle-orm";
import { isUuid } from "@/lib/cursor-pagination";

/** The statuses the column accepts, read from the enum rather than copied. */
const APPLICATION_STATUSES = new Set<string>(applicationStatusEnum.enumValues);

/**
 * Whether `userId` is an admin of the Page a company belongs to.
 *
 * A company is administered through the Page it belongs to (`companies.page_id`),
 * and its `page_roles` admin rows are who may manage that company's jobs — the
 * same edge the `jobs` route checks. There is no separate company-admin table,
 * and a company with no Page (`page_id` null) has no admin at all, so nobody
 * administers it rather than it being open to any signed-in member.
 */
async function adminsCompanyPage(userId: string, pageId: string | null): Promise<boolean> {
  if (!pageId) return false;

  const [role] = await db
    .select({ id: pageRoles.id })
    .from(pageRoles)
    .where(
      and(eq(pageRoles.pageId, pageId), eq(pageRoles.userId, userId), eq(pageRoles.role, "admin")),
    );
  return Boolean(role);
}

/**
 * Whether `userId` administers the company that owns the job behind `jobId`.
 *
 * A job with no company, or a company with no Page, has no admin — so an
 * application on it cannot be managed, rather than being open to any caller.
 */
async function adminsJobsCompany(userId: string, jobId: string): Promise<boolean> {
  const [job] = await db
    .select({ companyId: jobs.companyId })
    .from(jobs)
    .where(eq(jobs.id, jobId));
  if (!job) return false;

  const [company] = await db
    .select({ pageId: companies.pageId })
    .from(companies)
    .where(eq(companies.id, job.companyId));

  return adminsCompanyPage(userId, company?.pageId ?? null);
}

export async function GET(request: Request) {
  const { session, error } = await requireAuth(request);
  if (error) return error;

  const url = new URL(request.url);
  const jobId = url.searchParams.get("jobId");
  const page = parseInt(url.searchParams.get("page") || "1");
  const limit = parseInt(url.searchParams.get("limit") || "20");
  const offset = (page - 1) * limit;

  if (!jobId) {
    return errorResponse("Job ID is required");
  }
  // Bound into a `uuid` column below, so a value that is not one is a 400.
  if (!isUuid(jobId)) {
    return errorResponse("Invalid job id", 400);
  }

  try {
    // Who applied to a job is that company's own hiring information, so reading
    // it is scoped exactly like deciding it: only an admin of the company that
    // owns the job may see the list. A job that is not there is a 404 on the
    // read, and its company's Page decides the rest.
    const [job] = await db
      .select({ companyId: jobs.companyId })
      .from(jobs)
      .where(eq(jobs.id, jobId));

    if (!job) {
      return errorResponse("Job not found", 404);
    }

    const [company] = await db
      .select({ pageId: companies.pageId })
      .from(companies)
      .where(eq(companies.id, job.companyId));

    if (!(await adminsCompanyPage(session.user.id, company?.pageId ?? null))) {
      return errorResponse("Only a company admin can view applications", 403);
    }

    const result = await db
      .select()
      .from(jobApplications)
      .where(eq(jobApplications.jobId, jobId))
      .orderBy(desc(jobApplications.createdAt))
      .limit(limit)
      .offset(offset);

    const [{ total }] = await db
      .select({ total: count() })
      .from(jobApplications)
      .where(eq(jobApplications.jobId, jobId));

    return paginatedResponse(result, total, page, limit);
  } catch (err) {
    console.error("Get applications error:", err);
    return errorResponse("Failed to fetch applications", 500);
  }
}

export async function POST(request: Request) {
  const { session, error } = await requireAuth(request);
  if (error) return error;

  try {
    const body = await request.json();
    const { jobId, coverLetter, cvUrl } = body;

    if (!jobId) {
      return errorResponse("Job ID is required");
    }
    if (typeof jobId !== "string" || !isUuid(jobId)) {
      return errorResponse("Invalid job id", 400);
    }

    // The job has to exist before anybody applies to it: without this read an
    // application can name a job nothing renders.
    const [job] = await db
      .select({ id: jobs.id })
      .from(jobs)
      .where(eq(jobs.id, jobId));

    if (!job) {
      return errorResponse("Job not found", 404);
    }

    // Check if already applied
    const [existing] = await db
      .select()
      .from(jobApplications)
      .where(
        and(eq(jobApplications.jobId, jobId), eq(jobApplications.userId, session.user.id))
      );

    if (existing) {
      return errorResponse("Already applied to this job");
    }

    const [application] = await db
      .insert(jobApplications)
      .values({
        jobId,
        userId: session.user.id,
        coverLetter,
        cvUrl,
        status: "pending",
      })
      .returning();

    return successResponse({ application }, 201);
  } catch (err) {
    console.error("Create application error:", err);
    return errorResponse("Failed to create application", 500);
  }
}

export async function PUT(request: Request) {
  const { session, error } = await requireAuth(request);
  if (error) return error;

  try {
    const body = await request.json();
    const { id, status } = body;

    if (!id || !status) {
      return errorResponse("Application ID and status are required");
    }
    if (typeof id !== "string" || !isUuid(id)) {
      return errorResponse("Invalid application id", 400);
    }

    // A status the column cannot hold fails the write with a 500 the caller
    // cannot act on, so it is refused here with the enum's own values.
    if (!APPLICATION_STATUSES.has(status)) {
      return errorResponse("Invalid application status", 400);
    }

    const [application] = await db
      .select({ id: jobApplications.id, jobId: jobApplications.jobId })
      .from(jobApplications)
      .where(eq(jobApplications.id, id));

    if (!application) {
      return errorResponse("Application not found", 404);
    }

    if (!(await adminsJobsCompany(session.user.id, application.jobId))) {
      return errorResponse("Only a company admin can update an application", 403);
    }

    const [updated] = await db
      .update(jobApplications)
      .set({ status })
      .where(eq(jobApplications.id, id))
      .returning();

    if (!updated) {
      return errorResponse("Application not found", 404);
    }

    return successResponse({ application: updated });
  } catch (err) {
    console.error("Update application error:", err);
    return errorResponse("Failed to update application", 500);
  }
}
