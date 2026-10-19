import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { ensureLocalUserProfile } from "@/lib/db/ensure-profile";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

/**
 * The admin dashboard's gate, and the reason the page under it stays a client
 * component that never asks who it is: every request to `/admin` passes through
 * this layout first, and the layout decides on the server, where the decision
 * cannot be turned off from the browser.
 *
 * Two refusals, each shaped to what the reader should see:
 *
 * - Signed out, the reader is sent to sign in — the same bounce every page
 *   under the Social module does.
 * - Signed in but not an admin, the route answers `notFound()`. A "not
 *   authorised" page would confirm this address exists and exists for some;
 *   a 404 is the only response that keeps the dashboard's presence from
 *   regular members entirely, which is the point of hiding it.
 *
 * The role read is the same `users.role` the admin API routes read (the reports
 * route is exactly this: `role !== "admin"` → 403), so the page and the routes
 * it calls decide on one truth. `ensureLocalUserProfile` runs first because
 * email sign-ups can reach the app before their local row exists; once it has,
 * a fresh reader's row is `member`, which is the refusal — none of the
 * provisioning writes a role other than the column's `member` default.
 *
 * Granting the role is deliberately not in-app. The owner promotes an account
 * from the database directly (`npm run admin:grant -- <email>`), so no page or
 * route can make another admin, and the set of admins is whoever the owner has
 * elevated — nothing else.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const user = await getUser();

  if (!user) redirect("/login");

  await ensureLocalUserProfile(user);

  const [row] = await db.select({ role: users.role }).from(users).where(eq(users.id, user.id));

  if (!row || row.role !== "admin") notFound();

  return children;
}
