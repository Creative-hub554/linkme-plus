import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import thresholdsImport from "../../.freebuff/coverage-thresholds.mjs";
import * as floorRules from "../../.freebuff/coverage-floor-rules.mjs";
import * as scopesModule from "../../.freebuff/coverage-scopes.mjs";

/**
 * The coverage gates, pinned.
 *
 * Two files decide whether a coverage run is green —
 * `.freebuff/coverage-thresholds.mjs` (the per-directory aggregates Vitest
 * enforces) and `.freebuff/coverage-floor-rules.mjs` (the per-file floor
 * `.freebuff/coverage-floor.mjs` applies) — and nothing else in the suite would
 * notice if a number in either moved the wrong way. The report would simply
 * publish a larger headroom column, the headroom gate would keep passing, and
 * the floor script would report fewer breaches, because every reader of a
 * coverage report reads the *report* rather than these numbers. Lowering a gate
 * is therefore the quietest way to weaken this project's coverage — the same
 * hole `src/test/lint-baseline.test.ts` closes for the lint baseline, where a
 * finding nobody looks at is a rule that stopped counting.
 *
 * So this file records both sets of numbers and fails when any of them is
 * lowered. It is a **ratchet, not a snapshot**: raising a number is the intended
 * direction and needs no edit here, while lowering one fails until the value
 * recorded below is changed deliberately — the edit is the point, because it is
 * where the reason has to be written down.
 *
 * Three things beyond the numbers are pinned with them, because a gate can stop
 * gating without moving at all:
 *
 *   - the **scope and prefix names**, since a typo'd glob or directory (`src/hooks/*`,
 *     `src/utls/`) matches nothing and its number is then never checked;
 *   - the **exemption list**, since an exemption drops a file out of the extra
 *     floors and is a loosening even though no number moved;
 *   - the **wiring** — each rules module must still be the one its consumer
 *     imports — since a threshold or floor nobody reads gates nothing whatever
 *     it says.
 */

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));

/** The four coverage metrics, in the order the modules list them. */
const METRICS = ["lines", "statements", "branches", "functions"] as const;
type Metric = (typeof METRICS)[number];

/** The thresholds module's shape: bare numbers for the whole tree, one object per glob. */
type ThresholdsModule = Record<string, number | Record<string, number>>;

const thresholds = thresholdsImport as unknown as ThresholdsModule;

/**
 * The whole-tree backstop, as recorded when this pin was written. The bare keys
 * are a floor for the tree as a whole; `.freebuff/coverage-headroom.mjs` adds the
 * rule that the tree must clear them by a point.
 */
const BACKSTOP_FLOOR: Record<Metric, number> = {
  lines: 85,
  statements: 85,
  branches: 74,
  functions: 64,
};

/**
 * One floor per directory gate, keyed by the glob `vitest.config.ts` matches
 * with. Adding a scope to the module means adding it here too, on purpose.
 */
const SCOPE_FLOOR: Record<string, Record<Metric, number>> = {
  "src/lib/**": { lines: 92, statements: 92, branches: 86, functions: 67 },
  "src/hooks/**": { lines: 98, statements: 98, branches: 93, functions: 99 },
  "src/utils/**": { lines: 99, statements: 99, branches: 99, functions: 99 },
  "src/app/**": { lines: 83, statements: 83, branches: 70, functions: 68 },
  "src/components/**": { lines: 84, statements: 84, branches: 73, functions: 57 },
};

describe("the coverage thresholds", () => {
  it("keeps the whole-tree backstop on all four metrics", () => {
    for (const metric of METRICS) {
      expect(
        typeof thresholds[metric],
        `The whole-tree \`${metric}\` backstop must stay a bare number — a scope object ` +
          "here would leave the tree itself ungated.",
      ).toBe("number");
    }
  });

  it("names exactly the scopes recorded here, so a dropped or typed glob fails", () => {
    // A glob with a typo matches no file, and Vitest has nothing to check it
    // against, so the gate silently disappears. Naming the expected set is what
    // makes that visible.
    const found = Object.keys(thresholds)
      .filter((key) => !(METRICS as readonly string[]).includes(key))
      .sort();
    expect(
      found,
      "The scopes in `.freebuff/coverage-thresholds.mjs` changed. A new one is a new gate " +
        "(record it in SCOPE_FLOOR); a missing one is a gate that stopped existing — check the " +
        "glob, a typo matches nothing and gates nothing.",
    ).toEqual(Object.keys(SCOPE_FLOOR).sort());
  });

  it("has not been lowered anywhere", () => {
    const lowered: string[] = [];

    for (const metric of METRICS) {
      const now = thresholds[metric];
      if (typeof now === "number" && now < BACKSTOP_FLOOR[metric]) {
        lowered.push(`whole tree  ${metric}: ${BACKSTOP_FLOOR[metric]} → ${now}`);
      }
    }

    for (const [scope, floor] of Object.entries(SCOPE_FLOOR)) {
      const value = thresholds[scope];
      if (typeof value !== "object" || value === null) {
        lowered.push(`${scope}: the whole scope is gone`);
        continue;
      }
      for (const metric of METRICS) {
        const now = value[metric];
        if (typeof now !== "number") {
          lowered.push(`${scope}  ${metric}: missing`);
        } else if (now < floor[metric]) {
          lowered.push(`${scope}  ${metric}: ${floor[metric]} → ${now}`);
        }
      }
    }

    expect(
      lowered,
      `A coverage gate was lowered:\n${lowered.map((line) => `  ${line}`).join("\n")}\n` +
        "Raising a threshold is the ratchet tightening and needs no edit here. Lowering one is a " +
        "decision: change the recorded floor above deliberately, and say why in the commit.",
    ).toEqual([]);
  });

  it("is still the module vitest.config.ts enforces", () => {
    // A threshold nobody reads gates nothing. The config is read as source, the
    // way the lint baseline reads its config, so this cannot execute it.
    const config = readFileSync(path.join(projectRoot, "vitest.config.ts"), "utf8");
    expect(
      config,
      "vitest.config.ts must keep importing the thresholds from the module this test pins.",
    ).toContain('from "./.freebuff/coverage-thresholds.mjs"');
    expect(
      config,
      "vitest.config.ts must keep handing the imported thresholds to `coverage.thresholds`.",
    ).toMatch(/\n\s*thresholds,\n/);
  });

  it("keeps the reason the margin is a point", () => {
    // The same shape as the lint baseline's "the rule-off needs its written
    // reason": the module's comment is where a reader learns that the whole-tree
    // margin is owned by the headroom gate, and it is easy to delete in an edit
    // that only meant to change a number.
    const source = readFileSync(
      path.join(projectRoot, ".freebuff", "coverage-thresholds.mjs"),
      "utf8",
    );
    expect(
      source,
      "The thresholds module must still say that `.freebuff/coverage-headroom.mjs` owns the " +
        "whole-tree margin, or a reader has no way to know how tight the numbers already are.",
    ).toContain("coverage-headroom.mjs");
  });
});

/** The per-file floor rules' shape, as `coverage-floor.mjs` consumes them. */
type Floor = Record<string, number>;
interface DirectoryFloorRule {
  prefix: string;
  floors: Floor;
}
interface FloorRules {
  BASE_FLOOR: Floor;
  DIRECTORY_FLOORS: DirectoryFloorRule[];
  EXEMPTIONS: Map<string, string>;
}

const rules = floorRules as unknown as FloorRules;

/** The floor every file must clear, as recorded when this pin was written. */
const BASE_FLOOR_RECORDED: Floor = { lines: 52, statements: 52 };

/** The extra floors the pure-logic directories are held to, per file. */
const DIRECTORY_FLOOR_RECORDED: Record<string, Floor> = {
  "src/lib/": { branches: 59, functions: 60 },
  "src/utils/": { branches: 99, functions: 99 },
};

/**
 * Every exemption, with a phrase its reason must still contain. An exemption
 * takes a file out of the directory floors while leaving it on the base floor,
 * so it is a loosening — the per-file analogue of the lint baseline's
 * `DISABLE_ALLOWLIST`, and it can only grow by an edit here.
 */
const EXEMPTION_ALLOWLIST: { file: string; reason: string }[] = [
  { file: "src/lib/db/schema.ts", reason: "exercised as data at import time" },
];

describe("the per-file floor", () => {
  it("has not been lowered anywhere", () => {
    const lowered: string[] = [];

    for (const [metric, recorded] of Object.entries(BASE_FLOOR_RECORDED)) {
      const now = rules.BASE_FLOOR[metric];
      if (typeof now !== "number") {
        lowered.push(`base floor  ${metric}: missing`);
      } else if (now < recorded) {
        lowered.push(`base floor  ${metric}: ${recorded} → ${now}`);
      }
    }

    for (const [prefix, recordedFloors] of Object.entries(DIRECTORY_FLOOR_RECORDED)) {
      const live = rules.DIRECTORY_FLOORS.find((rule) => rule.prefix === prefix);
      if (!live) {
        lowered.push(`${prefix}: the whole directory floor is gone`);
        continue;
      }
      for (const [metric, recorded] of Object.entries(recordedFloors)) {
        const now = live.floors[metric];
        if (typeof now !== "number") {
          lowered.push(`${prefix}  ${metric}: missing`);
        } else if (now < recorded) {
          lowered.push(`${prefix}  ${metric}: ${recorded} → ${now}`);
        } else if (BASE_FLOOR_RECORDED[metric] !== undefined && now < BASE_FLOOR_RECORDED[metric]) {
          // A directory override *replaces* the base floor for its files, so one
          // below the base line lowers them even though it is not a decrease of
          // the directory's own recorded number.
          lowered.push(`${prefix}  ${metric}: ${now} is under the base floor ${BASE_FLOOR_RECORDED[metric]}`);
        }
      }
    }

    expect(
      lowered,
      `A per-file floor was lowered:\n${lowered.map((line) => `  ${line}`).join("\n")}\n` +
        "Raising a floor is the ratchet tightening and needs no edit here. Lowering one is a " +
        "decision: change the recorded value above deliberately, and say why in the commit.",
    ).toEqual([]);
  });

  it("names exactly the recorded directories", () => {
    expect(
      rules.DIRECTORY_FLOORS.map((rule) => rule.prefix).sort(),
      "The directories held above the base floor changed. A new one is a new gate (record it in " +
        "DIRECTORY_FLOOR_RECORDED); a missing one is a gate that stopped existing — check the " +
        "prefix, a typo matches no file and floors nothing.",
    ).toEqual(Object.keys(DIRECTORY_FLOOR_RECORDED).sort());
  });

  it("keeps the exemption list to the recorded files, each with its reason", () => {
    const files = [...rules.EXEMPTIONS.keys()].sort();
    expect(
      files,
      "The exemptions changed. Adding one takes a file out of the extra floors, so it is a " +
        "loosening and belongs in EXEMPTION_ALLOWLIST with the reason that justifies it; removing " +
        "one means the entry there is stale and should go.",
    ).toEqual(EXEMPTION_ALLOWLIST.map((entry) => entry.file).sort());

    const undocumented = EXEMPTION_ALLOWLIST.filter((entry) => {
      const reason = rules.EXEMPTIONS.get(entry.file) ?? "";
      return !reason.includes(entry.reason);
    });
    expect(
      undocumented,
      `An exemption no longer carries the reason recorded here:\n${undocumented
        .map((entry) => `  ${entry.file} — expected "${entry.reason}"`)
        .join("\n")}\nIf the reason changed, change it here too; if the exemption no longer needs ` +
        "one, delete both.",
    ).toEqual([]);
  });

  it("is still the rules module coverage-floor.mjs applies", () => {
    const source = readFileSync(
      path.join(projectRoot, ".freebuff", "coverage-floor.mjs"),
      "utf8",
    );
    expect(
      source,
      "coverage-floor.mjs must keep reading its numbers from the module this test pins.",
    ).toContain('from "./coverage-floor-rules.mjs"');
    for (const name of ["BASE_FLOOR", "DIRECTORY_FLOORS", "EXEMPTIONS"]) {
      expect(
        source,
        `coverage-floor.mjs must keep applying \`${name}\` from the rules module.`,
      ).toMatch(new RegExp(`\\b${name}\\b`));
    }
  });
});

/** The shared-scope module's shape, as the three coverage scripts consume it. */
interface ScopesModule {
  HEADROOM_TARGET: number;
}

const scopes = scopesModule as unknown as ScopesModule;

/** The headroom, in points, as recorded when this pin was written. */
const HEADROOM_TARGET_RECORDED = 1;

/**
 * The consumers of `HEADROOM_TARGET`, with the local declaration each would
 * carry if it stopped reading the shared constant. The pattern is what a
 * re-inlined literal looks like, and matching it is what the test below fails on:
 * the whole point of the shared constant is that the number cannot appear twice.
 */
const HEADROOM_CONSUMERS: { file: string; inlined: RegExp; reading: string }[] = [
  {
    file: ".freebuff/coverage-headroom.mjs",
    inlined: /const DEFAULT_MINIMUM\s*=\s*\d/,
    reading: "the whole-tree margin it fails on",
  },
  {
    file: ".freebuff/coverage-propose.mjs",
    inlined: /const DEFAULT_TARGET\s*=\s*\d/,
    reading: "the headroom its proposals must leave",
  },
  {
    file: ".freebuff/coverage-report.mjs",
    inlined: /headroom\s*<\s*\d/,
    reading: "the margin its \u26a0 marks",
  },
];

/**
 * The one-point headroom target, shared.
 *
 * `.freebuff/coverage-scopes.mjs` exports the margin a scope must keep over its
 * threshold; `.freebuff/coverage-headroom.mjs` fails a build under it, the
 * report's \u26a0 marks it, and `.freebuff/coverage-propose.mjs` proposes the tightest
 * integer that still leaves it. A literal copied into each file could drift
 * silently — a gate a point wide beside a proposer that assumes half a point
 * proposes a number the gate would reject — so this pins both halves of the
 * contract: the number itself, and that each consumer reads the export instead
 * of re-declaring it.
 */
describe("the headroom target", () => {
  it("is the shared one-point margin", () => {
    expect(
      scopes.HEADROOM_TARGET,
      "The shared headroom target changed. This is the one-point margin the whole-tree gate, " +
        "the report's \u26a0 and the proposer were all built around, so change " +
        "HEADROOM_TARGET_RECORDED above deliberately and say why in the commit.",
    ).toBe(HEADROOM_TARGET_RECORDED);
  });

  it("is read by the headroom gate, the proposer and the report, never re-declared", () => {
    // Read as source, the way the wiring tests above do, so this cannot run the
    // scripts. Two failures are possible per consumer and both matter: a missing
    // import means it stopped reading the shared constant, and a matched inline
    // pattern means it carries a second copy that can drift from it.
    const diverged: string[] = [];
    for (const { file, inlined, reading } of HEADROOM_CONSUMERS) {
      const source = readFileSync(path.join(projectRoot, file), "utf8");
      if (!/from\s+"\.\/coverage-scopes\.mjs"/.test(source)) {
        diverged.push(`${file}: no longer imports from ./coverage-scopes.mjs`);
      }
      if (!/\bHEADROOM_TARGET\b/.test(source)) {
        diverged.push(`${file}: does not read HEADROOM_TARGET for ${reading}`);
      }
      if (inlined.test(source)) {
        diverged.push(`${file}: declares its own literal for ${reading}`);
      }
    }
    expect(
      diverged,
      `The headroom target diverged from its single shared definition:\n${diverged
        .map((line) => `  ${line}`)
        .join("\n")}\n` +
        "The point of `HEADROOM_TARGET` in `.freebuff/coverage-scopes.mjs` is that the gate, " +
        "the report and the proposer cannot disagree about it. Import it; do not copy it.",
    ).toEqual([]);
  });
});
