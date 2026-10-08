/**
 * The pinned hashes of the build's gate machinery, recorded.
 *
 * Generated — do not edit by hand. `npm run gates:pin` rewrites `files` from the tree,
 * and `npm run gates:drift` (and the CI stage it backs) fails the build when a watched
 * file's hash is not the one recorded here. A hand-edit that keeps the hashes but changes
 * the watch rules is caught too: the alarm refuses a manifest whose recorded rules are not
 * `DEFAULT_WATCHES`, and `src/test/gate-drift.test.ts` compares this file, byte for byte,
 * to what `--write` would produce and pins the set of files it names.
 *
 * The alarm exists because a loosened gate is otherwise silent, and because nothing
 * outside a gate reads it. The suite pins what each gate *does*, and
 * `npm run mutation:coverage` proves the coverage tests still notice a weakening — but
 * neither is watching the files themselves, so a stage with empty `inputs`, an extra
 * suite `exclude`, a launcher that stops calling a survivor a survivor, a threshold moved
 * in `coverage-thresholds.mjs`, an `exclude` in `tsconfig.json` widened until a type is
 * never checked, a literal added to `vite.config.ts`'s `define:` table, an image host
 * widened in `next.config.mjs`, the plugin dropped from `postcss.config.mjs` so the
 * stylesheet pipeline stops emitting utilities, a binding removed from `wrangler.jsonc` so
 * the deployed worker no longer has it, or a step deleted from a workflow, passes every test
 * it was written to pass. Recorded
 * content turns that into a loud failure with one command to answer it:
 *
 *   npm run gates:pin     # re-pin after a deliberate change, and say why in the diff
 *
 * `watches` is the rule set the pin was built from, recorded here so what the alarm covers
 * is a reviewed line in this file's diff as well as a declaration in the script. The two are
 * held equal — a manifest that recorded a different set is refused, and `npm run gates:pin`
 * renders the declaration — so a widening of the pin cannot be half-recorded. `algorithm`
 * names the digest both sides use, so a future move to a stronger one is a recorded fact and
 * not a silent mismatch. A rule that matches nothing is not a narrow pin but a broken one,
 * and the checker refuses an empty pin rather than passing it.
 */

export const algorithm = "sha1";

export const watches = [
  {"dir":".freebuff","pattern":"^coverage-.*\\.mjs$"},
  {"dir":".freebuff","pattern":"^(ci|comment-gate|gate-drift|redact|nightly-report|pr-comment|import-closure)\\.mjs$"},
  {"dir":".freebuff","pattern":"^stage-order\\.json$"},
  {"dir":".freebuff","pattern":"^mutation-.*\\.mjs$"},
  {"dir":".freebuff","pattern":"^whole-write\\.mjs$"},
  {"dir":".freebuff","pattern":"^scaffold-sweep\\.mjs$"},
  {"dir":".freebuff","pattern":"^(build-contents|runbook-contents|lint-baseline|preview-preflight)\\.mjs$"},
  {"dir":".freebuff","pattern":"^(collect-.*|.*-collect-baselines)\\.mjs$"},
  {"dir":".","pattern":"^vitest(\\..+)?\\.config\\.ts$"},
  {"dir":".","pattern":"^(next|vite)\\.config\\.(mjs|ts)$"},
  {"dir":".","pattern":"^(postcss\\.config\\.mjs|wrangler\\.jsonc)$"},
  {"dir":".","pattern":"^(tsconfig.*\\.json|eslint\\.config\\..*)$"},
  {"dir":".github/workflows","pattern":"^.*\\.ya?ml$"},
  {"dir":"../.github/workflows","pattern":"^.*\\.ya?ml$"},
];

export const files = {
  "../.github/workflows/ci.yml": "06f6abb57e96a162cfd254f01e7787c8dc421028",
  "../.github/workflows/collect-apply.yml": "176bc86ef5c5741a5296a3bb2393fff8108fe06a",
  "../.github/workflows/nightly.yml": "a79f7e9583278f84e7ae15c566d7bbd8188c72b4",
  ".freebuff/apply-collect-baselines.mjs": "c804eb03816d8251a0932a9d4503208dcbc5d7a4",
  ".freebuff/build-contents.mjs": "5a3c1e4d3639ccf4ad345d128ff83dc163b73795",
  ".freebuff/ci.mjs": "225a1dfe73cbf99faba21ea09775489c9d5c3475",
  ".freebuff/collect-apply.mjs": "2e12a5bbd12b165575da17cb76fa71a5e4660880",
  ".freebuff/collect-budget-baselines.mjs": "b2d757d381a325adc94e743084d763bc95f5aaeb",
  ".freebuff/collect-budget-soft.mjs": "1ba522fec3a00c11613fc50d8d45291df9768d44",
  ".freebuff/collect-gates.mjs": "c10acc076833e6b0cdd0a3085222add353a32753",
  ".freebuff/collect-run.mjs": "87c0b38becff1a1c9160c75bb0b4368ed56dc75d",
  ".freebuff/comment-gate.mjs": "20aad7dfe9b249caf0da54622d356ec8423740d2",
  ".freebuff/coverage-floor-rules.mjs": "89d91fa2e103bb3ace771e9a6b9efb89673b933f",
  ".freebuff/coverage-floor.mjs": "8b8c09a14c3dd3de274c567957edbd9f65542b4d",
  ".freebuff/coverage-headroom.mjs": "f0520d89ade9dddc6b3555a734598213f9aa6357",
  ".freebuff/coverage-history.mjs": "8a5a09f7099a00b01f5fc1fefebdeb8319fd4b91",
  ".freebuff/coverage-propose.mjs": "f4d8b6a3cb2b5c607fc05e671612ca4a12750e32",
  ".freebuff/coverage-report.mjs": "25c1e27ae5819b3865c272975b65650f12093657",
  ".freebuff/coverage-scopes.mjs": "07f3ec2575c15e67da404bcd81fbc2ff2fbda739",
  ".freebuff/coverage-strikes.mjs": "d57cb5a6ad4db910ba0235cb1607d8fccaf7ebea",
  ".freebuff/coverage-thresholds.mjs": "cdcd700dc4dea46d3e3cff2c0d4f2270e54bbb78",
  ".freebuff/gate-collect-baselines.mjs": "395b7628aa9c72ea866880f56054a50d1bbd5015",
  ".freebuff/gate-drift.mjs": "73e96b2d9352a1c03d7ed9389caca58412d094b3",
  ".freebuff/import-closure.mjs": "0c013ff33489db8ab7d04222d8e41b84114f9359",
  ".freebuff/lint-baseline.mjs": "4985328e061d42d0d975ab0a905bd631d9772dcc",
  ".freebuff/mutation-coverage.mjs": "282a71b0d568a447e77854d05eb1362b2e49140c",
  ".freebuff/mutation-example.mjs": "440dd90c68aba69008e15d9187f85b0e24251375",
  ".freebuff/mutation-fifth.mjs": "f775d95ca4d01d0e495ca67fa60d2b4c36f49c66",
  ".freebuff/mutation-guards.mjs": "02b249e886ae49ccaca6820d9d3d0be1aae8a47d",
  ".freebuff/mutation-lock.mjs": "1f01e790916d0e81131ed2f50adbd0760855bb86",
  ".freebuff/mutation-preflight.mjs": "4ece45b95591c97673561f590f0522176ae3ef24",
  ".freebuff/mutation-vocabulary.mjs": "7004f409d501b855e205dff62214a643dee23a27",
  ".freebuff/nightly-report.mjs": "5e2f7aa1c75513d51d054a61dc0b9c4ff0d3a9c0",
  ".freebuff/pr-comment.mjs": "9f42bcd766c8f7d1e9cff0088a1792a2e51fe269",
  ".freebuff/preview-preflight.mjs": "f45b2c93fd83eb09c8e974965869c9abcecadfca",
  ".freebuff/propose-collect-baselines.mjs": "c43af416465343180c0c085699e1a0b3494e7bc0",
  ".freebuff/record-collect-baselines.mjs": "6f8684848e586beec25a5d361cfb5a3affbc8b69",
  ".freebuff/redact.mjs": "896148668b23e756f2b162a23c3b46c7effdfd13",
  ".freebuff/runbook-contents.mjs": "7d50cb5a83799cd3f388ed6c2aac540298ea6cdf",
  ".freebuff/scaffold-sweep.mjs": "d57fa0fd6e56cca1ad5d6da12ecd54b2c3442e38",
  ".freebuff/stage-order.json": "db851a8db5470b8d72e00a6443723d2a0adc98ac",
  ".freebuff/whole-write.mjs": "09b2940f3e7c667e9df9fe673c0f01e9e38e1954",
  ".github/workflows/ci.yml": "e22310129e5c97794f5592bd034e8290ba567673",
  ".github/workflows/collect-apply.yml": "daf4b2bdd25d9e98924ee21587c928d5d644ee83",
  ".github/workflows/nightly.yml": "0a7939f3cc49e7406983e3494fd91e24e5a37e45",
  "eslint.config.mjs": "bd761c6281906b47654ca74f935ab3d0485a73c3",
  "next.config.mjs": "5b8c8f1b8c74942de25b86d40886935234b1132b",
  "postcss.config.mjs": "8f8be689e9af58f80351df6e6b551146822f42a4",
  "tsconfig.json": "a076ee85950d91fb2bca6d0eb34a9b01f3f496a2",
  "vite.config.ts": "0dc836972f946782c5b7e126a4ab86bfed3e6d24",
  "vitest.config.ts": "708823f6e0b2d2318aa0990087266eb79a51d39e",
  "vitest.mutation.config.ts": "8175e1110ca2ddc20b3d197b1108dbae5ed8d5c4",
  "wrangler.jsonc": "6e156adc28562b3124f637db4fe41a1a8809956e",
};
