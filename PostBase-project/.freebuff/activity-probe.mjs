// Drives real comment / reaction / deletion activity so the live feed can be
// verified against the running app.
//
// Usage (always with --env-file-if-exists=.env.local):
//   node .freebuff/activity-probe.mjs post <username> "<content>"      -> prints new post id
//   node .freebuff/activity-probe.mjs comment <username> <postId> "<content>" -> prints comment id
//   node .freebuff/activity-probe.mjs react <username> <postId> [type]
//   node .freebuff/activity-probe.mjs unreact <username> <postId>
//   node .freebuff/activity-probe.mjs comment-remove <commentId>       (soft delete)
//   node .freebuff/activity-probe.mjs post-remove <postId>             (soft delete)
//   node .freebuff/activity-probe.mjs post-purge <postId>              (hard delete + R2 objects)
//   node .freebuff/activity-probe.mjs counts <postId>
//   node .freebuff/activity-probe.mjs follow <username> <targetUsername>  -> prints follow id
//   node .freebuff/activity-probe.mjs unfollow <username> <targetUsername>
//   node .freebuff/activity-probe.mjs notify <username>                 -> inbox total + unread
//   node .freebuff/activity-probe.mjs notify-add <username> <type> "<message>"  (one unread row; clear it with notify-clean)
//   node .freebuff/activity-probe.mjs notify-clean <username> <minutes>  (deletes that inbox's notifications newer than N minutes)
//   node .freebuff/activity-probe.mjs stats                            (dataset totals, read-only)
//   node .freebuff/activity-probe.mjs conversation <username>          -> conversations that user is in, with message counts
//   node .freebuff/activity-probe.mjs conversation-purge <username>    (deletes them; members and messages cascade)
//   node .freebuff/activity-probe.mjs cleanup                          (removes every probe row)
import postgres from "postgres";
import { S3Client, DeleteObjectCommand } from "@aws-sdk/client-s3";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL missing");
  process.exit(1);
}

const sql = postgres(url.replace(":5432/", ":6543/"), { ssl: "require", max: 1 });
const [command, ...args] = process.argv.slice(2);

// A post's media rows hold the full public URL, so a delete that only touches
// SQL (this probe's `post-purge` and `cleanup`) would leave every uploaded file
// in the bucket — which is exactly how orphaned objects used to pile up. These
// helpers do what the app's own delete does: read the URLs while the rows still
// exist, then remove the objects. Only URLs under this bucket's public prefix
// are touched; seeded posts point at external hosts.
const R2_PUBLIC_PREFIX = (process.env.R2_PUBLIC_URL || "").replace(/\/$/, "");
const r2 = R2_PUBLIC_PREFIX && process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID
  ? new S3Client({
      region: "auto",
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      },
    })
  : null;

const mediaOfPosts = async (postIds) => {
  if (postIds.length === 0) return [];
  return sql`select url from post_media where post_id in ${sql(postIds)}`;
};

const purgeStoredMedia = async (rows) => {
  if (!r2) return 0;
  let removed = 0;
  for (const { url } of rows) {
    if (!url || !url.startsWith(`${R2_PUBLIC_PREFIX}/`)) continue;
    try {
      await r2.send(
        new DeleteObjectCommand({
          Bucket: process.env.R2_BUCKET_NAME || "linkme-plus-uploads",
          Key: url.slice(R2_PUBLIC_PREFIX.length + 1),
        }),
      );
      removed += 1;
    } catch (error) {
      console.error(`could not delete ${url}:`, error?.message || error);
    }
  }
  return removed;
};

const userId = async (username) => {
  const [user] = await sql`select id from users where username = ${username}`;
  if (!user) throw new Error(`no user ${username}`);
  return user.id;
};

switch (command) {
  case "post": {
    const [username, content] = args;
    const [row] = await sql`
      insert into posts (author_id, content, type, visibility)
      values (${await userId(username)}, ${content}, 'text', 'public')
      returning id, created_at
    `;
    console.log(JSON.stringify({ ...row, at: Date.now() }));
    break;
  }
  case "comment": {
    const [username, postId, content] = args;
    const [row] = await sql`
      insert into comments (post_id, author_id, content)
      values (${postId}, ${await userId(username)}, ${content})
      returning id, created_at
    `;
    console.log(JSON.stringify({ ...row, at: Date.now() }));
    break;
  }
  case "react": {
    const [username, postId, type = "like"] = args;
    const [row] = await sql`
      insert into reactions (target_type, target_id, user_id, type)
      values ('post', ${postId}, ${await userId(username)}, ${type})
      on conflict do nothing
      returning id
    `;
    console.log(JSON.stringify({ id: row?.id ?? null, at: Date.now() }));
    break;
  }
  case "unreact": {
    const [username, postId] = args;
    const removed = await sql`
      delete from reactions
      where target_type = 'post' and target_id = ${postId} and user_id = ${await userId(username)}
      returning id
    `;
    console.log(JSON.stringify({ removed: removed.length, at: Date.now() }));
    break;
  }
  case "comment-remove": {
    const removed = await sql`
      update comments set deleted_at = now() where id = ${args[0]} returning id
    `;
    console.log(JSON.stringify({ removed: removed.length, at: Date.now() }));
    break;
  }
  case "post-remove": {
    const removed = await sql`
      update posts set deleted_at = now() where id = ${args[0]} returning id
    `;
    console.log(JSON.stringify({ removed: removed.length, at: Date.now() }));
    break;
  }
  case "post-purge": {
    // Read the media first: the cascade takes those rows with the post.
    const media = await mediaOfPosts([args[0]]);
    const removed = await sql`delete from posts where id = ${args[0]} returning id`;
    const objects = await purgeStoredMedia(media);
    console.log(JSON.stringify({ removed: removed.length, objects, at: Date.now() }));
    break;
  }
  case "counts": {
    const [postId] = args;
    const [row] = await sql`
      select
        (select count(*)::int from comments c where c.post_id = ${postId} and c.deleted_at is null) as comments,
        (select count(*)::int from reactions r where r.target_type = 'post' and r.target_id = ${postId}) as reactions
    `;
    console.log(JSON.stringify(row));
    break;
  }
  case "follow": {
    const [username, target] = args;
    const [row] = await sql`
      insert into follows (follower_id, following_id)
      values (${await userId(username)}, ${await userId(target)})
      on conflict do nothing
      returning id
    `;
    console.log(JSON.stringify({ id: row?.id ?? null, at: Date.now() }));
    break;
  }
  case "unfollow": {
    const [username, target] = args;
    const removed = await sql`
      delete from follows
      where follower_id = ${await userId(username)} and following_id = ${await userId(target)}
      returning id
    `;
    console.log(JSON.stringify({ removed: removed.length, at: Date.now() }));
    break;
  }
  case "notify": {
    const [username] = args;
    const [row] = await sql`
      select
        count(*)::int as total,
        count(*) filter (where read_at is null)::int as unread
      from notifications where user_id = ${await userId(username)}
    `;
    console.log(JSON.stringify(row));
    break;
  }
  case "notify-add": {
    // One unread row, so the bell's count-bearing name can be checked live.
    // Paired with `notify-clean` so a verification run can put the inbox back.
    const [username, type = "follow", message] = args;
    const [row] = await sql`
      insert into notifications (user_id, type, message)
      values (${await userId(username)}, ${type}, ${message ?? null})
      returning id, created_at
    `;
    console.log(JSON.stringify({ ...row, at: Date.now() }));
    break;
  }
  case "notify-clean": {
    // Scoped to one inbox and one time window, so a test can never clear a real
    // notification that arrived outside it.
    const [username, rawMinutes] = args;
    const minutes = Number(rawMinutes ?? 30);
    const removed = await sql`
      delete from notifications
      where user_id = ${await userId(username)}
        and created_at > now() - (${minutes} * interval '1 minute')
      returning id
    `;
    console.log(JSON.stringify({ removed: removed.length }));
    break;
  }
  case "conversation": {
    // Read-only: the conversations a user is in, so a verification run can see
    // what it created and confirm it left nothing behind.
    const [username] = args;
    const rows = await sql`
      select c.id, count(m.id)::int as messages
      from conversations c
      join conversation_members cm on cm.conversation_id = c.id
      left join messages m on m.conversation_id = c.id
      where cm.user_id = ${await userId(username)}
      group by c.id
    `;
    console.log(JSON.stringify({ conversations: rows.length, rows }));
    break;
  }
  case "conversation-purge": {
    // Scoped to the conversations one user is a member of. `messages` and
    // `conversation_members` both cascade from `conversations`, so deleting the
    // conversation is the whole cleanup — nothing to sweep afterwards.
    const [username] = args;
    const removed = await sql`
      delete from conversations
      where id in (
        select conversation_id from conversation_members where user_id = ${await userId(username)}
      )
      returning id
    `;
    console.log(JSON.stringify({ removed: removed.length }));
    break;
  }
  case "stats": {
    // Dataset totals, for checking a verification run left the data as it found
    // it. Read-only.
    const [row] = await sql`
      select
        (select count(*)::int from posts) as posts,
        (select count(*)::int from posts where deleted_at is null) as live_posts,
        (select count(*)::int from posts where visibility <> 'public') as non_public,
        (select count(*)::int from posts where edited_at is not null) as edited,
        (select count(*)::int from post_media) as media,
        (select count(*)::int from follows) as follows,
        (select count(*)::int from notifications) as notifications,
        (select count(*)::int from conversations) as conversations,
        (select count(*)::int from messages) as messages
    `;
    console.log(JSON.stringify(row));
    break;
  }
  case "cleanup": {
    const probePosts = await sql`select id from posts where content like '[activity-probe]%'`;
    const ids = probePosts.map((row) => row.id);
    const media = await mediaOfPosts(ids);
    const comments = ids.length
      ? await sql`delete from comments where post_id in ${sql(ids)} returning id`
      : [];
    const reactions = ids.length
      ? await sql`delete from reactions where target_type = 'post' and target_id in ${sql(ids)} returning id`
      : [];
    const strayComments = await sql`delete from comments where content like '[activity-probe]%' returning id`;
    const posts = ids.length ? await sql`delete from posts where id in ${sql(ids)} returning id` : [];
    const objects = await purgeStoredMedia(media);
    console.log(
      `removed posts=${posts.length} comments=${comments.length + strayComments.length} reactions=${reactions.length} objects=${objects}`,
    );
    break;
  }
  default:
    console.error(`unknown command: ${command}`);
    process.exit(1);
}

await sql.end();
