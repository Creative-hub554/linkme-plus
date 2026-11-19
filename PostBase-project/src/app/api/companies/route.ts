import { db } from "@/lib/db";
import { companies, pageRoles, pages } from "@/lib/db/schema";
import { requireAuth, successResponse, errorResponse } from "@/lib/api-helpers";
import { and, eq } from "drizzle-orm";
import { isUuid } from "@/lib/cursor-pagination";

export async function GET(request: Request) {
  const { session, error } = await requireAuth(request);
  if (error) return error;
  try {
    const managed = await db
      .select({ id: companies.id, name: companies.name })
      .from(companies)
      .innerJoin(pageRoles, eq(companies.pageId, pageRoles.pageId))
      .where(
        and(eq(pageRoles.userId, session.user.id), eq(pageRoles.role, "admin")),
      );
    const managedPages = await db
      .select({ id: pages.id, name: pages.name })
      .from(pages)
      .innerJoin(pageRoles, eq(pages.id, pageRoles.pageId))
      .where(
        and(eq(pageRoles.userId, session.user.id), eq(pageRoles.role, "admin")),
      );
    return successResponse({ companies: managed, pages: managedPages });
  } catch {
    return errorResponse("Unable to load your companies", 500);
  }
}

export async function POST(request: Request) {
  const { session, error } = await requireAuth(request);
  if (error) return error;
  try {
    const body = await request.json();
    if (typeof body.pageId !== "string" || !isUuid(body.pageId))
      return errorResponse("Select a valid Page");
    const [role] = await db
      .select({ id: pageRoles.id })
      .from(pageRoles)
      .where(
        and(
          eq(pageRoles.pageId, body.pageId),
          eq(pageRoles.userId, session.user.id),
          eq(pageRoles.role, "admin"),
        ),
      );
    if (!role)
      return errorResponse(
        "Only a Page administrator can create its company",
        403,
      );
    const [page] = await db
      .select({ name: pages.name })
      .from(pages)
      .where(eq(pages.id, body.pageId));
    if (!page) return errorResponse("Page not found", 404);
    const [existing] = await db
      .select({ id: companies.id, name: companies.name })
      .from(companies)
      .where(eq(companies.pageId, body.pageId));
    if (existing) return successResponse({ company: existing });
    const [company] = await db
      .insert(companies)
      .values({ pageId: body.pageId, name: page.name })
      .onConflictDoNothing({ target: companies.pageId })
      .returning();
    if (!company) {
      const [created] = await db.select({ id: companies.id, name: companies.name }).from(companies).where(eq(companies.pageId, body.pageId));
      if (!created) return errorResponse("Company creation conflicted. Please retry.", 409);
      return successResponse({ company: created });
    }
    return successResponse({ company }, 201);
  } catch {
    return errorResponse("Unable to create company", 500);
  }
}
