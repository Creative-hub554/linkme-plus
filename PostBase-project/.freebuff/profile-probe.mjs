// Read and restore a profile's media columns, for verifying the profile media
// cleanup against the real bucket without destroying real data.
//
// Usage (always with: unset DATABASE_URL; node --env-file-if-exists=.env.local .freebuff/profile-probe.mjs ...)
//   show <username>                     -> JSON of the profile's media columns
//   restore-config <username> <json|null>  -> set cover_config
//   restore-video <username> <url|null>    -> set cover_video_url
//   restore-cover <username> <url|null>    -> set cover_url
//   restore-avatar <username> <url|null>   -> set avatar_url
//   delete-key <key>                       -> delete one R2 object directly (for
//                                             a probe the routes cannot reach)
import postgres from "postgres";
import { S3Client, DeleteObjectCommand } from "@aws-sdk/client-s3";

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

/** `"null"` on the command line is the SQL null; anything else is the literal. */
const parse = (value) => (value === "null" ? null : value);

switch (command) {
  case "show": {
    const [row] = await sql`
      select p.avatar_url, p.cover_url, p.cover_video_url, p.cover_config, p.short_video_cover_config
      from profiles p where p.user_id = ${await userId(args[0])}
    `;
    console.log(JSON.stringify(row ?? null));
    break;
  }
  case "restore-config": {
    const [row] = await sql`
      update profiles set cover_config = ${parse(args[1])}::jsonb
      where user_id = ${await userId(args[0])} returning user_id
    `;
    console.log(JSON.stringify(row ?? null));
    break;
  }
  case "restore-video": {
    const [row] = await sql`
      update profiles set cover_video_url = ${parse(args[1])}
      where user_id = ${await userId(args[0])} returning user_id
    `;
    console.log(JSON.stringify(row ?? null));
    break;
  }
  case "restore-cover": {
    const [row] = await sql`
      update profiles set cover_url = ${parse(args[1])}
      where user_id = ${await userId(args[0])} returning user_id
    `;
    console.log(JSON.stringify(row ?? null));
    break;
  }
  case "restore-avatar": {
    const [row] = await sql`
      update profiles set avatar_url = ${parse(args[1])}
      where user_id = ${await userId(args[0])} returning user_id
    `;
    console.log(JSON.stringify(row ?? null));
    break;
  }
  case "delete-key": {
    const client = new S3Client({
      region: "auto",
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      },
    });
    await client.send(
      new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: args[0] }),
    );
    client.destroy();
    console.log(JSON.stringify({ deleted: args[0] }));
    break;
  }
  default:
    console.error(`unknown command ${command}`);
    process.exit(1);
}
await sql.end();
