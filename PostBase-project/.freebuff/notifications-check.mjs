// The notifications the demo seed's adoption implies, held to the invariants a
// hand review of the seeded preview database used to check with one-off queries:
//
//   1. every engagement the adoption writes has the notification it implies
//      (and exactly one — a follow pair is a single row, and only a reaction
//      dedupes, so the implied key must never be written twice);
//   2. no notification carries a dangling recipient, actor or target;
//   3. the wording is the database's own — `message` is what
//      `notification_message(type, actor)` renders today;
//   4. every follow/reaction notification in an adopted account's inbox still
//      has the engagement behind it.
//
// Until this file existed those four facts were re-derived by hand every time
// the seed's notification pass changed, which is exactly the kind of check that
// quietly stops being run. This states them once and fails loudly: every
// offending row is named, and the exit status is the verdict.
//
// Read-only by construction — the four statements `QUERIES` holds are `select`s
// and nothing in this file writes a row. The suite pins that
// (`src/test/notifications-check.test.ts`), so a later edit that reached for an
// `insert`, `update` or `delete` would fail a fast test rather than mutate a
// live database.
//
// The population is *the seed's own rows*, identified by the id prefixes the
// seed writes for the adoption (see `accountRowId` in `src/lib/db/seed.ts`):
// `c1000000` host→member follows, `c2000000` cast→host follows, `c4000000`
// cast reactions, `c3000000` host→Page follows. Scoping to them is what makes the
// check honest on a database people also use: the app never deletes a
// notification, so an unfollow or an un-reacted post can legitimately leave a
// notification whose engagement is gone — that is history, not a defect, and
// the check must not call it one. If the seed stops writing those prefixes the
// population is empty, and this refuses to report a pass over nothing (exit 2)
// rather than going quietly vacuous.
//
// Usage (the npm script loads `.env.local` for you):
//   npm run notifications:check
//   node --env-file-if-exists=.env.local .freebuff/notifications-check.mjs [--json]
//
// Exit 0 = every invariant holds; 1 = findings (named below the summary);
// 2 = could not judge at all (no `DATABASE_URL`, no connection, or the seed's
// adoption is not in this database).
import postgres from "postgres";

/** The dataset this check asserts over, in one round trip, for the summary and the premise guard. */
const POPULATION = `
  select
    (select count(*)::int from public.notifications) as notifications,
    (select count(*)::int from public.follows where id::text like 'c2000000-%') as implied_follows,
    (select count(*)::int from public.reactions where id::text like 'c4000000-%') as implied_reactions,
    (select count(*)::int from (
       select f.follower_id as id from public.follows f where f.id::text like 'c1000000-%'
       union
       select pf.user_id as id from public.page_follows pf where pf.id::text like 'c3000000-%'
     ) adopted) as adopted_accounts
`;

/**
 * Every notification the adoption implies, one row per matching notification
 * (or one row with a null `notification_id` when there is none), carrying the
 * wording the database would compose now and the count of notifications sharing
 * the key. `union` rather than `union all`: the implied key is a set, and a
 * duplicate engagement row must not read as two expectations.
 */
const IMPLIED = `
  with implied as (
    select 'follow'::text as type, f.following_id as user_id, f.follower_id as source_user_id,
           'user'::text as target_type, f.following_id as target_id
    from public.follows f
    where f.id::text like 'c2000000-%'
    union
    select 'reaction'::text, p.author_id, r.user_id, 'post'::text, r.target_id
    from public.reactions r
    join public.posts p on p.id = r.target_id
    where r.id::text like 'c4000000-%' and r.target_type = 'post'
  )
  select
    i.type, i.user_id, i.source_user_id, i.target_type, i.target_id,
    n.id as notification_id,
    n.message,
    coalesce(pr.display_name, u.username) as actor_name,
    public.notification_message(i.type, coalesce(pr.display_name, u.username)) as expected_message,
    (count(n.id) over (partition by i.type, i.user_id, i.source_user_id, i.target_id))::int as notification_count
  from implied i
  left join public.notifications n
    on n.user_id = i.user_id
   and n.source_user_id = i.source_user_id
   and n.type = i.type
   and n.target_id = i.target_id
  left join public.users u on u.id = i.source_user_id
  left join public.profiles pr on pr.user_id = i.source_user_id
`;

/**
 * The follow and reaction notifications in an adopted account's inbox, each with
 * whether the engagement that justifies it is still there. An adopted account is
 * one the seed's adoption reached — it follows a demo member, or follows a seeded
 * Page — and only those two host-only markers are read: a conversation holds the
 * host *and* a demo member, so keying on it would drag the cast's own inboxes
 * (which live viewers can add to and take away from) into a check about the
 * adoption, where such an addition is history rather than a defect.
 */
const ADOPTED_INBOX = `
  with adopted as (
    select f.follower_id as id from public.follows f where f.id::text like 'c1000000-%'
    union
    select pf.user_id as id from public.page_follows pf where pf.id::text like 'c3000000-%'
  )
  select
    n.id, n.type, n.user_id, n.source_user_id, n.target_id,
    case n.type
      when 'follow' then exists (
        select 1 from public.follows f
        where f.follower_id = n.source_user_id and f.following_id = n.user_id
      )
      when 'reaction' then exists (
        select 1 from public.reactions r
        join public.posts p on p.id = r.target_id
        where r.user_id = n.source_user_id
          and r.target_type = 'post'
          and r.target_id = n.target_id
          and p.author_id = n.user_id
      )
      else true
    end as founded
  from public.notifications n
  join adopted a on a.id = n.user_id
  where n.type in ('follow', 'reaction') and n.source_user_id is not null
`;

/**
 * Every notification with a flag per reference it makes. The whole table on
 * purpose — this is the one invariant that is about the table rather than the
 * adoption, and it is safe table-wide because the app soft-deletes posts and
 * never deletes a user, so a reference that does not resolve really is one that
 * does not exist. A null actor or target is not a dangling one: the bell's own
 * mark-read rows carry neither.
 */
const DANGLING = `
  select
    n.id, n.type, n.user_id, n.source_user_id, n.target_type, n.target_id,
    (u.id is null) as recipient_missing,
    (n.source_user_id is not null and source.id is null) as actor_missing,
    (n.target_id is not null and n.target_type = 'user' and target_user.id is null) as target_user_missing,
    (n.target_id is not null and n.target_type = 'post' and target_post.id is null) as target_post_missing
  from public.notifications n
  left join public.users u on u.id = n.user_id
  left join public.users source on source.id = n.source_user_id
  left join public.users target_user on target_user.id = n.target_id
  left join public.posts target_post on target_post.id = n.target_id
`;

/**
 * The four statements this check runs, as text rather than tagged templates, so
 * the suite can read them and hold them to `select` — the property that lets
 * this run against a database with no undo. None takes a parameter, so there is
 * nothing for a template to bind; `sql.unsafe` is the honest call for a fixed
 * statement, not a shortcut around input.
 */
export const QUERIES = {
  population: POPULATION,
  implied: IMPLIED,
  adoptedInbox: ADOPTED_INBOX,
  dangling: DANGLING,
};

/** `type user source target` — the implied key, as one field a finding can name. */
function impliedKey(row) {
  return `${row.type} ${row.user_id} ${row.source_user_id} ${row.target_id}`;
}

/**
 * The findings over the implied set: a key with no notification, a key with
 * more than one, or a stored message that is not what `notification_message`
 * renders for the actor now.
 *
 * Pure, and fed straight from `IMPLIED` — the suite runs it over fixtures, so
 * the reading is pinned without a database.
 */
export function impliedFindings(rows) {
  const findings = [];
  const reportedDuplicates = new Set();
  for (const row of rows) {
    const key = impliedKey(row);
    if (row.notification_count === 0) {
      findings.push({
        invariant: "implied-present",
        detail: `${key} — the adoption implies this notification and the inbox does not hold it`,
        key,
      });
      continue;
    }
    if (row.notification_count > 1 && !reportedDuplicates.has(key)) {
      reportedDuplicates.add(key);
      findings.push({
        invariant: "implied-unique",
        detail: `${key} — ${row.notification_count} notifications share one implied key`,
        key,
      });
    }
    if (row.notification_id && row.message !== row.expected_message) {
      findings.push({
        invariant: "implied-wording",
        detail:
          `${row.notification_id} (${key}) — message "${row.message}" is not ` +
          `notification_message('${row.type}', '${row.actor_name}') = "${row.expected_message}"`,
        key,
        id: row.notification_id,
      });
    }
  }
  return findings;
}

/** The findings over the adopted inboxes: a follow or reaction notification whose engagement is gone. */
export function foundedFindings(rows) {
  return rows
    .filter((row) => row.founded === false)
    .map((row) => ({
      invariant: "inbox-founded",
      detail:
        `${row.id} (${row.type}) in ${row.user_id}'s inbox — the ${row.type} by ` +
        `${row.source_user_id} on ${row.target_id} is gone`,
      id: row.id,
    }));
}

/** The findings over the table: a recipient, actor or target that does not resolve. */
export function danglingFindings(rows) {
  const findings = [];
  for (const row of rows) {
    const missing = [];
    if (row.recipient_missing) missing.push(`recipient ${row.user_id}`);
    if (row.actor_missing) missing.push(`actor ${row.source_user_id}`);
    if (row.target_user_missing) missing.push(`target user ${row.target_id}`);
    if (row.target_post_missing) missing.push(`target post ${row.target_id}`);
    if (missing.length > 0) {
      findings.push({
        invariant: "targets-resolve",
        detail: `${row.id} (${row.type}) — ${missing.join(", ")} no longer exists`,
        id: row.id,
      });
    }
  }
  return findings;
}

/** The one-line intent behind each invariant, for the report's head. */
const INVARIANT_LABELS = {
  "implied-present": "every engagement the adoption writes has its notification",
  "implied-unique": "no implied notification is written twice",
  "implied-wording": "each stored message is `notification_message(type, actor)`",
  "inbox-founded": "every inbox notification still has the engagement behind it",
  "targets-resolve": "no notification points at a row that is gone",
};

/** Exit statuses, mirroring the drift alarm's three: a pass, findings, and a refusal to judge. */
const PASS = 0;
const FINDINGS = 1;
const CANNOT_RUN = 2;

function usage() {
  return [
    "Checks the notifications the demo seed's adoption implies, read-only.",
    "",
    "  node .freebuff/notifications-check.mjs [--json] [--help]",
    "",
    "  --json  write one JSON object on stdout instead of the human report",
    "",
    "Exit 0 = every invariant holds, 1 = findings named below the summary,",
    "2 = could not judge (no DATABASE_URL, no connection, or the seed's adoption",
    "rows are not in this database).",
  ].join("\n");
}

/** One JSON object on stdout, the shape every script here writes under `--json`. */
function emit(payload, asJson, human) {
  if (asJson) console.log(JSON.stringify(payload));
  else console.log(human);
}

/** The refusal path: a state the check cannot judge, said plainly and loudly. */
function refuse(reason, asJson) {
  emit(
    { gate: "cannot-run", exitCode: CANNOT_RUN, reason, findings: [] },
    asJson,
    `✗ notifications check could not run\n  ${reason}`,
  );
  process.exitCode = CANNOT_RUN;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    console.log(usage());
    return;
  }
  const asJson = args.includes("--json");

  const url = process.env.DATABASE_URL;
  if (!url) {
    refuse("DATABASE_URL is not set — run it with `npm run notifications:check`", asJson);
    return;
  }

  // The same endpoint rewrite the app does: the pooler host serves the
  // transaction pooler on 6543, and 5432 on it is the session pooler.
  const sql = postgres(url.replace(":5432/", ":6543/"), { ssl: "require", max: 1 });
  try {
    const [population] = await sql.unsafe(QUERIES.population);
    if (population.implied_follows + population.implied_reactions === 0) {
      refuse(
        "the seed's adoption rows are not in this database (no `c2000000` follows or " +
          "`c4000000` reactions) — run `npm run db:seed` first, or check DATABASE_URL",
        asJson,
      );
      return;
    }

    const impliedRows = await sql.unsafe(QUERIES.implied);
    const inboxRows = await sql.unsafe(QUERIES.adoptedInbox);
    const danglingRows = await sql.unsafe(QUERIES.dangling);

    const findings = [
      ...impliedFindings(impliedRows),
      ...foundedFindings(inboxRows),
      ...danglingFindings(danglingRows),
    ];
    const implied = population.implied_follows + population.implied_reactions;
    const gate = findings.length === 0 ? "pass" : "fail";

    if (asJson) {
      emit(
        {
          gate,
          exitCode: findings.length === 0 ? PASS : FINDINGS,
          population,
          findings,
        },
        true,
        "",
      );
      process.exitCode = findings.length === 0 ? PASS : FINDINGS;
      return;
    }

    const header =
      findings.length === 0
        ? `✓ Seeded-notification invariants hold (${implied} implied of ${population.notifications} notifications)`
        : `✗ Seeded-notification invariants failed — ${findings.length} finding(s)`;
    const lines = [
      header,
      `  adopted accounts    ${population.adopted_accounts}`,
      `  implied             ${population.implied_follows} follows, ${population.implied_reactions} reactions`,
      `  notifications       ${population.notifications} in the table`,
      ...Object.entries(INVARIANT_LABELS).map(([name, label]) => {
        const count = findings.filter((finding) => finding.invariant === name).length;
        return `  ${count === 0 ? "✓" : "✗"} ${name.padEnd(16)}${label}${count === 0 ? "" : ` — ${count}`}`;
      }),
    ];
    if (findings.length > 0) {
      lines.push("", "Findings:");
      for (const finding of findings) lines.push(`  [${finding.invariant}] ${finding.detail}`);
      lines.push(
        "",
        "A missing or malformed implied notification is restored by `npm run db:seed`.",
      );
    }
    console.log(lines.join("\n"));
    process.exitCode = findings.length === 0 ? PASS : FINDINGS;
  } catch (error) {
    refuse(`the query failed: ${error?.message || error}`, asJson);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

await main();
