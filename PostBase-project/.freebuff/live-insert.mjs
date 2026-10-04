// Verifies the realtime feed by publishing as a demo member (or cleaning up).
// Usage: node --env-file-if-exists=.env.local .freebuff/live-insert.mjs <username> "<content>"
//        node --env-file-if-exists=.env.local .freebuff/live-insert.mjs --clean
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL missing");
  process.exit(1);
}

const sql = postgres(url.replace(":5432/", ":6543/"), { ssl: "require", max: 1 });
const args = process.argv.slice(2);

if (args[0] === "--clean") {
  const removed = await sql`delete from posts where content like '[realtime-probe]%' returning id`;
  console.log(`removed ${removed.length}`);
} else {
  const [username, content] = args;
  const [user] = await sql`select id from users where username = ${username}`;
  if (!user) {
    console.error(`no user ${username}`);
    process.exit(1);
  }
  const [row] = await sql`
    insert into posts (author_id, content, type, visibility)
    values (${user.id}, ${content}, 'text', 'public')
    returning id, created_at
  `;
  console.log(JSON.stringify({ ...row, at: Date.now() }));
}

await sql.end();
