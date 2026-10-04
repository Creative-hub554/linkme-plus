// Temporary probe for verifying post-audience enforcement.
//
// Usage (always with: unset DATABASE_URL; node --env-file-if-exists=.env.local .freebuff/visibility-probe.mjs ...)
//   show <postId>              -> author, visibility, deleted, content preview
//   set <postId> <visibility>  -> change visibility, prints the new value
//   content <postId> <text>    -> change content (for search tests)
//   following <username>       -> usernames that member follows
//   candidates <viewerUsername> -> live posts not authored by viewer, with a
//                                 `follows` flag, so a test can pick one of each
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL missing");
  process.exit(1);
}
const sql = postgres(url.replace(":5432/", ":6543/"), { ssl: "require", max: 1 });
const [command, ...args] = process.argv.slice(2);

const userId = async (username) => {
  const [user] = await sql`select id from users where username = ${username}`;
  if (!user) throw new Error(`no user ${username}`);
  return user.id;
};

switch (command) {
  case "show": {
    const [row] = await sql`
      select p.id, u.username, p.visibility, p.deleted_at, p.content, p.created_at
      from posts p join users u on u.id = p.author_id
      where p.id = ${args[0]}
    `;
    console.log(JSON.stringify(row ?? null));
    break;
  }
  case "set": {
    const [row] = await sql`
      update posts set visibility = ${args[1]} where id = ${args[0]}
      returning id, visibility
    `;
    console.log(JSON.stringify(row ?? null));
    break;
  }
  case "content": {
    const [row] = await sql`
      update posts set content = ${args[1]} where id = ${args[0]}
      returning id, content
    `;
    console.log(JSON.stringify(row ?? null));
    break;
  }
  case "uid": {
    console.log(JSON.stringify(await userId(args[0])));
    break;
  }
  case "following": {
    const rows = await sql`
      select u.username from follows f
      join users u on u.id = f.following_id
      where f.follower_id = ${await userId(args[0])}
      order by u.username
    `;
    console.log(JSON.stringify(rows.map((r) => r.username)));
    break;
  }
  case "candidates": {
    const viewer = await userId(args[0]);
    const rows = await sql`
      select p.id, u.username, p.visibility,
        exists (
          select 1 from follows f
          where f.follower_id = ${viewer} and f.following_id = p.author_id
        ) as follows
      from posts p join users u on u.id = p.author_id
      where p.deleted_at is null and p.author_id <> ${viewer}
      order by p.created_at desc
      limit 15
    `;
    console.log(JSON.stringify(rows));
    break;
  }
  case "state": {
    const [row] = await sql`
      select
        count(*) filter (where deleted_at is null)::int as live
        , count(*)::int as total
        , count(*) filter (where visibility <> 'public')::int as non_public
        , count(*) filter (where edited_at is not null)::int as edited
        , count(*) filter (where content like '[vis-probe]%')::int as probe_content
      from posts
    `;
    const [f] = await sql`select count(*)::int as follows from follows`;
    console.log(JSON.stringify({ ...row, follows: f.follows }));
    break;
  }
  default:
    console.error(`unknown command: ${command}`);
    process.exit(1);
}

await sql.end();
