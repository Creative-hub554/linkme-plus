import { db } from "@/lib/db";
import { privateEvidence } from "@/lib/db/schema";
import { deletePrivateEvidence } from "@/lib/private-evidence";
import { and, eq, isNull, lte } from "drizzle-orm";
export async function purgeExpiredEvidence() {
  const now = new Date();
  const rows = await db.select({ id: privateEvidence.id, objectKey: privateEvidence.objectKey }).from(privateEvidence).where(and(isNull(privateEvidence.deletedAt), lte(privateEvidence.deleteAfter, now))).limit(100);
  let deleted = 0, failed = 0;
  for (const row of rows) {
    try {
      await deletePrivateEvidence(row.objectKey);
      await db.update(privateEvidence).set({ deletedAt: now }).where(eq(privateEvidence.id, row.id));
      deleted++;
    } catch { failed++; }
  }
  // Only counts are logged; evidence paths and user identifiers remain private.
  console.log("Private evidence retention", { deleted, failed });
  return { deleted, failed };
}
