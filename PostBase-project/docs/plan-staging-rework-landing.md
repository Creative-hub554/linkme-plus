# Landing plan: the staging rework, reconciled needles, and `gates:pin`

One commit, five files. The staging rework and its reconciliation were split
across two writers and left uncommitted by design (commit `e189c2f` proves the
split); they only hold together — and only land green — as the single set
below. The doc pair is deliberately not gate-pinned (grep of
`.freebuff/gate-hashes.mjs` finds no `DEPLOYMENT`/doc-freshness entries), so
the pins that need re-recording are exactly the three configs the doctor
names.

## The atomic set

| File | Owner | Content of the landing |
|---|---|---|
| `docs/DEPLOYMENT.md` | yours | worktree residue: the wrangler-prerequisites rewrite and the staging section rewrite (`CLOUDFLARE_ENV=staging npm run build` + `npx wrangler deploy --env staging`) |
| `src/test/deployment-doc-freshness.test.ts` | borrowed from the doc thread | the reconciliation: exclusion-note rewrite, `deployScript`/`stagingBuildScript` needles (with the dropped-`deploy:staging` rationale), loop entry `"deploy":` — **and it already carries the `'"admin:grant":'` hold** that commits with your `package.json` line |
| `package.json` | yours | `deploy:staging` removed, `deploy:production` aliased, **`admin:grant` script present in the worktree** (the hold above verifies it) |
| `tsconfig.json`, `wrangler.jsonc`, `vite.config.ts` | yours | already on disk; their hashes re-recorded by the pin |
| `.freebuff/gate-hashes.mjs` | produced by `npm run gates:pin` | new pins for the three configs |

Pin or revert, decided by evidence: the `vite.config.ts` `./…dev-websocket.ts`
import is a deliberate style, not an accident — the extension-on-import is
already the src-tree's own convention (`dev-websocket.ts` itself imports
`./room-hub.ts` and `./ws-session.ts` that way), and `tsconfig.json` carries
`allowImportingTsExtensions` with `noEmit: true`, so the pair typechecks. If
you disagree, revert both the vite import *and* the tsconfig flag, then pin.

## Why the pieces cannot land separately

- Doc rewrite alone: the committed tree still holds `deployStagingScript`
  (`npm run deploy:staging`) against a guide that no longer contains it — red
  by its own needle.
- Needles alone: `stagingBuildScript` self-holds against doc text that is only
  in the rewrite — red.
- `package.json` script changes alone: the committed loop entry still holds
  `"deploy:staging":` against a package.json that no longer has it — red.
- Config changes without `gates:pin`: the gate check exits 1 (currently does;
  `node .freebuff/gate-drift.mjs` exit 1, verified). Pinning without
  committing the configs in the same commit leaves the manifest describing a
  tree nobody has.

## The sequence (all verified against the current tree)

```bash
npx vitest run src/test/deployment-doc-freshness.test.ts src/test/prd-doc-freshness.test.ts  # doc pair green now (10/10, last verified before e189c2f; unchanged since)
npm run gates:pin          # re-records 58 pins; exits 0 only if all three configs are the on-disk truth
node .freebuff/gate-drift.mjs   # must exit 0 after the pin
git add package.json tsconfig.json vite.config.ts wrangler.jsonc \
        .freebuff/gate-hashes.mjs docs/DEPLOYMENT.md \
        src/test/deployment-doc-freshness.test.ts
git commit
npx vitest run src/test/deployment-doc-freshness.test.ts src/test/prd-doc-freshness.test.ts  # re-verify post-commit
```

The families' own verdicts, for the commit message: wrangler.jsonc — extend
the preflight stage, which already keys `wrangler.jsonc`; tsconfig.json —
extend the lint stage, which already keys `eslint.config.mjs`; vite.config.ts
— held by the preflight stage.

## Not in this commit

The runbook's other borrowed pair — `db:seed`/`smoke:postgres` (landed in
`af9b8d9`), the verification docs (landed in `e189c2f`), and the new live
smoke files — needs nothing here. The untracked verification feature tree
(`verification-requests/`, both components, the rendered smoke) is yours to
commit separately; its PRD/DEPLOYMENT claims and needles are already held from
that commit.
