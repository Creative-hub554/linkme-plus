#!/usr/bin/env bash
# One command for the live-Postgres smokes: bring up the scratch branch database,
# give it the real migrations and the real seed, then run the live smoke suite.
#
#   npm run smoke:postgres
#
# The branch is a vanilla Postgres in Docker (not Supabase), so three seams in
# the migration set need explicit stand-ins here — the same ones a dev checkout
# needs today, recorded in place rather than in tribal memory:
#
#   * migration 0004 creates its RLS policy `to authenticated` using
#     `auth.uid()` — plain Postgres has neither the role nor the function.
#   * that same migration adds `public.notifications` to the
#     `supabase_realtime` publication, which plain Postgres does not have.
#
# `drizzle-kit migrate` dies silently (exit 1, no error text) on plain Postgres,
# so the migrations are applied with `psql ON_ERROR_STOP` instead: per-file, in
# a single transaction each, recorded in `scratch_migrations` so the whole
# pipeline is rerunnable — a file already recorded is skipped, not re-applied.
# That table is a scratch-only bookkeeping stand-in for drizzle's own journal;
# it touches nothing the app reads.
#
# The seed reuses the project's own `npm run db:seed` (idempotent: a converged
# database reports "nothing to repair"), with `DATABASE_URL` put in the
# *environment* so it wins over `.env.local` under Node's `--env-file`
# precedence. The smoke itself is skipped by default in the suite and runs here
# with `SMOKE_LIVE_POSTGRES=1`; it cleans up behind itself, so this command is
# safe to run repeatedly against the same branch.
#
# Teardown when done with the branch: `docker rm -f "$CONTAINER"`.

set -euo pipefail

CONTAINER="${SMOKE_PG_CONTAINER:-linkme-smoke-pg}"
IMAGE="${SMOKE_PG_IMAGE:-postgres:16-alpine}"
PORT="${SMOKE_PG_PORT:-55432}"
PASSWORD="${SMOKE_PG_PASSWORD:-smoke-postgres}"
DATABASE="${SMOKE_PG_DATABASE:-linkme}"
DSN="postgres://postgres:${PASSWORD}@127.0.0.1:${PORT}/${DATABASE}"

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

psql() {
  docker exec -i "$CONTAINER" env PGPASSWORD="$PASSWORD" \
    psql -U postgres -d "$DATABASE" -v ON_ERROR_STOP=1 -q "$@"
}

# --- the container ---------------------------------------------------------
if docker inspect "$CONTAINER" >/dev/null 2>&1; then
  state="$(docker inspect -f '{{.State.Status}}' "$CONTAINER")"
  if [ "$state" != running ]; then
    docker start "$CONTAINER" >/dev/null
  fi
else
  # Owner/container-mode flags keep the volumes disposable: nothing outside the
  # container outlives it, so tearing the branch down is one plain `docker rm -f`.
  docker run -d --rm --name "$CONTAINER" \
    -e POSTGRES_PASSWORD="$PASSWORD" -e POSTGRES_DB="$DATABASE" \
    -p "127.0.0.1:${PORT}:5432" "$IMAGE" >/dev/null
fi

# Wait for Postgres to accept connections (a fresh container is "running" long
# before its init scripts have finished).
for _ in $(seq 1 60); do
  if psql -c 'select 1' >/dev/null 2>&1; then break; fi
  sleep 1
done
psql -c 'select 1' >/dev/null # surface a real failure if it never came up

# --- the Supabase-only seams ------------------------------------------------
# Stand-ins, not reimplementation: a no-login role pair the policy can name, an
# empty publication for 0004's `alter publication` to extend, and an `auth.uid()`
# stub returning null — its only reader is that RLS policy, and the app connects
# as the table owner, which bypasses RLS entirely.
psql <<'SQL'
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end $$;
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as
$$ select null::uuid $$;
do $$ begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;
create table if not exists scratch_migrations (
  name text primary key,
  applied_at timestamptz not null default now()
);
SQL

# --- the migrations ----------------------------------------------------------
# The loop enumerates with `find`, not a shell glob: under Git Bash (MSYS) a
# `*.sql` expansion leaves the paths at the mercy of the calling shell — it
# expands them to `C:/…` absolute paths, which joined again under "$drizzle_dir"
# produced `drizzle/C:/Workspace/.../0000_….sql`, a `cat` miss that aborted two
# runs of the pipeline. `find`'s matches are made by find itself, and the
# basenames the loop keeps are joined in exactly one place.
drizzle_dir="$root/drizzle"
for file in $(find "$drizzle_dir" -maxdepth 1 -type f -name '*.sql' | LC_ALL=C sort); do
  name="$(basename "$file")"
  if psql -Atc "select 1 from scratch_migrations where name = '$name'" | grep -qx 1; then
    echo "smoke-postgres: skipping applied migration $name"
  else
    # --single-transaction makes file + record one unit: a file that fails
    # leaves no trace and no half-applied schema.
    { cat "$drizzle_dir/$name"; echo "insert into scratch_migrations (name) values ('$name');"; } |
      psql -1 -f -
    echo "smoke-postgres: applied migration $name"
  fi
done

# --- the seed ----------------------------------------------------------------
echo "smoke-postgres: seeding (DATABASE_URL set in the environment; it wins over .env.local)"
DATABASE_URL="$DSN" npm run db:seed

# --- the smoke ---------------------------------------------------------------
echo "smoke-postgres: running the moderation live smokes (handlers + rendered dashboard) against $DSN"
# The two files run as parallel workers against the same branch on purpose,
# with deliberately disjoint row ids: the rendered smoke brings its own admin
# and report, so nothing it touches is the handler smoke's to also touch.
DATABASE_URL="$DSN" SMOKE_LIVE_POSTGRES=1 npx vitest run \
  src/lib/db/moderation-live-postgres.test.ts \
  src/app/api/admin/moderation-flow-live-postgres.rendered-smoke.test.tsx
