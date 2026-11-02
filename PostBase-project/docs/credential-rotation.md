# Credential rotation checklist

The step-by-step procedure for rotating the leaked database credential, and the
map of every place that credential lives. Written for the 2026-10-21 leak but
shaped to be reusable: the same order of operations covers a re-paste of any of
the eight secret values, with `DATABASE_URL` as the running example because it
is the one currently burned.

## The incident

On 2026-10-21, two of the throwaway probe scripts used to verify the fresh
deploy echoed `.env.local`'s `DATABASE_URL` — the full DSN, password included —
into a shared terminal's scrollback when their URL parsing failed. The value
never appeared in chat, but that terminal buffer is shared and cannot be
scrubbed, and the hosts all carry the same value, so the credential is treated
as leaked and rotated rather than merely replaced. The account that was used in
the verification itself (#buffy_verify, one auth user + its ensured profile) was
already fully deleted the same day, so there are no rogue rows to clean up
alongside the rotation.

## Where the credential lives (verified 2026-10-26)

| # | Location | What is there | Action |
|---|----------|---------------|--------|
| 1 | Supabase project (dashboard → Settings → Database) | The live database password — the authoritative copy | **Reset** (this is the rotation) |
| 2 | `.env.local` (repo root, git-ignored) | Full local copy of all 8 secrets, the single source every script and build reads | **Update** with the new DSN |
| 3 | Sites → Secrets on `PostBase-project` preview (`site-fd727782…`, env `fd727782-ac96-…`) | All 8 secrets, `DATABASE_URL` included (names confirmed set 2026-10-26; values not inspected) | **Update** |
| 4 | Sites → Secrets on `PostBase` preview (`site-bc8fada9…`, env `bc8fada9-cb17-…`) | Same 8 secret set (names confirmed set 2026-10-26; values not inspected) | **Update** |
| 5 | `PostBase-project` production / `PostBase` production environments | **Zero** bindings or secrets (both are undeployed and unpublished) | Nothing — if either is ever deployed, repeat steps per environment |
| 6 | `dist/server/.dev.vars` | A derived preview artifact written from the build/preview environment, git-ignored under `/dist/` | **Delete** after rotation; regenerated from the environment on the next build/preview |
| 7 | Shared terminal scrollback (already consumed) | The leaked DSN | Cannot be scrubbed — this is why rotation, not replacement |
| 8 | Shell history / chat / scratch dirs | Checked clean on 2026-10-22: the DSN was only ever script *output*, not a command argument; the scratch value files used to stage secrets were deleted the same day. Chat log avoided it entirely | Nothing |

Code is clean by construction: `DATABASE_URL` is read only through the runtime
env indirection (`src/lib/db/index.ts` normalises `runtimeEnv.DATABASE_URL` and
throws when absent); `drizzle.config.ts` and the `.freebuff/*.mjs` helpers read
the process environment (most with `--env-file-if-exists=.env.local`); tests use
a fake DSN (`src/test/setup.ts`). No value is embedded anywhere a grep can reach.

## IMPORTANT — how rotation propagates here

`npm run sites:prepare` (`.freebuff/sites-prepare.mjs`) merges `.env.local` into
the build environment because `vinext build` prerenders and the server entry
loads `DATABASE_URL` at module scope (`src/lib/db/index.ts` throws without it).
So **`.env.local` is the single source of truth**: it must be updated *first*
among the downstream copies, and every build after a rotation runs with the
value `.env.local` carried at that moment.

Also note Supabase invalidates the old password the moment the reset lands —
there is no overlap window where both work. The database is briefly
unreachable from every consumer between the reset and the last update. Do all
the steps in one sitting; the expected outage is minutes, not hours.

## The checklist

- [ ] **1. Reset the password at the provider.**
      Supabase dashboard → Project → Settings → Database → Connection string /
      Reset database password. Generate rather than type. Copy the full new
      connection string while the dashboard has it (pick the same pooler/host
      form the old DSN used — session pooler if that is what `.env.local`
      carried — so only the password changes).
- [ ] **2. Update `.env.local` first** (the source every script reads). Replace
      only the `DATABASE_URL` line's password. Do not paste the new value into
      chat, terminals or commit messages; edit the file directly.
- [ ] **3. Update Sites → Secrets**, name `DATABASE_URL`, on both preview
      environments listed in the table above (Sites → PostBase-project →
      Preview → Secrets, and Sites → PostBase → Preview → Secrets). No redeploy
      is needed: a running Worker picks up secret changes immediately.
- [ ] **4. Update the derived copy**: `rm dist/server/.dev.vars` (regenerated
      on the next build or preview from the environment, which now carries the
      new value).
- [ ] **5. Verify local**: `npm run dev` on a fresh terminal, and
      `npm run db:studio` or `npm run db:push` once — both must accept the new
      DSN before the hosts are trusted.
- [ ] **6. Verify both hosts**: on
      `https://site-fd727782ac9645da971df78387e95d85.freebuff.page` and
      `https://site-bc8fada9cb174349b71781295add34c3.freebuff.page`, `GET /`
      must return 200 HTML, `GET /feed` must return the signed-out kick-back
      (307 to login, not a database-error 500), and `GET /api/posts` must
      return 401 JSON — all three read the database server-side, so all three
      prove the pooler accepts the new password. (The former probe,
      `GET /api/health`, is gone as of the 2026-10-22 source work: the route
      no longer exists in the app tree, so it answers 404 on every host and
      cannot tell a rotten DB from a missing route.)
- [ ] **7. Confirm nothing else holds the old value**: re-run the inventory
      grep (`grep -rn "DATABASE_URL" --exclude-dir=node_modules`) and confirm
      every hit is a *name* reference, not a literal; confirm `git status` shows
      no staged env changes; if a new scratch copy was ever kept, delete it.
- [ ] **8. Record the rotation date** in the section below so this file stays
      the credential ledger, not just a procedure.

## Rotation ledger

*(add one line per rotation — date, credential, status)*

- 2026-10-31: removed the ignored derived artifact `dist/server/.dev.vars`
  and verified it is absent. Its contents were not read, displayed, or logged
  during cleanup.

- 2026-10-27: owner reported changing the database password. A fresh local
  connection using `.env.local` completed `SELECT 1` successfully without
  printing credentials. Public production `/`, `/jobs`, and `/marketplace`
  answered HTTP 200 without a server-error page.

- 2026-10-27: propagation verified where a credential lives. `GET /api/jobs`
  answered 200 with seeded rows — a database read, not a cached page — on both
  preview hosts (`site-fd727782…`, `site-bc8fada9…`), on `linkmeplus.com` and on
  `www.linkmeplus.com`. That accepts the new password from all three consumers
  (local `.env.local`, both preview secret sets, the production Worker). The old
  password's rejection is implied by the provider invalidating it at reset; it
  was not tested directly, and no credential value was read or printed. The
  remaining rotation items are the ones no probe can settle: any `dist` copy
  deletion and the ledger's checklist steps done in one sitting.

- 2026-10-21: `#buffy_verify` throwaway verification account deleted (auth user
  + profile cascade, `remaining: 0`). Not a credential rotation; recorded
  because it is the same security surface.
- 2026-10-22: checklist written; rotation **pending** — the owner must reset
  the password at Supabase (step 1); no tool available to this workspace can do
  it (the Supabase connector here is read-only for project settings).
- 2026-10-22: step 6 re-pointed at `/` (200) + `/feed` (307) + `/api/posts`
  (401 JSON) — the old probe, `GET /api/health`, was deleted from the source
  tree in the same day's route work, so it now answers 404 on every host and
  would read as a failed database even on a healthy one.

## Going forward

### Production Worker discovered 2026-10-27

The Sites production rows above do not describe the separately deployed
Cloudflare Worker. `linkme-plus` serves `linkmeplus.com` and
`www.linkmeplus.com` and has a `DATABASE_URL` secret. Include that Worker in
the same rotation session: update its secret through Wrangler's interactive
secret input or the Cloudflare dashboard without putting the value in command
arguments, logs, or chat. Preserve its other secrets and bindings. A secret
update can deploy a new Worker version; verify production immediately.

On 2026-10-27 the owner initially reported rotation status as unknown and later
reported changing the password. See the ledger for subsequent verification.
Do not print the old DSN to check it.

The same shape covers any of the eight secret names: reset at the authoritative
provider (R2 token: rotate in the Cloudflare dashboard and update all R2_*
names). Keep this file as the ledger — a checklist nobody updated is a checklist nobody ran.
