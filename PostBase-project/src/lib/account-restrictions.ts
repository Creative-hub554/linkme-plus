import { db } from "@/lib/db";
import { accountRestrictions } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function isRestrictedAccount(userId: string) {
  const [restriction] = await db
    .select()
    .from(accountRestrictions)
    .where(eq(accountRestrictions.userId, userId));
  return Boolean(
    restriction &&
    (restriction.kind === "ban" ||
      (restriction.until && restriction.until > new Date())),
  );
}
