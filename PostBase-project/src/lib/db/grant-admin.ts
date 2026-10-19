import { db } from "./index";
import { users } from "./schema";
import { eq } from "drizzle-orm";

/**
 * Owner's console for the one privilege that guards everything else: who holds
 * the `admin` role.
 *
 * The admin dashboard and every admin API route read this column as their
 * authority, and nothing in the application writes it — no page, no route and
 * no admin action can create another admin. That is deliberate: the set of
 * admins should be exactly the accounts the owner has elevated here, from a
 * machine that has the database connection string and by nobody else. The
 * counterpart to a privilege with no in-app donor is a console command with a
 * clear record; the command prints the account's resulting role, so a run
 * leaves its own evidence in the terminal.
 *
 *   npm run admin:grant -- you@example.com
 *   npm run admin:grant -- --list
 *   npm run admin:grant -- --revoke you@example.com
 *
 * Revocation takes its own flag (rather than a separate script) so the grant
 * and its undo are the one visible pair. `--list` answers with whom currently
 * holds the role — the whole of the answer, since the column is the authority
 * everywhere.
 */

// Node's globals are not typed in this project; the same cast is used in
// src/lib/db/index.ts and src/lib/db/seed.ts.
const runtimeProcess = (globalThis as { process?: { argv?: string[]; exitCode?: number } }).process;
const args = runtimeProcess?.argv?.slice(2) ?? [];

async function listAdmins() {
  const admins = await db
    .select({ email: users.email, username: users.username, since: users.createdAt })
    .from(users)
    .where(eq(users.role, "admin"));
  if (admins.length === 0) {
    console.log("No admin accounts — grant one with: npm run admin:grant -- <email>");
    return;
  }
  console.log(`${admins.length} admin account(s):`);
  for (const admin of admins) console.log(`  ${admin.email} (username: ${admin.username})`);
}

async function setRole(email: string, role: "admin" | "member") {
  const [account] = await db
    .select({ id: users.id, username: users.username, role: users.role })
    .from(users)
    .where(eq(users.email, email.trim().toLowerCase()));

  if (!account) {
    console.error(`No account found for ${email}. The address must match one that has signed up.`);
    runtimeProcess!.exitCode = 1;
    return;
  }

  if (account.role === role) {
    console.log(`${account.username} already holds the ${role} role; nothing changed.`);
    return;
  }

  const [updated] = await db
    .update(users)
    .set({ role })
    .where(eq(users.id, account.id))
    .returning({ role: users.role });

  console.log(`${account.username} now holds the ${updated.role} role.`);
  if (role === "admin") console.log("They can reach /admin. Change takes effect on their next request.");
}

const emailArg = args[args.length - 1];
const looksLikeEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailArg ?? "");

async function main() {
  if (args[0] === "--list") return listAdmins();
  if (args[0] === "--revoke" && looksLikeEmail) return setRole(emailArg, "member");
  if (args[0] === "--revoke" || !looksLikeEmail) {
    console.error("Usage: npm run admin:grant -- [--revoke] <email>   |   npm run admin:grant -- --list");
    runtimeProcess!.exitCode = 1;
    return;
  }
  return setRole(emailArg, "admin");
}

main()
  .catch((error) => {
    console.error("admin:grant failed:", error);
    runtimeProcess!.exitCode = 1;
  })
  .finally(async () => {
    await db.$client.end({ timeout: 5 });
  });
