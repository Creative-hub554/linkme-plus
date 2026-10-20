#!/usr/bin/env bash
# The runbook's mint-and-verify procedure, as one command that re-proves it.
#
#   npm run alarm:drill
#
# `.freebuff/run.md`'s "The verification queue's nightly alarm" section tells an
# operator how to mint the read-only DSN the alarm pages through — a role whose
# grant set is exactly the alarm's read surface — and how to verify it before
# storing it as `NIGHTLY_QUEUE_DATABASE_URL`. This drill replays that whole
# block, statement by statement, against the smoke Postgres so the runbook's
# claims stay earned against schema drift, not just on the day they were written:
#
#   * mint      — `CREATE ROLE` + the three grants, the runbook's SQL verbatim;
#   * read      — the alarm's own join, through the minted role, selecting every
#                 column the alarm reads (`username`, `created_at`, `id`); a
#                 dropped or renamed table/column reds the drill here;
#   * refusals  — the three denials a least-privilege lease is made of, each
#                 asserted by its exact Postgres message;
#   * the drop fact — `DROP ROLE` refuses while privileges exist, the fact that
#                 puts REVOKE-each-then-drop in the runbook's teardown;
#   * armed run — the alarm's own suite read live through the minted lease
#                 (`QUEUE_ALARM=1`), exit 0 answering the runbook's "6 passed"
#                 or exit 1 wearing the alarm's own paging sentence. Both sidecar
#                 writes the armed test makes are then verified in lockstep: the
#                 verdict sidecar (shape-valid, window and settled size equal to
#                 the run) and the readings' second write — the queue-settled
#                 coverage line — same judging instant, same settled size, same
#                 window, same owed count. The line is the charted record, so a
#                 red run lands it too and either color is a record; a wrong one
#                 is a FAIL.
#   * teardown  — REVOKE each grant, `DROP ROLE`, a role census that must answer
#                 0, and the two transient sidecars deleted, so the drill leaves
#                 no residue behind to collide with its next run.
#
# Both sidecar paths and the settled line's prefix come from the modules that
# spell them (`.freebuff/queue-alarm-verdict.mjs`, `.freebuff/coverage-readings.mjs`),
# never hand-copied — the same registry walk the suite's own writer uses.
#
# Every assertion names itself PASS or FAIL; any FAIL exits 1. The drill never
# targets anything but the smoke branch's container (same `SMOKE_PG_*`
# variables as `scripts/smoke-postgres.sh`, which stands the seed up: the read
# answers the seed's pending handles there), and it is idempotent — a leftover
# role from an interrupted run is torn down before minting.
#
# A freshly-migrated container has the schema but not the seed, so the read can
# answer 0 rows: schema and privileges still hold, and the drill says so in a
# NOTE rather than a FAIL. Run `npm run smoke:postgres` once if you want the
# handle-answering half proven too.

set -euo pipefail

CONTAINER="${SMOKE_PG_CONTAINER:-linkme-smoke-pg}"
PORT="${SMOKE_PG_PORT:-55432}"
PASSWORD="${SMOKE_PG_PASSWORD:-smoke-postgres}"
DATABASE="${SMOKE_PG_DATABASE:-linkme}"

ROLE="nightly_queue_alarm"
# The armed run's sidecar anchors, empty until the armed stage resolves them
# through their modules (empty when the mint never happens — `set -u` stays
# honest about that).
VERDICT_PATH=""
SETTLED_PATH=""

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

fails=0

pass() { echo "drill: PASS $*"; }
fail() {
  echo "drill: FAIL $*" >&2
  fails=$((fails + 1))
}
note() { echo "drill: NOTE $*"; }

psql_owner() {
  # Owner statements; ON_ERROR_STOP makes a refusal a non-zero exit the
  # assertions can branch on instead of silently reading as a pass.
  docker exec -i "$CONTAINER" env PGPASSWORD="$PASSWORD" \
    psql -U postgres -d "$DATABASE" -v ON_ERROR_STOP=1 "$@"
}

psql_role() {
  # The same connection shape the minted secret would hand the nightly: the
  # role's password, the role's name, straight to the alarm's database.
  docker exec -i "$CONTAINER" env PGPASSWORD="$ROLE_PASSWORD" \
    psql -U "$ROLE" -d "$DATABASE" "$@"
}

# --- the container ----------------------------------------------------------
if ! docker inspect -f '{{.State.Status}}' "$CONTAINER" 2>/dev/null | grep -qx running; then
  echo "drill: FAIL container $CONTAINER is not running — stand it up with 'npm run smoke:postgres'" >&2
  exit 1
fi

# --- pre-teardown: an interrupted earlier run leaves a role ------------------
if [ "$(psql_owner -Atc "select count(*) from pg_roles where rolname = '$ROLE'")" != 0 ]; then
  echo "drill: tearing down a leftover $ROLE before minting"
  psql_owner <<SQL
REVOKE ALL ON DATABASE $DATABASE FROM $ROLE;
REVOKE ALL ON SCHEMA public FROM $ROLE;
REVOKE ALL ON TABLE public.verification_requests FROM $ROLE;
REVOKE ALL ON TABLE public.users FROM $ROLE;
DROP ROLE $ROLE;
SQL
fi

# --- the mint ---------------------------------------------------------------
ROLE_PASSWORD="$(openssl rand -hex 16 2>/dev/null || sha256sum <<<"drill-$$-$(date +%s%N)" | head -c 32)"
mint_ok=1
if psql_owner <<SQL
CREATE ROLE $ROLE LOGIN PASSWORD '$ROLE_PASSWORD';
GRANT CONNECT ON DATABASE $DATABASE TO $ROLE;
GRANT USAGE ON SCHEMA public TO $ROLE;
GRANT SELECT ON public.verification_requests, public.users TO $ROLE;
SQL
then
  pass "mint: role created; CONNECT + USAGE + the two-table SELECT granted — the runbook's grant set verbatim"
else
  fail "mint: the runbook's CREATE+GRANT block refused — see the psql red above (postgres-level drift, missing revision, or a leftover lock)"
  mint_ok=0
fi

# --- the read: the alarm's own join, through the role -----------------------
# The runbook's verify query is this join's shape; the drill selects the three
# columns the alarm's `PendingApplication` reads, so a dropped or renamed table
# or column reds exactly where the nightly would.
if read_output="$(psql_role -At <<SQL
SELECT u.username, r.created_at, r.id
FROM verification_requests r
JOIN users u ON u.id = r.user_id
WHERE r.status = 'pending'
ORDER BY r.created_at;
SQL
)"; then
  rows="$(printf '%s' "$read_output" | grep -c . || true)"
  if [ "$rows" -gt 0 ]; then
    pass "read: the alarm's join answered through the minted role ($rows pending row(s) visible)"
    printf '%s\n' "$read_output" | head -3 | cut -d'|' -f1 | sed 's/^/drill:       oldest handle: @/'
  else
    note "read: the join answered 0 rows (schema and privileges held; the seed's pending handles come from 'npm run smoke:postgres')"
  fi
else
  fail "read: the alarm's own join red through the minted role — schema drift the nightly would red too; see the psql error above"
fi

# --- the refusals: the lease is only a lease if the writes are denied --------
# Each assertion demands the exact Postgres message the runbook names. Both
# statements are parse-valid against today's schema (`users.role`, the
# requests' own columns) — a wrong column would fail parse analysis before the
# ACL check and read as drift rather than the lease speaking. A different
# refusal message is drift too, and reds rather than passing.
refuse() {
  local sql="$1" want="$2" label="$3" got
  if got="$(psql_role -v ON_ERROR_STOP=1 -c "$sql" 2>&1)"; then
    fail "refusal[$label]: the statement SUCCEEDED through a SELECT-only role — $sql"
  elif echo "$got" | grep -q "$want"; then
    pass "refusal[$label]: refused with exactly '$want'"
  else
    fail "refusal[$label]: red, but with the wrong refusal — wanted '$want', got: $(echo "$got" | head -1)"
  fi
}
refuse "INSERT INTO verification_requests (user_id, evidence_urls) VALUES (gen_random_uuid(), '{}');" \
  "permission denied for table verification_requests" "insert verification_requests"
refuse "UPDATE users SET role = 'admin' WHERE false;" \
  "permission denied for table users" "update users"
refuse "SELECT count(*) FROM posts;" \
  "permission denied for table posts" "read uninvited table posts"

# --- the drop fact: DROP ROLE refuses while privileges exist -----------------
if got="$(psql_owner -v ON_ERROR_STOP=1 -c "DROP ROLE $ROLE;" 2>&1)"; then
  fail "drop-order: bare DROP ROLE succeeded with privileges in place — the lease outlived the teardown it documents"
elif echo "$got" | grep -q "cannot be dropped because some objects depend on it"; then
  pass "drop-order: bare DROP ROLE refused with 'cannot be dropped because some objects depend on it' — teardown is REVOKE-each-then-drop"
else
  fail "drop-order: bare DROP ROLE red with the wrong refusal — wanted 'cannot be dropped because some objects depend on it', got: $(echo "$got" | head -1)"
fi

# --- the armed run: the alarm reads the lease and lands both sidecars --------
# The minted lease is exercised the one way a psql probe cannot: through the
# suite the nightly runs, in the shape the night reads it. The drill reads its
# own queue (the stage above) and widens no claim it does not own — when the
# smoke's seed holds an application older than the default window, the drill
# moves the window past that row's age so this run's verdict is the *green*
# shape; a red on the default window is what the runbook's recorded drill says
# the paging looks like, and the drill says so rather than red itself.
if [ "$mint_ok" = 1 ]; then

  oldest="$(psql_owner -Atc "select coalesce(max(floor(extract(epoch from now()-created_at)/3600)),0)::int from verification_requests where status = 'pending'")"
  if [ "$oldest" -gt 47 ]; then WINDOW=$((oldest + 1)); else WINDOW=48; fi

  # The write anchors, spelled once: the verdict sidecar's path from its
  # module, and the settled-reading's path from the registry entry the suite's
  # own writer built its line through — the read step below checks that the
  # landed line *is* a queue-settled reading via the registry's own
  # carriedReading, never a hand-copied prefix.
  VERDICT_PATH="$(node --input-type=module -e '
    const { queueAlarmPath } = await import("./.freebuff/queue-alarm-verdict.mjs");
    console.log(queueAlarmPath(process.cwd()));
  ')"
  SETTLED_PATH="$(node --input-type=module -e '
    const { QUEUE_SETTLED_READING, readingPath } = await import("./.freebuff/coverage-readings.mjs");
    console.log(readingPath(QUEUE_SETTLED_READING, process.cwd()));
  ')"

  # The runner clears each sidecar per attempt; the drill stands in for that
  # clear so a leftover from an earlier run cannot answer for this one's write.
  rm -f "$VERDICT_PATH" "$SETTLED_PATH"

  DSN="postgres://$ROLE:$ROLE_PASSWORD@127.0.0.1:$PORT/$DATABASE"
  armed_out="$(QUEUE_ALARM=1 QUEUE_ALARM_MAX_HOURS="$WINDOW" DATABASE_URL="$DSN" npx vitest run src/test/verification-queue-alarm.test.ts 2>&1)" && armed_rc=0 || armed_rc=$?
  if [ "$armed_rc" -eq 0 ]; then
    if printf '%s\n' "$armed_out" | grep -q '6 passed'; then
      pass "armed run: green through the minted lease — vitest answered the runbook's 6 passed at a ${WINDOW}h window"
    else
      fail "armed run: vitest answered green, but not with the runbook's '6 passed' line — see the output above"
    fi
  elif [ "$armed_rc" -eq 1 ] && printf '%s\n' "$armed_out" | grep -q 'pending verification application(s) have waited longer than'; then
    printf '%s\n' "$armed_out" | grep -m1 'pending verification application(s) have waited longer than' | sed 's/^/drill:       red, and the red IS the paging sentence: /'
    pass "armed run: exit 1 wearing the alarm's own sentence — the sidecars below are a red run's record, as the verdict sidecar's contract says"
  else
    fail "armed run: vitest exited $armed_rc without either green or the alarm's own sentence — see the output above"
  fi

  # The FIRST write: the verdict sidecar — shape-valid by its own module's
  # validator, and equal to the drill's own read in window and settled size.
  verdict="$(VERDICT_PATH="$VERDICT_PATH" node --input-type=module -e '
    const { readFileSync } = await import("node:fs");
    const { parseQueueAlarmVerdict } = await import("./.freebuff/queue-alarm-verdict.mjs");
    let v = null;
    try { v = parseQueueAlarmVerdict(readFileSync(process.env.VERDICT_PATH, "utf8")); } catch {}
    if (v === null) { console.log("BAD shape"); }
    else { console.log("OK", v.maxAgeHours, v.pending, v.overdue.length, v.judgedAt); }
  ')"
  read -r v_status v_window v_pending v_overdue v_judged <<<"$verdict"
  if [ "$v_status" = "OK" ]; then
    if [ "$v_window" = "$WINDOW" ] && [ "$v_pending" = "$rows" ]; then
      pass "verdict sidecar: shape-valid; window ${v_window}h and settled size ${v_pending} match the run and the drill's own read"
    else
      fail "verdict sidecar: landed, but window/settled size disagree with the run (wanted ${WINDOW}h and ${rows}) — got ${v_window}h and ${v_pending}"
    fi
  else
    fail "verdict sidecar: absent or wrong shape at $VERDICT_PATH — the drill's armed run may never read as one"
  fi

  # The SECOND write: the queue-settled coverage line — the charted record.
  # Read back through the registry's own carriedReading + metricOf (the trend's
  # consumer path), then cross-checked field by field against the verdict: one
  # judgment instant, one settled size, one window, one owed count.
  settled="$(SETTLED_PATH="$SETTLED_PATH" node --input-type=module -e '
    const { readFileSync } = await import("node:fs");
    const { QUEUE_SETTLED_READING, carriedReading, metricOf } = await import("./.freebuff/coverage-readings.mjs");
    const text = readFileSync(process.env.SETTLED_PATH, "utf8");
    const carried = carriedReading(QUEUE_SETTLED_READING, text);
    if (carried === null) { console.log("BAD line is not a queue-settled reading"); }
    else {
      const match = /pending application\(s\) — judged (\S+) against a ([0-9.]+)h window; (\d+) owed past it\.$/.exec(
        carried.slice(QUEUE_SETTLED_READING.prefix.length).trim());
      if (match === null) { console.log("BAD the line no longer matches its own prose pattern:", carried); }
      else { console.log("OK", metricOf(QUEUE_SETTLED_READING, text), match[1], match[2], match[3]); }
    }
  ')"
  read -r s_status s_metric s_judged s_window s_owed <<<"$settled"
  if [ "$s_status" = "OK" ]; then
    if [ "$s_metric" != "$v_pending" ] || [ "$s_window" != "$WINDOW" ] || [ "$s_judged" != "$v_judged" ] || [ "$s_owed" != "$v_overdue" ]; then
      fail "settled-size line: landed, but out of lockstep with the verdict sidecar — metric $s_metric / judged $s_judged / window ${s_window}h / owed $s_owed"
    else
      pass "settled-size line: landed and in lockstep — ${s_metric} pending applications, judged $s_judged against a ${s_window}h window, ${s_owed} owed past it: the verdict sidecar's own facts"
    fi
  else
    fail "settled-size line: never landed at $SETTLED_PATH — $s_status"
  fi

else
  note "armed run: skipped — the mint never happened, so there is no lease to read through and no sidecar to expect"
fi

# --- the teardown -----------------------------------------------------------
psql_owner <<SQL
REVOKE ALL ON DATABASE $DATABASE FROM $ROLE;
REVOKE ALL ON SCHEMA public FROM $ROLE;
REVOKE ALL ON TABLE public.verification_requests FROM $ROLE;
REVOKE ALL ON TABLE public.users FROM $ROLE;
DROP ROLE $ROLE;
SQL
if [ "$(psql_owner -Atc "select count(*) from pg_roles where rolname = '$ROLE'")" = 0 ]; then
  pass "teardown: role revoked, dropped, census 0 — the drill leaves no residue"
else
  fail "teardown: the role census is not 0 after REVOKE+DROP"
fi
rm -f -- "$VERDICT_PATH" "$SETTLED_PATH" 2>/dev/null || :
if [ "$mint_ok" = 1 ] && [ ! -e "$VERDICT_PATH" ] && [ ! -e "$SETTLED_PATH" ]; then
  pass "sidecar residue: both sidecar writes deleted — nothing transient answers for the next run"
fi

# --- the verdict ------------------------------------------------------------
echo "---"
if [ "$fails" -ne 0 ]; then
  echo "drill: $fails assertion(s) FAILED — the runbook's grant block no longer holds; fix the drift (or the runbook), then rerun" >&2
  exit 1
fi
echo "drill: mint-and-verify re-proven — the grant set is still exactly the alarm's read surface"
