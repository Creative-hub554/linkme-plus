/**
 * Is anything in the database readable by the anon key — and does anything new appear?
 *
 * `sql/rls-lockdown.sql` is what closed the surface: row level security on every table,
 * the two Data API roles' blanket grants revoked, their default privileges narrowed so a
 * table created tomorrow is not granted to them either, the SECURITY DEFINER broadcast
 * functions no longer callable as RPCs, and the reads the client actually makes handed
 * back one at a time. That file is a statement about a database, and a statement about a
 * database is true until something changes it — a later `grant select on ... to anon`, a
 * dashboard toggle, a migration that re-widens a default privilege, a table created by a
 * role the lockdown's `alter default privileges` never covered. None of those touch a line
 * of this repository, so no test in it can notice. That is what this file is for.
 *
 * It asks the question from the attacker's side, because that side is public. The anon
 * key is not a credential: it is `NEXT_PUBLIC_SUPABASE_ANON_KEY`, published to every
 * visitor by the build and already sitting in the deployed bundle. So the check speaks to
 * the Data API with that exact key and one `GET` per relation, and reads the answer:
 *
 *   200            the relation is readable by the anon key — exposed, and the only
 *                  verdict that is a finding. An empty body is still this: a reachable
 *                  table that answers `[]` is a surface, not a closed door. The answer
 *                  has to be the Data API's own JSON, though — a 200 that is an HTML
 *                  page is a proxy or a captive portal speaking, not PostgREST, and
 *                  believing it would fail a build over somebody else's network.
 *   401 + 42501    `permission denied for table ...` — privilege refused it. This is the
 *                  lockdown's own work, and it is what a green run looks like.
 *   404 + PGRST205 the relation is not in the Data API's schema cache at all, so there is
 *                  nothing there to reach. Closed, but for a *different* reason than the
 *                  lockdown's — worth keeping distinct in the report, because a table that
 *                  answers this has proved nothing about its privileges and will start
 *                  answering for real the moment the schema cache reloads.
 *   anything else  a state this check cannot judge, and it refuses rather than guessing.
 *                  "Invalid API key" is the important one: a mistyped or rotated key
 *                  makes every probe fail the same way, and a check that counted those as
 *                  closed doors would pass on an answer it never got. Refusing is the
 *                  difference between a gate and a formality.
 *
 * Which relations are probed is stated in the report, and it is the honest limit of the
 * check. Without `DATABASE_URL` it can only ask about the tables this repository declares
 * — `src/lib/db/schema.ts` plus every `create table`/`create view` in `drizzle/*.sql` — so
 * a table created some other way and granted to anon would not be named. With
 * `DATABASE_URL` set (locally, from `.env.local`) it also enumerates the live schema and
 * probes everything in it, which catches exactly that case. The report says which basis it
 * used, so a pass is never read as stronger than it was. Neither basis writes: every
 * request this file makes is a `GET`, and `src/test/anon-exposure.test.ts` holds that.
 *
 * A deliberate exposure belongs in `DECLARED_EXPOSURES` with the reason it exists, not in
 * a quieter edit here — the list is what turns "why is this table open?" from an archaeology
 * project into a line with a sentence on it.
 *
 * Usage (the npm script loads `.env.local` for you):
 *   npm run exposure:check
 *   node .freebuff/anon-exposure.mjs [--json] [--help]
 *
 * Exit 0 = nothing but the declared exposures is reachable, 1 = something is reachable,
 * 2 = could not judge (no key, an unreadable answer, an enumeration that failed).
 */

/**
 * Relations the anon key is *meant* to reach, each with the reason it exists.
 *
 * Empty today, and it should stay that way unless a page genuinely has to read a table
 * before sign-in. Adding one is not a workaround for this gate — it is the record that
 * makes the exposure reviewable: a reviewer sees the table name and the sentence beside
 * it in the same diff as the code that needs it.
 */
export const DECLARED_EXPOSURES = [];

/** The endpoint the browser itself talks to, with the key the browser itself holds. */
const REST_ROOT = "/rest/v1/";

/** Exit statuses, mirroring the drift alarm's three: a pass, findings, and a refusal to judge. */
const PASS = 0;
const FINDINGS = 1;
const CANNOT_RUN = 2;

/** One `GET` per relation, through an injectable `request` so the suite can hold the contract. */
async function httpGet(url, init) {
  const response = await fetch(url, init);
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  return { status: response.status, body, text };
}

function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * What one probe proved.
 *
 * Four verdicts, deliberately: `reachable` is the finding, `closed` is the lockdown's own
 * answer, `absent` is a table the Data API does not carry (and so proved nothing about
 * privileges), and `unknown` is everything this file refuses to guess about.
 */
export function probeVerdict(status, body) {
  const payload = typeof body === "string" ? safeParse(body) : (body ?? null);
  const code = payload && typeof payload.code === "string" ? payload.code : null;
  const message = payload && typeof payload.message === "string" ? payload.message : null;
  const detail = `HTTP ${status}${code ? ` ${code}` : ""}${message ? ` — ${message}` : ""}`;

  if (status >= 200 && status < 300 && payload !== null) {
    return { verdict: "reachable", detail: `HTTP ${status} — the anon key can read this relation` };
  }
  if (status === 401 && code === "42501") {
    return { verdict: "closed", detail: message ?? "permission denied" };
  }
  if (status === 404 && code === "PGRST205") {
    return { verdict: "absent", detail: message ?? "not in the Data API's schema cache" };
  }
  const raw = typeof body === "string" ? body.trim().replace(/\s+/g, " ").slice(0, 120) : "";
  return { verdict: "unknown", detail: raw ? `${detail} — \"${raw}\"` : detail };
}

/**
 * Probes every named relation, one `GET` each, and reports what each one proved.
 *
 * `select=*&limit=1` rather than a named column: the question is whether the relation
 * answers at all, and a `select` naming a column the table lacks would answer 400 — a
 * verdict about the probe, not about the privilege. `limit=1` keeps a reachable table with
 * rows in it from streaming those rows into a CI log.
 */
export async function probeSurface({ request = httpGet, url, key, relations }) {
  const probes = [];
  for (const relation of relations) {
    const { status, body, text } = await request(`${url}${REST_ROOT}${relation}?select=*&limit=1`, {
      method: "GET",
      headers: { apikey: key, accept: "application/json" },
    });
    const reading = probeVerdict(status, body ?? text);
    probes.push({ relation, status, ...reading });
  }
  return probes;
}

/** The relations a probe list is drawn from: the ones this repository declares. */
export function repositoryRelations({ schemaSource, migrationSources }) {
  const names = new Set();
  for (const match of schemaSource.matchAll(/\bpgTable\(\s*"([a-z0-9_]+)"/g)) names.add(match[1]);
  for (const source of migrationSources ?? []) {
    for (const match of source.matchAll(
      /\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?"?([a-z0-9_]+)"?/gi,
    )) {
      names.add(match[1]);
    }
    for (const match of source.matchAll(/\bcreate\s+(?:or\s+replace\s+)?view\s+"?([a-z0-9_]+)"?/gi)) {
      names.add(match[1]);
    }
  }
  return [...names].sort();
}

/**
 * The relations the live schema holds — tables and views in `public`.
 *
 * This is the basis that catches a table this repository has never heard of, which is the
 * one case the declared list cannot see. `pg_tables` and `pg_views` rather than
 * `information_schema.tables`, because the question is about relations the Data API can
 * be handed, and a materialised view or a foreign table is not one of those.
 */
export function databaseRelations(rows) {
  const names = new Set();
  for (const row of rows ?? []) {
    if (typeof row?.name === "string" && row.name) names.add(row.name);
  }
  return [...names].sort();
}

/** Relations probed, deduplicated across the bases that were available, in one order. */
export function mergedRelations(...lists) {
  const names = new Set();
  for (const list of lists) for (const name of list ?? []) names.add(name);
  return [...names].sort();
}

/** What the probes proved that this gate exists to fail on: reachable and not declared. */
export function findingsFor(probes, declared = DECLARED_EXPOSURES) {
  const allowed = new Set(declared.map((entry) => entry.relation));
  return probes
    .filter((probe) => probe.verdict === "reachable" && !allowed.has(probe.relation))
    .map((probe) => ({
      relation: probe.relation,
      invariant: "anon-closed",
      detail: `${probe.relation} is reachable by the anon key — ${probe.detail}`,
    }));
}

/** What the probes could not answer. A single one turns the run into a refusal. */
export function unknownsFor(probes) {
  return probes.filter((probe) => probe.verdict === "unknown");
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
    `✗ anon-exposure check could not run\n  ${reason}`,
  );
  process.exitCode = CANNOT_RUN;
}

function usage() {
  return [
    "Checks that no relation is reachable through the anon key, read-only.",
    "",
    "  node .freebuff/anon-exposure.mjs [--json] [--help]",
    "",
    "  --json  write one JSON object on stdout instead of the human report",
    "",
    "Exit 0 = only the declared exposures answer, 1 = something else answers,",
    "2 = could not judge (no NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY,",
    "a probe that answered in a state this check does not model, or a DATABASE_URL",
    "that was set and would not answer).",
  ].join("\n");
}

/**
 * The relations named by the repository: the schema's own tables, and everything the
 * migrations have ever created. Read as text rather than imported — `schema.ts` reaches
 * for aliases and types a bare `node` cannot resolve, and the names are what is wanted.
 */
async function declaredRelations() {
  const { readFile, readdir } = await import("node:fs/promises");
  const schemaSource = await readFile(new URL("../src/lib/db/schema.ts", import.meta.url), "utf8");
  const files = await readdir(new URL("../drizzle/", import.meta.url));
  const migrationSources = [];
  for (const file of files.filter((name) => name.endsWith(".sql")).sort()) {
    migrationSources.push(await readFile(new URL(`../drizzle/${file}`, import.meta.url), "utf8"));
  }
  return repositoryRelations({ schemaSource, migrationSources });
}

/** The relations the live schema holds, when a database is reachable to ask. */
async function liveRelations(databaseUrl) {
  const { default: postgres } = await import("postgres");
  // The same pooler rewrite every other reader here does: the session pooler on 5432
  // refuses the long-lived desktop connection this script's own neighbours were opened for.
  const url = new URL(databaseUrl);
  if (url.hostname.endsWith(".pooler.supabase.com") && url.port === "5432") url.port = "6543";
  const sql = postgres(url.toString(), { max: 1, prepare: false });
  try {
    const rows = await sql`
      select tablename as name from pg_tables where schemaname = 'public'
      union all
      select viewname as name from pg_views where schemaname = 'public'`;
    return databaseRelations(rows);
  } finally {
    // A teardown on a connection that has already failed must not replace the error it
    // is cleaning up after. It once did — a pooler that dropped mid-query was reported
    // as an uncaught crash out of `end()` rather than as the refusal this check owes,
    // and the refusal it swallowed was the whole point of the run.
    await sql.end({ timeout: 5 }).catch(() => {});
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    console.log(usage());
    return;
  }
  const asJson = args.includes("--json");

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    refuse(
      "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are not both set — they are " +
        "the app's own published pair (the build ships them to every visitor), run it with " +
        "`npm run exposure:check`, and in CI set them from the repository variables of the same names",
      asJson,
    );
    return;
  }

  let repository;
  try {
    repository = await declaredRelations();
  } catch (error) {
    refuse(`the repository's own table list could not be read: ${error?.message || error}`, asJson);
    return;
  }

  let live = null;
  if (process.env.DATABASE_URL) {
    try {
      live = await liveRelations(process.env.DATABASE_URL);
    } catch (error) {
      // A DATABASE_URL that was set and would not answer is a refusal, not a narrower
      // check: silently falling back would report a pass over the weaker basis without
      // saying the stronger one was asked for and failed.
      refuse(`DATABASE_URL is set but its schema could not be read: ${error?.message || error}`, asJson);
      return;
    }
  }

  const relations = mergedRelations(repository, live);
  if (relations.length === 0) {
    refuse("no relations were found to probe — the schema and migrations both read as empty", asJson);
    return;
  }

  let probes;
  try {
    probes = await probeSurface({ url, key, relations });
  } catch (error) {
    refuse(`a probe failed to reach the Data API: ${error?.message || error}`, asJson);
    return;
  }

  const unknowns = unknownsFor(probes);
  if (unknowns.length > 0) {
    refuse(
      `${unknowns.length} probe(s) answered in a state this check does not model, so it cannot ` +
        "say whether the surface is closed — " +
        unknowns.map((probe) => `${probe.relation} (${probe.detail})`).join("; "),
      asJson,
    );
    return;
  }

  const findings = findingsFor(probes);
  const declared = DECLARED_EXPOSURES.filter((entry) =>
    probes.some((probe) => probe.relation === entry.relation && probe.verdict === "reachable"),
  );
  const basis = {
    repository: repository.length,
    database: live === null ? null : live.length,
    probed: relations.length,
  };
  const closed = probes.filter((probe) => probe.verdict === "closed").length;
  const absent = probes.filter((probe) => probe.verdict === "absent").length;
  const gate = findings.length === 0 ? "pass" : "fail";

  if (asJson) {
    emit(
      { gate, exitCode: findings.length === 0 ? PASS : FINDINGS, basis, findings, declared },
      true,
      "",
    );
    process.exitCode = findings.length === 0 ? PASS : FINDINGS;
    return;
  }

  const basisLine =
    live === null
      ? `  enumerated    ${basis.repository} relation(s) from the repository (no DATABASE_URL, so a table declared nowhere was not named)`
      : `  enumerated    ${basis.database} relation(s) from the live schema, ${basis.repository} of them also declared by the repository`;
  const header =
    findings.length === 0
      ? `✓ anon surface closed — ${basis.probed} relation(s) probed, none reachable by the anon key`
      : `✗ anon surface is open — ${findings.length} relation(s) reachable by the anon key`;
  const lines = [
    header,
    basisLine,
    `  answered      ${closed} refused by privilege, ${absent} not in the Data API's schema cache`,
    `  declared      ${declared.length} exposure(s) on purpose`,
  ];
  if (findings.length > 0) {
    lines.push("", "Findings:");
    for (const finding of findings) lines.push(`  [${finding.invariant}] ${finding.detail}`);
    lines.push(
      "",
      "Each of these is a relation the anon key can read, and the anon key is in every",
      "visitor's browser. `sql/rls-lockdown.sql` is what revokes it; re-run it, or revoke",
      "the grant that opened this one. If the exposure is deliberate, name it in",
      "DECLARED_EXPOSURES with the reason it exists.",
    );
  }
  if (declared.length > 0) {
    lines.push("", "Declared:");
    for (const entry of declared) lines.push(`  ${entry.relation} — ${entry.reason}`);
  }
  console.log(lines.join("\n"));
  process.exitCode = findings.length === 0 ? PASS : FINDINGS;
}

await main();
