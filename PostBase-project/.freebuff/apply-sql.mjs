// Applies a migration's SQL to the database over the direct connection.
// Usage: unset DATABASE_URL; node --env-file-if-exists=.env.local .freebuff/apply-sql.mjs <file>
import { readFileSync } from "node:fs";
import postgres from "postgres";

const file = process.argv[2];
if (!file) {
  console.error("usage: apply-sql.mjs <file>");
  process.exit(1);
}
const sql = postgres(process.env.DATABASE_URL.replace(":5432/", ":6543/"), {
  ssl: "require",
  max: 1,
});
await sql.unsafe(readFileSync(file, "utf8"));
console.log("applied", file);
await sql.end();
