import { db } from "@/lib/db";
import { jobs, jobPublications, privateEvidence, verificationRequests, accountSubscriptions, users, auditLogs } from "@/lib/db/schema";
import { and, eq, inArray, isNull, gt, lte, gte, lt, count } from "drizzle-orm";
import { isUuid } from "@/lib/cursor-pagination";
import { jobPublicationEntitlement } from "@/lib/plan-entitlements";
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export function invalidJobFields(body: Record<string, unknown>): string | null {
  for (const [field, limit] of [["title", 200], ["location", 100], ["remoteStatus", 30], ["jobType", 30], ["description", 20000], ["requirements", 20000]] as const) {
    const value = body[field];
    if (value !== undefined && value !== null && (typeof value !== "string" || value.length > limit)) return `Invalid ${field}`;
  }
  for (const field of ["salaryMin", "salaryMax"] as const) {
    const value = body[field];
    if (value !== undefined && value !== null && (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > 2147483647)) return "Invalid salary range";
  }
  if (typeof body.salaryMin === "number" && typeof body.salaryMax === "number" && body.salaryMin > body.salaryMax) return "Invalid salary range";
  if (body.skills !== undefined && (!Array.isArray(body.skills) || body.skills.length > 30 || !body.skills.every(value => typeof value === "string" && value.length <= 100))) return "Invalid skills";
  if (body.deadline !== undefined && body.deadline !== null && (typeof body.deadline !== "string" || !Number.isFinite(new Date(body.deadline).getTime()) || new Date(body.deadline) <= new Date())) return "A future application deadline is required";
  return null;
}
export function monthlyBillingPeriod(anchor: Date, now: Date): { start: Date; end: Date } {
  const at = (offset: number) => {
    const month = anchor.getUTCMonth() + offset, year = anchor.getUTCFullYear();
    const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    return new Date(Date.UTC(year, month, Math.min(anchor.getUTCDate(), lastDay), anchor.getUTCHours(), anchor.getUTCMinutes(), anchor.getUTCSeconds(), anchor.getUTCMilliseconds()));
  };
  let offset = (now.getUTCFullYear() - anchor.getUTCFullYear()) * 12 + now.getUTCMonth() - anchor.getUTCMonth();
  if (at(offset) > now) offset--;
  return { start: at(offset), end: at(offset + 1) };
}
export async function lockJobPublisher(tx: Tx, userId: string) {
  const [user] = await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for("update");
  if (!user) throw new Error("Publishing account unavailable");
}
export async function jobUsage(tx: Tx | typeof db, userId: string, now = new Date()) {
  const [lifetime] = await tx.select({ total: count() }).from(jobPublications).where(eq(jobPublications.publisherId, userId));
  const [subscription] = await tx.select().from(accountSubscriptions).where(and(eq(accountSubscriptions.userId, userId), eq(accountSubscriptions.kind, "employer"), lte(accountSubscriptions.startsAt, now), gt(accountSubscriptions.expiresAt, now)));
  const period = subscription ? monthlyBillingPeriod(subscription.startsAt, now) : null;
  const [paid] = period ? await tx.select({ total: count() }).from(jobPublications).where(and(eq(jobPublications.publisherId, userId), eq(jobPublications.allowance, "paid"), gte(jobPublications.approvedAt, period.start), lt(jobPublications.approvedAt, period.end))) : [];
  return { lifetimeApproved: Number(lifetime?.total ?? 0), paidPeriodApproved: Number(paid?.total ?? 0), paidPeriodActive: !!subscription, periodStart: period?.start ?? null, periodEnd: period?.end ?? null };
}
export async function validOfficeEvidence(tx: Tx, userId: string, ids: unknown): Promise<boolean> {
  if (!Array.isArray(ids) || !ids.length || ids.length > 5 || !ids.every(id => typeof id === "string" && isUuid(id)) || new Set(ids).size !== ids.length) return false;
  const rows = await tx.select().from(privateEvidence).where(and(inArray(privateEvidence.id, ids), eq(privateEvidence.ownerId, userId), eq(privateEvidence.purpose, "office"), isNull(privateEvidence.deletedAt)));
  return rows.length === ids.length && rows.every(row => row.width >= 200 && row.height >= 200 && (!row.deleteAfter || row.deleteAfter > new Date()));
}
export async function hasVerifiedIdentity(tx: Tx, userId: string): Promise<boolean> {
  const [row] = await tx.select({ id: verificationRequests.id }).from(verificationRequests).where(and(eq(verificationRequests.userId, userId), eq(verificationRequests.verificationKind, "national_id"), eq(verificationRequests.status, "approved"), isNull(verificationRequests.revokedAt)));
  return !!row;
}
export function jobReviewFlags(input: { title: string; description?: string | null; location?: string | null; deadline?: Date | null; duplicate: boolean }): string[] {
  const flags: string[] = [];
  if (!input.description || input.description.trim().length < 20) flags.push("Provide a complete job description");
  if (!input.location?.trim()) flags.push("Confirm the employer's job location");
  if (!input.deadline || !Number.isFinite(input.deadline.getTime()) || input.deadline <= new Date()) flags.push("Provide a future application deadline");
  if (input.duplicate) flags.push("A similar active job exists for this company");
  if (/(https?:\/\/|javascript:|data:)/i.test(`${input.title} ${input.description ?? ""}`)) flags.push("Review contact links and external destinations");
  return flags;
}
// Must be called after lockJobPublisher inside the transaction approving this job.
export async function approveJob(tx: Tx, job: typeof jobs.$inferSelect, reviewerId: string | null, note: string) {
  if (!job.publisherId) throw new Error("Original publishing account must be assigned before approval");
  if (!job.deadline || job.deadline <= new Date()) throw new Error("A future deadline is required before publication");
  if (!(await validOfficeEvidence(tx, job.publisherId, job.officeEvidenceIds))) throw new Error("Verified private office evidence is required");
  const [published] = await tx.select({ id: jobPublications.id }).from(jobPublications).where(eq(jobPublications.jobId, job.id));
  const usage = await jobUsage(tx, job.publisherId);
  const allowance = jobPublicationEntitlement({ ...usage, alreadyPublished: !!published });
  if (!allowance) throw new Error("The free job allowance is exhausted. An employer subscription with available credits is required.");
  const now = new Date();
  if (!published) await tx.insert(jobPublications).values({ jobId: job.id, publisherId: job.publisherId, allowance, periodStart: allowance === "paid" ? usage.periodStart : null, approvedAt: now });
  const [updated] = await tx.update(jobs).set({ status: "active", reviewStatus: "approved", reviewNote: note, reviewedBy: reviewerId, reviewedAt: now, firstPublishedAt: job.firstPublishedAt ?? now, pendingRevision: null }).where(eq(jobs.id, job.id)).returning();
  await tx.insert(auditLogs).values({ actorId: reviewerId, action: "job.published", targetType: "job", targetId: job.id, metadata: { source: reviewerId ? "administrator" : "system", allowance, publisherId: job.publisherId } });
  return updated;
}
