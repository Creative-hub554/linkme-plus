/**
 * Applies one migration file's statements, in order, directly.
 *
 * `drizzle-kit migrate` cannot be used on this project, and the reason is worth
 * knowing before reaching for it: the database was provisioned with
 * `drizzle-kit push`, so `drizzle.__drizzle_migrations` exists and is **empty**
 * while the whole schema is already there. `migrate` therefore starts at
 * `0000`, whose `CREATE TABLE "users"` fails against a database that already has
 * one, and — because each file is applied in a transaction — nothing is
 * recorded and nothing changes. Verified: after an attempt the tracking table
 * still had 0 rows and `profiles.appearance` did not exist.
 *
 * So this runs a file's statements itself. It is safe for a file written the way
 * this project's are (`ADD COLUMN IF NOT EXISTS`), and idempotent for that
 * reason; it does **not** record anything in the tracking table, which is the
 * one thing to remember if the project is ever baselined.
 *
 * Usage: node --env-file-if-exists=.env.local .freebuff/apply-migration.mjs drizzle/0009_profile_appearance.sql
 */
import { readFileSync } from "node:fs";
import postgres from "postgres";

const file = process.argv[2];
if (!file) {
  console.error("Usage: node .freebuff/apply-migration.mjs <migration.sql>");
  process.exit(2);
}

const raw = readFileSync(file, "utf8");
const statements = raw
  // drizzle's own marker between statements
  .split("--> statement-breakpoint")
  // `--` comments, whole-line only: no statement here contains a `--`
  .map((chunk) =>
    chunk
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n")
      .trim(),
  )
  .filter(Boolean)
  // Drizzle also writes a trailing `--> statement-breakpoint` sometimes; the
  // filter above is what drops the empty tail.
  .filter((statement) => /;/.test(statement));

// Mirrors `src/lib/db/index.ts`: local development uses Supabase's transaction
// pooler, and the session pooler on 5432 refuses long-lived desktop-dev
// connections. `prepare: false` is required by the transaction pooler.
let url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set — run with --env-file-if-exists=.env.local");
  process.exit(2);
}
try {
  const parsed = new URL(url);
  if (parsed.hostname.endsWith(".pooler.supabase.com") && parsed.port === "5432") {
    parsed.port = "6543";
    url = parsed.toString();
  }
} catch {
  /* let postgres-js report a malformed connection string itself */
}

const sql = postgres(url, { max: 1, prepare: false, connect_timeout: 10 });

try {
  let applied = 0;
  for (const statement of statements) {
    // One at a time and through `unsafe`: these are DDL statements with no
    // parameters, and the simple query protocol is what allows a file's
    // statements to be reported individually.
    await sql.unsafe(statement);
    applied += 1;
    console.log(`  ok  ${statement.replace(/\s+/g, " ").slice(0, 90)}`);
  }
  console.log(`\napplied ${applied} statement(s) from ${file}`);
} catch (error) {
  console.error(`\nfailed: ${error.message}`);
  console.error("Nothing is recorded in drizzle.__drizzle_migrations by this tool.");
  process.exitCode = 1;
} finally {
  await sql.end();
}
