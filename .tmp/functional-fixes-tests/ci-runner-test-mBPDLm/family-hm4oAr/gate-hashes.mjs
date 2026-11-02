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
  {"dir":"C:\\Workspace\\Websitebuildertoolsai\\.tmp\\functional-fixes-tests\\ci-runner-test-mBPDLm\\family-hm4oAr","pattern":"^coverage-.*\\.mjs$"},
  {"dir":"C:\\Workspace\\Websitebuildertoolsai\\.tmp\\functional-fixes-tests\\ci-runner-test-mBPDLm\\family-hm4oAr","pattern":"^ghost-.*\\.mjs$"},
];

export const files = {
  "../.tmp/functional-fixes-tests/ci-runner-test-mBPDLm/family-hm4oAr/coverage-alpha.mjs": "fbc193084132a8af7deb74cc43b4cc2187d8fb85",
  "../.tmp/functional-fixes-tests/ci-runner-test-mBPDLm/family-hm4oAr/ghost-one.mjs": "1c065812a39cac49f3cff4a2d03b4387e19266ba",
  "../.tmp/functional-fixes-tests/ci-runner-test-mBPDLm/family-hm4oAr/stray.mjs": "8465aebfbf0d95b4ab22408f02934ad98c79bc31",
};
