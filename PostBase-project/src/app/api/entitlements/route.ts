import { db } from "@/lib/db";
import { requireAuth, successResponse, errorResponse } from "@/lib/api-helpers";
import { sellerUsage } from "@/lib/seller-entitlements";
export async function GET(request: Request) {
  const { session, error } = await requireAuth(request); if (error) return error;
  try { return successResponse({ seller: await sellerUsage(db, session.user.id) }); }
  catch { return errorResponse("Plan usage is temporarily unavailable", 503); }
}
