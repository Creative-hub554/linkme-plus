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
#   * teardown  — REVOKE each grant, `DROP ROLE`, and a role census that must
#                 answer 0, so the drill leaves no residue behind to collide
#                 with its next run.
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

# --- the verdict ------------------------------------------------------------
echo "---"
if [ "$fails" -ne 0 ]; then
  echo "drill: $fails assertion(s) FAILED — the runbook's grant block no longer holds; fix the drift (or the runbook), then rerun" >&2
  exit 1
fi
echo "drill: mint-and-verify re-proven — the grant set is still exactly the alarm's read surface"
