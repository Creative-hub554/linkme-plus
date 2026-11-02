import { db } from "@/lib/db";
import { jobUsage } from "@/lib/job-publication";
import { requireAuth, successResponse, errorResponse } from "@/lib/api-helpers";
export async function GET(request: Request) {
  const { session, error } = await requireAuth(request); if (error) return error;
  try {
    const usage = await jobUsage(db, session.user.id);
    return successResponse({ ...usage, freeRemaining: Math.max(0, 10 - usage.lifetimeApproved), paidRemaining: usage.paidPeriodActive ? Math.max(0, 30 - usage.paidPeriodApproved) : 0 });
  } catch { return errorResponse("Job usage is temporarily unavailable", 503); }
}
