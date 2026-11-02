import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { db } from "@/lib/db";
import { privateEvidence, users } from "@/lib/db/schema";
import { requireAuth, successResponse, errorResponse } from "@/lib/api-helpers";
import { isUuid } from "@/lib/cursor-pagination";
import { and, eq, isNull } from "drizzle-orm";
import { privateEvidenceBucket, putPrivateEvidence, readPrivateEvidence, deletePrivateEvidence, evidenceAccessSignature, verifyEvidenceAccess } from "@/lib/private-evidence";
export async function POST(request: Request) {
  const { session, error } = await requireAuth(request); if (error) return error;
  try { privateEvidenceBucket(); evidenceAccessSignature(session.user.id, "preflight", Math.floor(Date.now() / 1000) + 90); } catch { return errorResponse("Private evidence storage is not configured. No document was uploaded.", 503); }
  try {
    const form = await request.formData(), file = form.get("file"), purpose = form.get("purpose");
    if (purpose !== "national_id" && purpose !== "office") return errorResponse("Choose an evidence purpose");
    if (!(file instanceof File) || !file.size || file.size > 10 * 1024 * 1024) return errorResponse("Upload an image up to 10 MB");
    let image;
    try {
      const input = Buffer.from(await file.arrayBuffer());
      const meta = await sharp(input, { limitInputPixels: 25000000 }).metadata();
      if (!meta.format || !["jpeg", "png", "webp"].includes(meta.format) || (meta.width ?? 0) < 200 || (meta.height ?? 0) < 200) return errorResponse("Upload a clear JPEG, PNG, or WebP image at least 200 pixels wide and high");
      image = await sharp(input, { limitInputPixels: 25000000 }).rotate().resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true }).webp({ quality: 88 }).toBuffer({ resolveWithObject: true });
    } catch { return errorResponse("The image could not be verified or processed", 422); }
    const id = randomUUID(), key = `evidence/${session.user.id}/${id}.webp`;
    await putPrivateEvidence(key, image.data);
    try {
      await db.insert(privateEvidence).values({ id, ownerId: session.user.id, purpose, objectKey: key, contentType: "image/webp", width: image.info.width, height: image.info.height, deleteAfter: purpose === "national_id" ? new Date(Date.now() + 90 * 86400000) : null });
    } catch { await deletePrivateEvidence(key).catch(() => {}); return errorResponse("Unable to record the private upload", 503); }
    return successResponse({ evidence: { id, purpose, width: image.info.width, height: image.info.height } }, 201);
  } catch { return errorResponse("Unable to upload private evidence", 503); }
}
export async function GET(request: Request) {
  const { session, error } = await requireAuth(request); if (error) return error;
  const url = new URL(request.url), id = url.searchParams.get("id");
  if (!id || !isUuid(id)) return errorResponse("Invalid evidence id");
  try {
    const [evidence] = await db.select().from(privateEvidence).where(and(eq(privateEvidence.id, id), isNull(privateEvidence.deletedAt)));
    if (!evidence || (evidence.deleteAfter && evidence.deleteAfter < new Date())) return errorResponse("Evidence unavailable", 404);
    if (evidence.ownerId !== session.user.id) {
      const [actor] = await db.select({ role: users.role }).from(users).where(eq(users.id, session.user.id));
      if (actor?.role !== "admin") return errorResponse("Evidence unavailable", 404);
    }
    privateEvidenceBucket();
    if (url.searchParams.get("download") === "true") {
      if (!verifyEvidenceAccess(session.user.id, id, Number(url.searchParams.get("expires")), url.searchParams.get("signature") ?? "")) return errorResponse("Evidence link expired", 403);
      const object = await readPrivateEvidence(evidence.objectKey);
      if (!object.Body) return errorResponse("Evidence unavailable", 404);
      const bytes = await object.Body.transformToByteArray();
      const payload = new Uint8Array(bytes.length); payload.set(bytes);
      return new Response(payload.buffer, { headers: { "Content-Type": evidence.contentType, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'" } });
    }
    const expires = Math.floor(Date.now() / 1000) + 90;
    const href = `/api/evidence?id=${id}&download=true&expires=${expires}&signature=${evidenceAccessSignature(session.user.id, id, expires)}`;
    const response = successResponse({ id, url: href, expires }); response.headers.set("Cache-Control", "private, no-store"); return response;
  } catch { return errorResponse("Private evidence is temporarily unavailable", 503); }
}
