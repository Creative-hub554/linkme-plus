import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { requireAuth, successResponse, errorResponse } from "@/lib/api-helpers";
import { users, verificationRequests } from "@/lib/db/schema";

const MAX_LINKS = 5;
const MAX_URL_LENGTH = 2048;

function parseEvidenceUrls(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_LINKS) return null;
  const urls: string[] = [];
  for (const raw of value) {
    if (typeof raw !== "string" || raw.length > MAX_URL_LENGTH) return null;
    try {
      const url = new URL(raw.trim());
      if (url.protocol !== "https:" || !url.hostname || url.username || url.password) return null;
      urls.push(url.toString());
    } catch {
      return null;
    }
  }
  return [...new Set(urls)];
}

/** Only the signed-in member can see their application and supporting links. */
export async function GET(request: Request) {
  const { session, error } = await requireAuth(request);
  if (error) return error;
  try {
    const [user] = await db.select({ verified: users.verified }).from(users).where(eq(users.id, session.user.id));
    const [latest] = await db.select({
      id: verificationRequests.id,
      evidenceUrls: verificationRequests.evidenceUrls,
      status: verificationRequests.status,
      reviewNote: verificationRequests.reviewNote,
      createdAt: verificationRequests.createdAt,
    }).from(verificationRequests)
      .where(eq(verificationRequests.userId, session.user.id))
      .orderBy(desc(verificationRequests.createdAt))
      .limit(1);
    return successResponse({ verified: Boolean(user?.verified), request: latest ?? null });
  } catch (err) {
    console.error("Get verification request error:", err);
    return errorResponse("Unable to load verification status", 500);
  }
}

/** Submit public links for review; verification is never self-awarded. */
export async function POST(request: Request) {
  const { session, error } = await requireAuth(request);
  if (error) return error;

  let body: { evidenceUrls?: unknown };
  try {
    body = await request.json();
  } catch {
    return errorResponse("Provide one to five public HTTPS links", 400);
  }
  const evidenceUrls = parseEvidenceUrls(body.evidenceUrls);
  if (!evidenceUrls || evidenceUrls.length < 1) {
    return errorResponse("Provide one to five unique public HTTPS links", 400);
  }

  try {
    const [user] = await db.select({ verified: users.verified }).from(users).where(eq(users.id, session.user.id));
    if (user?.verified) return errorResponse("This account is already verified", 409);
    const [pending] = await db.select({ id: verificationRequests.id }).from(verificationRequests)
      .where(and(eq(verificationRequests.userId, session.user.id), eq(verificationRequests.status, "pending")));
    if (pending) return errorResponse("A verification request is already under review", 409);

    const [created] = await db.insert(verificationRequests).values({
      userId: session.user.id,
      evidenceUrls,
      status: "pending",
    }).returning({ id: verificationRequests.id, status: verificationRequests.status, createdAt: verificationRequests.createdAt });
    return successResponse({ request: created }, 201);
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === "23505") {
      return errorResponse("A verification request is already under review", 409);
    }
    console.error("Create verification request error:", err);
    return errorResponse("Unable to submit verification request", 500);
  }
}
