/**
 * Does the database's feed policy agree with the app's own rule?
 *
 * `sql/rls-lockdown.sql` teaches Postgres who may read a post, and
 * `src/lib/db/post-visibility.ts` teaches the app the same thing. They are two
 * renderings of one rule (`src/lib/post-audiences.ts`), and nothing keeps them
 * honest except a check like this one: seed a handful of posts covering every
 * audience, impersonate readers through the role and JWT claims the Data API
 * would present, and compare what the policy admits against what the app's own
 * predicate admits for the same reader.
 *
 * The fixtures live in a transaction that is always rolled back, so nothing is
 * written to the project — including the realtime events the engagement
 * triggers would otherwise have published to live members' feeds.
 *
 * Run against the real project:
 *
 *   npx tsx --env-file-if-exists=.env.local sql/rls-verify.ts
 *
 * Exits non-zero the moment an expectation fails.
 */
import postgres from "postgres";
import { count } from "drizzle-orm";
import { db } from "../src/lib/db";
import { posts } from "../src/lib/db/schema";
import { visiblePostsCondition } from "../src/lib/db/post-visibility";

const PRIVATE_POST = "a1111111-0000-4000-8000-000000000001";
const FOLLOWERS_POST = "a1111111-0000-4000-8000-000000000002";
const GROUP_POST = "a1111111-0000-4000-8000-000000000003";
const PUBLIC_POST = "a1111111-0000-4000-8000-000000000004";

// The project's own client rewrites the session pooler's port, and a long-lived
// desktop connection on 5432 is refused — same reasoning as src/lib/db/index.ts.
const rawUrl = new URL(process.env.DATABASE_URL!);
if (rawUrl.hostname.endsWith(".pooler.supabase.com") && rawUrl.port === "5432") {
  rawUrl.port = "6543";
}
const sql = postgres(rawUrl.toString(), { max: 1, prepare: false });

let failures = 0;
function check(label: string, actual: boolean, detail = "") {
  const mark = actual ? "ok  " : "FAIL";
  if (!actual) failures += 1;
  console.log(`  ${mark} ${label}${detail ? ` — ${detail}` : ""}`);
}

/**
 * The five readers the fixtures need, each with a known relationship to the
 * author and none of them the same person twice.
 *
 * That last part is the point. A reader who happens to be the author passes
 * every expectation on authorship alone, so the group is picked first, the
 * author is taken from outside it, and the follower and non-follower are
 * chosen for that specific author.
 */
async function pickReaders() {
  const [membership] = await sql<{ group_id: string; user_id: string }[]>`
    select gm.group_id, gm.user_id from public.group_members gm
    order by gm.group_id, gm.user_id limit 1`;
  const group = membership.group_id;
  const member = membership.user_id;

  const everyone = await sql<{ id: string }[]>`
    select id from public.users order by created_at`;
  const inGroup = new Set(
    (await sql<{ user_id: string }[]>`
      select user_id from public.group_members where group_id = ${group}`).map((row) => row.user_id),
  );

  const nonMember = everyone.find((row) => !inGroup.has(row.id))!.id;

  for (const candidate of everyone) {
    if (candidate.id === member || candidate.id === nonMember || inGroup.has(candidate.id)) continue;

    const [follower] = await sql<{ follower_id: string }[]>`
      select f.follower_id from public.follows f
      where f.following_id = ${candidate.id} and f.follower_id <> ${candidate.id}
      order by f.follower_id limit 1`;
    const [nonFollower] = await sql<{ id: string }[]>`
      select u.id from public.users u
      where u.id <> ${candidate.id}
        and not exists (
          select 1 from public.follows f
          where f.follower_id = u.id and f.following_id = ${candidate.id}
        )
      order by u.created_at limit 1`;

    if (follower && nonFollower) {
      return {
        group,
        member,
        nonMember,
        author: candidate.id,
        follower: follower.follower_id,
        nonFollower: nonFollower.id,
      };
    }
  }

  throw new Error("no author with both a follower and a non-follower to test against");
}

type Impersonation = { label: string; sees: Record<string, number> };

/** Insert one post per audience, then read `posts` as each reader would. */
async function probe(readers: Awaited<ReturnType<typeof pickReaders>>): Promise<Impersonation[]> {
  const results: Impersonation[] = [];

  // Explicit begin/rollback, not postgres.js's `sql.begin`, which commits on
  // success: these fixtures must never reach the project.
  await sql`begin`;
  try {
    await sql`
      insert into public.posts (id, author_id, visibility, content) values
        (${PRIVATE_POST}, ${readers.author}, 'private', 'rls-verify private'),
        (${FOLLOWERS_POST}, ${readers.author}, 'followers', 'rls-verify followers'),
        (${PUBLIC_POST}, ${readers.author}, 'public', 'rls-verify public')`;
    await sql`
      insert into public.posts (id, author_id, group_id, visibility, content)
      values (${GROUP_POST}, ${readers.author}, ${readers.group}, 'group', 'rls-verify group')`;

    // The owner still sees everything: drizzle connects as `postgres`, and a
    // table owner bypasses row level security unless the table forces it.
    const [asOwner] = await sql<{ visible: number }[]>`
      select count(*)::int as visible from public.posts where id in
        (${PRIVATE_POST}, ${FOLLOWERS_POST}, ${GROUP_POST}, ${PUBLIC_POST})`;
    results.push({ label: "role postgres (the app's own connection)", sees: { fixtures: asOwner.visible } });

    const scenario: Array<[string, string]> = [
      ["author", readers.author],
      ["follower of the author", readers.follower],
      ["non-follower", readers.nonFollower],
      ["group member", readers.member],
      ["non-member", readers.nonMember],
    ];

    for (const [label, userId] of scenario) {
      // This is precisely what PostgREST and Realtime do on the subscriber's
      // behalf: present the JWT as the role it was issued for.
      await sql`select set_config('request.jwt.claims', ${JSON.stringify({ sub: userId, role: "authenticated" })}, true)`;
      await sql`set local role authenticated`;
      const [row] = await sql<{ private_seen: number; followers_seen: number; group_seen: number; public_seen: number }[]>`
        select
          count(*) filter (where id = ${PRIVATE_POST})::int as private_seen,
          count(*) filter (where id = ${FOLLOWERS_POST})::int as followers_seen,
          count(*) filter (where id = ${GROUP_POST})::int as group_seen,
          count(*) filter (where id = ${PUBLIC_POST})::int as public_seen
        from public.posts`;
      await sql`reset role`;
      results.push({ label: `as ${label}`, sees: row });
    }
  } finally {
    await sql`rollback`;
  }

  return results;
}

/** The same readers, through the predicate the app itself compiles. */
async function appRuleCounts(viewerIds: string[]): Promise<Array<{ viewer: string; visible: number }>> {
  const out: Array<{ viewer: string; visible: number }> = [];
  for (const viewer of viewerIds) {
    const [row] = await db.select({ visible: count() }).from(posts).where(visiblePostsCondition(viewer));
    out.push({ viewer, visible: row.visible });
  }
  return out;
}

const readers = await pickReaders();
console.log("readers:", readers);

const impersonations = await probe(readers);
for (const { label, sees } of impersonations) {
  console.log(`\n${label}:`, sees);
}

console.log("\npolicy expectations");
const byLabel = (prefix: string) =>
  impersonations.find((entry) => entry.label === `as ${prefix}`)!.sees as Record<string, number>;

const others = ["follower of the author", "non-follower", "group member", "non-member"];

check("the app's own connection still reads every post", impersonations[0].sees.fixtures === 4);
check("the author reads their private post", byLabel("author").private_seen === 1);
check("nobody else reads it", others.every((label) => byLabel(label).private_seen === 0));
check("a follower reads the followers-only post", byLabel("follower of the author").followers_seen === 1);
check("a non-follower does not", byLabel("non-follower").followers_seen === 0);
check("a group member reads the group post", byLabel("group member").group_seen === 1);
check("a non-member does not", byLabel("non-member").group_seen === 0);
check("the author still reads their own group post from outside it", byLabel("author").group_seen === 1);
check("every signed-in reader reads the public post",
  ["author", ...others].every((label) => byLabel(label).public_seen === 1));

console.log("\napp rule, same readers (the path the API takes)");
for (const { viewer, visible } of await appRuleCounts(
  [readers.author, readers.follower, readers.nonFollower, readers.member, readers.nonMember],
)) {
  console.log(`  ${viewer} → ${visible} posts`);
}

await sql.end({ timeout: 5 });

if (failures > 0) {
  console.error(`\n${failures} expectation(s) failed`);
  process.exit(1);
}
console.log("\nall policy expectations hold");
