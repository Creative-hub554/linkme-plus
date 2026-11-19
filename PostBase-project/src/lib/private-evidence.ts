import { createHmac, timingSafeEqual } from "node:crypto";
import { PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { r2Client, BUCKET_NAME } from "@/lib/r2";
export function privateEvidenceBucket(): string {
  const bucket = process.env.R2_PRIVATE_BUCKET_NAME?.trim();
  if (!bucket || bucket === BUCKET_NAME) throw new Error("Private evidence storage is not configured");
  return bucket;
}
function sign(value: string): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) throw new Error("Private evidence signing is not configured");
  return createHmac("sha256", secret).update(value).digest("hex");
}
export function evidenceAccessSignature(userId: string, id: string, expires: number): string {
  return sign(`evidence:${userId}:${id}:${expires}`);
}
export function verifyEvidenceAccess(userId: string, id: string, expires: number, signature: string): boolean {
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(expires) || expires < now || expires > now + 120 || !/^[a-f0-9]{64}$/.test(signature)) return false;
  try { return timingSafeEqual(Buffer.from(evidenceAccessSignature(userId, id, expires), "hex"), Buffer.from(signature, "hex")); }
  catch { return false; }
}
export async function putPrivateEvidence(key: string, body: Uint8Array) {
  await r2Client.send(new PutObjectCommand({ Bucket: privateEvidenceBucket(), Key: key, Body: body, ContentType: "image/webp" }));
}
export async function readPrivateEvidence(key: string) {
  return r2Client.send(new GetObjectCommand({ Bucket: privateEvidenceBucket(), Key: key }));
}
export async function deletePrivateEvidence(key: string) {
  await r2Client.send(new DeleteObjectCommand({ Bucket: privateEvidenceBucket(), Key: key }));
}
