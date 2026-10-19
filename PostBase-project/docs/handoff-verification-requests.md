# Handoff: account verification (`verification_requests`)

One screen. The whole feature is currently **untracked work by the other writer**; the
only outside hand is the lint fix in the admin route's test, whose two hunks are itemized
below so they can land inside (not after) that commit.

## Wired and green (all inside the full default suite, 234 passed / 1 failed / 4 skipped, tests 3305 passed)

- **Schema:** `verification_requests` table in `src/lib/db/schema.ts`, with migration
  `drizzle/0016_account_verification.sql` + `drizzle/meta/0016_snapshot.json` and the
  journal entry.
- **Member side:** `GET/POST /api/verification-requests` — status + latest-only review
  note for the owner, evidence-link validation (≤5 links, https only, no credentials in
  the URL, deduped).
- **Admin side:** `GET/POST /api/admin/verification-requests` — pending queue over
  joins (`users.username`, `profiles.displayName`), reviewer gate, transactional
  approve/reject that flips `users.verified` and audits `verification.*`, 409 on an
  already-reviewed request.
- **Tests, per link of the chain:** admin `route.test.ts` (6 cases, gate + reads/writes
  pinned), `admin-verification-requests.test.tsx`, and the rendered end-to-end
  `verification-flow.rendered-smoke.test.tsx`; queue tab on
  `src/app/(main)/admin/page.tsx`.

## The two hunks borrowed into your uncommitted tree

1. `route.test.ts` import line: `profiles` dropped from the schema import (it was the
   lint-baseline's only finding, `no-unused-vars`).
2. Same file, queue case: the joined identity fields (`username`, `displayName`) are
   now pinned in the response assertion — the scripted row already carried them.

Net effect: `src/test/lint-baseline.test.ts` is green (was red on this finding), the
file's own suite is 6/6, ESLint clean on the file, collect-budget at ~6%. Keep both
hunks (or equivalent) when you commit, and the baseline stays green.

## Still yours

- **The commit itself** — everything above is `??` untracked or uncommitted
  (`schema.ts`, `_journal.json`, `admin/page.tsx`, the rendered smoke, both components).
- **Gate re-pin decision** — the suite's one remaining red is
  `gate-drift.test.ts` on `tsconfig.json` / `vite.config.ts` / `wrangler.jsonc`
  (all `changed` vs pins). Ride your config commit with a deliberate
  `npm run gates:pin`, or revert the accidental-looking `.ts` import in `vite.config.ts`.
- **Open quality items (optional):** the seed has no verification fixture, the
  live-Postgres smoke exercises moderation but not verification, and no doc in `docs/`
  mentions the feature yet — PRD/deployment blanks, not blockers.
