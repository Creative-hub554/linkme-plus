/**
 * The coverage-scope algebra, in one place.
 *
 * Three scripts answer questions about the same `.coverage/coverage-summary.json`,
 * and all three need the same ingredients: the metric order, the thresholds
 * `.freebuff/coverage-thresholds.mjs` holds (the bare whole-tree backstop and the
 * per-directory globs), and the aggregate a scope has actually reached.
 * `.freebuff/coverage-report.mjs` publishes that aggregate's headroom,
 * `.freebuff/coverage-headroom.mjs` fails the build for less than a point of it,
 * and `.freebuff/coverage-propose.mjs` turns a pull request's delta into proposed
 * raises. Sharing the algebra is what keeps a report, a gate and a proposal from
 * disagreeing about what a scope's number is — the same reason the thresholds
 * themselves live in one module.
 *
 * The rows `scopesOf` returns are both the report's table and the proposer's
 * input, so each carries what the two need beyond a percentage: `kind` says
 * whether it is the whole-tree backstop, a directory glob, or the files no glob
 * names (`"backstop"`, `"directory"`, `"unmatched"`); `key` is the glob for a
 * directory row and `null` otherwise; `metrics` is the aggregate; and `floors` is
 * the threshold it is held to, or `null` where the backstop would say nothing
 * useful about those files.
 *
 * `HEADROOM_TARGET` lives here too, because it is the one number the three
 * scripts must agree on rather than merely a shape they share: the gate fails for
 * a whole-tree margin under it, the report's ⚠ marks the same event, and the
 * proposer computes each proposed threshold as the tightest integer that still
 * leaves it. As a literal copied into each file it could drift silently — a gate
 * one point wide next to a proposer that assumes half a point proposes a number
 * the gate then rejects — so it is exported once and read by all three.
 */
import { relative } from "node:path";
import thresholds from "./coverage-thresholds.mjs";

/** The metrics, in the order they are displayed. */
export const METRICS = ["lines", "statements", "branches", "functions"];

/** The bare metric keys in the thresholds module: the whole-tree backstop. */
export const BACKSTOP = Object.fromEntries(
  METRICS.filter((metric) => typeof thresholds[metric] === "number").map((metric) => [
    metric,
    thresholds[metric],
  ]),
);

/** The glob keys in the thresholds module: one aggregate gate per directory. */
export const DIRECTORY_GLOBS = Object.keys(thresholds).filter((key) => !METRICS.includes(key));

/**
 * The headroom, in points, a scope must keep over its threshold.
 *
 * `.freebuff/coverage-headroom.mjs` fails `npm run test:coverage` when the
 * whole-tree aggregate clears its backstop by less than this, the ⚠ in
 * `.freebuff/coverage-report.mjs` marks the same margin on any row, and
 * `.freebuff/coverage-propose.mjs` proposes exactly the tightest integer that
 * still leaves it — `floor(measured - HEADROOM_TARGET)`. A margin under a point
 * is where a shared, churning checkout turns a neighbour's untested line into a
 * red build, so this is the line all three draw.
 */
export const HEADROOM_TARGET = 1;

/** A "+12.46" / "-0.32" style signed delta, or "—" when there is nothing to compare. */
export function signed(value) {
  if (value === undefined) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}`;
}

/** The value of a `--flag value` argument, or `undefined` when the flag is absent. */
export function argValue(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

/** `src/lib/**` -> `/^src\/lib\/.*$/`; `**` spans directories, `*` stays within one. */
export function globToRegExp(glob) {
  const pattern = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "\u0000")
    .replace(/\*/g, "[^/]*")
    .replace(/\u0000/g, ".*");
  return new RegExp(`^${pattern}$`);
}

/** The project-relative, forward-slashed path a glob is matched against. */
export function relativePath(file) {
  return relative(process.cwd(), file).replace(/\\/g, "/");
}

/**
 * The combined coverage of a set of files — the same aggregation Vitest applies
 * to a glob threshold, summed from raw counts rather than averaged from the
 * rounded per-file percentages.
 */
export function aggregate(entries) {
  const result = {};
  for (const metric of METRICS) {
    let covered = 0;
    let total = 0;
    for (const entry of entries) {
      const value = entry?.[metric];
      if (!value) continue;
      covered += value.covered ?? 0;
      total += value.total ?? 0;
    }
    result[metric] = { covered, total, pct: total === 0 ? 100 : (covered / total) * 100 };
  }
  return result;
}

/** Every measured file, project-relative, keyed for glob matching. */
export function filesOf(summary) {
  return Object.entries(summary)
    .filter(([file]) => file !== "total")
    .map(([file, metrics]) => ({ rel: relativePath(file), metrics }));
}

/**
 * The rows the report is built from: the whole tree, one aggregate per glob, and
 * the files no glob names (held only by the backstop).
 */
export function scopesOf(summary) {
  const files = filesOf(summary);
  const all = aggregate(files.map((file) => file.metrics));
  const rows = [
    {
      kind: "backstop",
      key: null,
      // The bare numbers are the whole-tree aggregate, so this comparison is
      // apples-to-apples: summary.total against the backstop.
      label: "all `src/**` *(whole-tree backstop)*",
      files: files.length,
      metrics: summary.total ? aggregate([summary.total]) : all,
      floors: BACKSTOP,
    },
  ];

  const matched = new Set();
  for (const glob of DIRECTORY_GLOBS) {
    const pattern = globToRegExp(glob);
    const inGroup = files.filter((file) => pattern.test(file.rel));
    for (const file of inGroup) matched.add(file.rel);
    rows.push({
      kind: "directory",
      key: glob,
      label: `\`${glob}\``,
      files: inGroup.length,
      metrics: aggregate(inGroup.map((file) => file.metrics)),
      floors: thresholds[glob],
    });
  }

  const unmatched = files.filter((file) => !matched.has(file.rel));
  if (unmatched.length > 0) {
    rows.push({
      kind: "unmatched",
      key: null,
      label: "no glob *(backstop only)*",
      files: unmatched.length,
      metrics: aggregate(unmatched.map((file) => file.metrics)),
      // The backstop is a whole-tree number, so it says little about these files
      // individually; shown without a headroom column rather than against it.
      floors: null,
    });
  }
  return rows;
}
