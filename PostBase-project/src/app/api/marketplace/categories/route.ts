import { db } from "@/lib/db";
import { categories } from "@/lib/db/schema";
import { successResponse, errorResponse } from "@/lib/api-helpers";
import { asc, eq } from "drizzle-orm";

export async function GET() {
  try {
    const data = await db
      .select({ id: categories.id, name: categories.name })
      .from(categories)
      .where(eq(categories.type, "marketplace"))
      .orderBy(asc(categories.name));
    return successResponse({ categories: data });
  } catch {
    return errorResponse("Unable to load categories", 500);
  }
}
