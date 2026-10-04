#!/usr/bin/env node
/**
 * The sweep scaffold: one command onboards the next mutation sweep the way the fourth was
 * onboarded by hand — the vocabulary module words, the sweep file with its refusal payload,
 * the stage table entry, the runner's lambda with its `vocabularyFirst` pre-pass, the header's
 * numbered item, and the two generated lines — every copy the stage-order audit holds, brought
 * to the new count in one pass:
 *
 *     node .freebuff/scaffold-sweep.mjs --name=fifth [--tests]
 *
 * With `--tests` the run also drafts the suite extensions the onboarded stage needs: a
 * unified patch at `.freebuff/scaffold-tests-<name>.patch`, computed from the tree's own
 * table and the suites' current literals, every replacement an exact string with an
 * expected occurrence count that refuses on drift. Run alongside the onboarding it
 * replaces the checklist's "extend the suites" item; run against an already-onboarded
 * sweep it is the re-draft — and refuses once the extensions are actually applied.
 *
 * The fourth sweep is the template: the scaffold derives the new sweep from the tree's own
 * `mutation-example.mjs` by renaming what names the sweep, then *runs* the result before it
 * claims success — `node --check` on everything it touched, the tree's own runner answering
 * `--stages=check` green over the edited copies, and the generated sweep answering both of its
 * modes (`--vocabulary --json`, then the demonstration run) out of the tree it will live in.
 * A generated sweep that cannot run is a refused scaffold, and a refused scaffold leaves the
 * tree byte-exact: every edit is snapshotted before it is written and restored on any failure,
 * the way the tree-editing sweeps restore through their lock.
 *
 * What it deliberately does not do: apply a test edit (the suites are the reviewed holds —
 * even with `--tests` the extensions are *drafted* as a patch beside the tree, never written
 * into the files: the pre-pass wiring case, every selection-line count literal, the dry-run
 * arrays, the tail-zone claim, and the scratch e2e case's sweep name, each derived from the
 * tree rather than restated), and pin anything (the three edited pins go back through a
 * targeted `--write` after the suites are green; the new sweep file has no pin yet, which
 * the alarm is supposed to shout about until the operator records one).
 *
 * `SCAFFOLD_ROOT` points the scaffold at a throwaway copy — the seam the tests drive it
 * through, the way `CI_STAGE_ORDER_ROOT` points the stage-order audit and `GATE_HASHES_FILE`
 * points the alarm. Nothing but a test sets it; unset means this checkout.
 *
 * Exit codes: **0** the sweep is onboarded and verified (or, for an already-onboarded
 * sweep with `--tests`, the suite patch drafted), **1** a refusal or a failed verification
 * (the tree restored, the patch never written), **2** usage.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The tree being onboarded: the project, or a throwaway copy a test is driving. */
const ROOT = process.env.SCAFFOLD_ROOT
  ? resolve(process.env.SCAFFOLD_ROOT)
  : fileURLToPath(new URL("..", import.meta.url));
const FREEBUFF = join(ROOT, ".freebuff");

const STAGE_ORDER_HEADING = "## The stages, in order";
const NAME_PATTERN = /^[a-z][a-z0-9-]*$/;
/** The files the scaffold reads, edits or creates, all named once. */
const PATHS = {
  module: () => join(FREEBUFF, "mutation-vocabulary.mjs"),
  template: () => join(FREEBUFF, "mutation-example.mjs"),
  alarm: () => join(FREEBUFF, "gate-drift.mjs"),
  runner: () => join(FREEBUFF, "ci.mjs"),
  runbook: () => join(ROOT, ".freebuff/run.md"),
  sweep: (name) => join(FREEBUFF, `mutation-${name}.mjs`),
};

/** A refusal: the reason is the sentence the operator reads, and the tree is already restored. */
class Refusal extends Error {}

/** The snapshots an applied edit can be undone through: the bytes before, or `null` for new. */
const snapshots = new Map();
function snapshot(path) {
  if (!snapshots.has(path)) {
    snapshots.set(path, existsSync(path) ? readFileSync(path, "utf8") : null);
  }
  return snapshots.get(path);
}
/** Put every touched file back the way it was found, and take the created ones with it. */
function rollback() {
  for (const [path, before] of snapshots) {
    if (before === null) rmSync(path, { force: true });
    else writeFileSync(path, before, "utf8");
  }
  for (const temp of [".scaffold-lock.json", ".scaffold-cache.json"]) {
    rmSync(join(ROOT, temp), { force: true });
  }
}

/** The child environment every target-runner spawn shares: seams inside the tree, never caches. */
function runnerEnv() {
  return {
    ...process.env,
    CI_CACHE_FILE: join(ROOT, ".scaffold-cache.json"),
    MUTATION_LOCK_FILE: join(ROOT, ".scaffold-lock.json"),
  };
}

// --- reading the tree --------------------------------------------------------

/**
 * The stage names in the order the target tree's table declares them — read out of the file
 * rather than imported, because the file being edited is the declaration the edit re-derives
 * the order from. The element regex is the reader a human counting entries would use: an entry
 * starts at the array's own two-space indentation, whatever its shape inside.
 */
function declaredStageNames(alarmText) {
  const start = alarmText.indexOf("export const STAGE_TABLE = [");
  if (start === -1) throw new Refusal("the STAGE_TABLE declaration is gone from .freebuff/gate-drift.mjs");
  const rest = alarmText.slice(start);
  const close = /\n\];/.exec(rest);
  if (close === null) throw new Refusal("the STAGE_TABLE declaration never closes");
  const element = /^ {2}\{ *(?:\n {4}name: "([a-z-]+)",|name: "([a-z-]+)",)/gm;
  const names = [...rest.slice(0, close.index).matchAll(element)].map((match) => match[1] ?? match[2]);
  if (names.length === 0) throw new Refusal("the STAGE_TABLE declaration names no stage");
  return names;
}

/**
 * The position just past the block an anchor opens — the terminator the block closes with,
 * searched after the anchor. This is how an entry lands *beside* its model rather than inside
 * it: the table entry goes after the example entry's closing `},`, the lambda after the
 * example lambda's closing `}),`.
 */
function afterBlock(text, anchor, terminator) {
  const first = text.indexOf(anchor);
  if (first === -1) throw new Refusal(`the anchor is gone: ${JSON.stringify(anchor.slice(0, 60))}`);
  if (text.indexOf(anchor, first + 1) !== -1) throw new Refusal(`the anchor is not unique: ${JSON.stringify(anchor.slice(0, 60))}`);
  const close = text.indexOf(terminator, first);
  if (close === -1) throw new Refusal(`the block the anchor opens never closes: ${JSON.stringify(anchor.slice(0, 60))}`);
  return close + terminator.length;
}

// --- the plan: every new text is built before anything is written -------------

/** The module gains the sweep's own words, named for the sweep, after the fourth's. */
function planModule(moduleText, name, upper) {
  const addition = [
    "",
    "/**",
    ` * The ${name} sweep's words: the same two words every sweep speaks, named for the sweep`,
    " * that reads them. The scaffold declared this table beside the fourth's; the sweep's own",
    " * prose is the operator's to own.",
    " */",
    `export const ${upper}_SURVIVOR_WORDS = {`,
    `  survived: { mark: "SURVIVED", why: "the ${name} sweep's own bucket, spoken from the shared table" },`,
    '  broken: { mark: "UNCHECKED", why: "the demonstration refusal\'s own kind" },',
    "};",
    "",
  ].join("\n");
  return moduleText.replace(/\n*$/, "\n") + addition;
}

/**
 * The sweep is the tree's own fourth sweep with the sweep's names substituted — the template
 * lives in the tree, so the scaffold always generates the shape the tree already holds. Four
 * tokens carry every naming the template does; anything the template grows beyond them is a
 * refusal that names the line, never a silent mangling.
 */
function planSweep(templateText, name, upper) {
  const out = templateText
    .split("FOURTH_SURVIVOR_WORDS").join(`${upper}_SURVIVOR_WORDS`)
    .split("mutation-example.mjs").join(`mutation-${name}.mjs`)
    .split("mutation-example:").join(`mutation-${name}:`)
    .replace(/\bfourth\b/g, name);
  const leftover = [];
  out.split("\n").forEach((line, position) => {
    if (/fourth|example/i.test(line)) leftover.push(`  line ${position + 1}: ${line.trim()}`);
  });
  if (leftover.length > 0) {
    throw new Refusal(
      `the template sweep still names the fourth sweep where the scaffold does not substitute — update the scaffold's tokens:\n${leftover.join("\n")}`,
    );
  }
  return out;
}

/** The table gains the new entry beside the smoke stage it is shaped on. */
function planTableEntry(alarmText, name, upper, label) {
  const at = afterBlock(alarmText, '    name: "mutation-example",', "\n  },");
  const entry = [
    "  {",
    `    name: "mutation-${name}",`,
    `    label: "${label}",`,
    `    script: { env: "CI_${upper}_SCRIPT", path: "./mutation-${name}.mjs" },`,
    `    inputs: [".freebuff/mutation-${name}.mjs", ".freebuff/mutation-vocabulary.mjs"],`,
    "  },",
  ].join("\n");
  return alarmText.slice(0, at) + "\n" + entry + alarmText.slice(at);
}

/** The runner's run map gains the lambda, pre-pass riding, beside the one it is shaped on. */
function planLambda(runnerText, name) {
  const at = afterBlock(runnerText, '  "mutation-example": (stage) =>\n', "      }),");
  const lambda = [
    `  "mutation-${name}": (stage) =>`,
    "      runJsonGate({",
    `        name: "mutation-${name}",`,
    "        // The scaffold's smoke stage: the same read-only demonstration shape as the stage",
    "        // above, so the pre-pass rides every read-only vocabulary gate the table declares.",
    "        vocabularyFirst: true,",
    "        script: stage.script(),",
    "        extraArgs: () => [],",
    "        summarize(payload) {",
    "          const survivors = payload.survivors ?? [];",
    "          return {",
    '            pass: payload.gate === "pass",',
    "            summary:",
    "              (payload.gate === \"pass\"",
    '                ? `${payload.checked ?? 0} demonstration stamp(s) checked, no survivors`',
    '                : `${payload.checked ?? 0} checked, ${survivors.length} survivor(s)`),',
    "            details: survivors.map((item) => ({",
    '              mark: `SURVIVED (${item.kind})`,',
    '              name: item.line === null ? item.path : `${item.path}:${item.line}`,',
    '              detail: item.detail ? `${item.descriptor} — ${item.detail}` : item.descriptor,',
    "              location: { file: item.path },",
    "            })),",
    "          };",
    "        },",
    "      }),",
  ].join("\n");
  return runnerText.slice(0, at) + "\n" + lambda + runnerText.slice(at);
}

/**
 * The header's numbered enumeration gains the new item beside the smoke stage's, and every
 * item is renumbered to its position — the audit holds the numbers and the names to the table
 * both, so the renumber is the edit, not a nicety.
 */
function planHeaderEnumeration(runnerText, tableNames, name) {
  const lines = runnerText.split("\n");
  const headingAt = lines.findIndex((line) => line.includes(STAGE_ORDER_HEADING));
  if (headingAt === -1) throw new Refusal(`the header's stage heading is gone: ${STAGE_ORDER_HEADING}`);
  const nextHeadingAt = lines.findIndex((line, position) => position > headingAt && /^\s*\*\s+##\s/.test(line));
  const end = nextHeadingAt === -1 ? lines.length : nextHeadingAt;
  const itemPattern = /^\s*\*\s+\d+\.\s+`([a-z-]+)`/;
  const itemLines = [];
  for (let i = headingAt + 1; i < end; i++) {
    if (itemPattern.test(lines[i])) itemLines.push(i);
  }
  const enumerated = itemLines.map((i) => itemPattern.exec(lines[i])[1]);
  const differs = enumerated.findIndex((stage, position) => stage !== tableNames[position]);
  if (enumerated.length !== tableNames.length || differs !== -1) {
    throw new Refusal("the header's numbered enumeration and the stage table disagree — settle the stage order first");
  }
  const exampleItem = itemLines.find((i) => lines[i].includes("`mutation-example`"));
  if (exampleItem === undefined) {
    throw new Refusal("the header's enumeration names no mutation-example item to build beside");
  }
  const afterExample = itemLines.indexOf(exampleItem) + 1;
  const insertAt = afterExample < itemLines.length ? itemLines[afterExample] : end;
  const item = [
    " *  8. `mutation-" + name + "` — `mutation-" + name + ".mjs --json`. The vocabulary smoke stage the",
    " *     scaffold onboards: the same read-only demonstration shape as the stage above — its",
    " *     words declared in the shared module, its refusal a payload, its run report one",
    " *     demonstration stamp — with the same `vocabularyFirst` pre-pass, so a hole reds the",
    " *     gate before the run mode is ever spawned.",
  ];
  lines.splice(insertAt, 0, ...item);
  let position = 0;
  for (let i = headingAt + 1; i < end + item.length; i++) {
    if (!itemPattern.test(lines[i])) continue;
    position += 1;
    lines[i] = lines[i].replace(/^\s*\*\s+\d+\./, () => " * " + String(position).padStart(2, " ") + ".");
  }
  return lines.join("\n");
}

// --- the suite extensions, drafted rather than applied -----------------------

/**
 * Every suite edit the onboarded stage needs, as one rule: the file, a needle the edit is
 * built from, the replacement, the number of occurrences the needle is expected to have,
 * and a verifier the draft runs against the *edited* text — a replacement that leaves the
 * verifier false is refused, so a rule that matches but does not complete its edit is a
 * refusal, never a patch that reds three suites later. One rule to a case: the diff is what
 * the operator reviews, and a rule that does three things in one hunk is a rule nobody can
 * review.
 *
 * The counts are the guard, not decoration: the runner suite carries selection lines and
 * arrays that repeat the canonical order in several shapes, and a needle that matched twice
 * where one was expected would draft half the extension and leave the tree red in a way no
 * single case names.
 */
const NEXT_ORDINAL = {
  first: "second",
  second: "third",
  third: "fourth",
  fourth: "fifth",
  fifth: "sixth",
  sixth: "seventh",
  seventh: "eighth",
  eighth: "ninth",
  ninth: "tenth",
  tenth: "eleventh",
  eleventh: "twelfth",
  // The migrated wiring prose counts stages by cardinal — "exactly the four
  // vocabulary-first stages" — so the generic shift reads those too.
  three: "four",
  four: "five",
  five: "six",
  six: "seven",
  seven: "eight",
  eight: "nine",
  nine: "ten",
  ten: "eleven",
  eleven: "twelve",
};

/**
 * The wiring prose names its generation — "no fifth gate", "the four vocabulary-first
 * stages" — and each onboarding shifts the ordinal one step. The word after `marker` is
 * the ordinal; anything else is a prose shape this rule does not claim to read.
 */
function shiftOrdinal(line, marker) {
  const at = line.indexOf(marker);
  if (at === -1) return null;
  const wordStart = at + marker.length;
  const wordEnd = line.indexOf(" ", wordStart);
  if (wordEnd === -1) return null;
  const next = NEXT_ORDINAL[line.slice(wordStart, wordEnd)];
  if (!next) return null;
  return line.slice(0, wordStart) + next + line.slice(wordEnd);
}

function suiteRules({ name, tailZoneClaim, currentClaim, currentOrder, newOrder }) {
  const stageName = `mutation-${name}`;
  const target = `${name}case`;
  const movedNames = [];
  const QT = String.fromCharCode(34);
  const WIRING_COUNT_HEAD = 'expect(ciSource.split("vocabularyFirst: true").length - 1).toBe(';
  let wiringCount = null;
  return [
    // The pre-pass wiring case: the stage list grows and the carrier count follows. The
    // case's claims move together — the for-line list, the gate count in its comment, the
    // `toBe` that counts the flag occurrences, and the case title that restates them —
    // and each is read from the suite as it stands and shifted one generation, rather
    // than quoted from a generation's prose.
    {
      file: "src/test/ci-runner.test.ts",
      buildEdits(text) {
        const NL = String.fromCharCode(10);
        const edits = [];
        const listHead = 'for (const stageName of ["mutation-';
        const head = text.indexOf(listHead);
        if (head === -1) {
          throw new Refusal("the vocabulary pre-pass for-line moved — the wiring rule will not guess it");
        }
        const lineStart = text.lastIndexOf(NL, head) + 1;
        const lineEnd = text.indexOf(NL, head);
        const line = text.slice(lineStart, lineEnd);
        const listOpen = line.indexOf('["');
        const listClose = line.indexOf('"]) {');
        // Cells parse between the quotes, not by fixed offsets: slicing past `"[` and then
        // again past each cell's quote pair eats the first and last characters.
        const quote = '"';
        const firstQuote = line.indexOf(quote, listOpen);
        const lastQuote = line.lastIndexOf(quote, listClose);
        const cells = line
          .slice(firstQuote + 1, lastQuote)
          .split('", "');
        const listed = (cells.includes(stageName) ? cells : [...cells, stageName])
          .slice()
          .sort((a, b) => newOrder.indexOf(a) - newOrder.indexOf(b));
        const indent = line.slice(0, line.indexOf('for (const'));
        edits.push({
          find: line,
          replace: `${indent}for (const stageName of [${listed.map((cell) => quote + cell + quote).join(", ")}]) {`,
          count: 1,
        });
        const countAt = text.indexOf(WIRING_COUNT_HEAD);
        if (countAt === -1) {
          throw new Refusal("the vocabulary-first count assertion moved — the wiring rule will not guess it");
        }
        const digitsAt = countAt + WIRING_COUNT_HEAD.length;
        const digitsEnd = text.indexOf(");", digitsAt);
        wiringCount = Number(text.slice(digitsAt, digitsEnd));
        // The count needle keeps the line's own indentation, or the hunk rows lose it.
        const countLineStart = text.lastIndexOf(NL, countAt) + 1;
        const countLineEnd = text.indexOf(NL, digitsEnd) === -1 ? text.length : text.indexOf(NL, digitsEnd);
        const countLine = text.slice(countLineStart, countLineEnd);
        const countIndent = countLine.slice(0, countLine.indexOf("expect("));
        edits.push({
          find: countLine,
          replace: `${countIndent}${WIRING_COUNT_HEAD}${wiringCount + 1});`,
          count: 1,
        });
        const migrationFind = [
          "    // And no fourth gate is: exactly the three tree-editing stages carry the flag, so a flag",
          "    // copied onto a non-mutating stage reds here rather than spawning `--vocabulary` against a",
          "    // tool that has no such mode.",
        ].join(NL);
        const migrationReplace = [
          "    // And no fifth gate is: exactly the four vocabulary-first stages carry the flag, so a",
          "    // flag copied onto a stage that does not edit the tree or speak the vocabulary reds here",
          "    // rather than spawning `--vocabulary` against a tool that has no such mode.",
        ].join(NL);
        if (text.includes(migrationFind)) {
          edits.push({ find: migrationFind, replace: migrationReplace, count: 1 });
        } else {
          const commentAt = text.indexOf("gate is: exactly the ");
          if (commentAt === -1) {
            throw new Refusal("the wiring comment moved — the wiring rule will not guess it");
          }
          const commentStart = text.lastIndexOf(NL, commentAt) + 1;
          const commentEnd = text.indexOf(NL, commentAt);
          let comment = text.slice(commentStart, commentEnd);
          for (const marker of ["no ", "exactly the "]) {
            const shifted = shiftOrdinal(comment, marker);
            if (shifted === null) {
              throw new Refusal("the wiring comment's ordinals moved — the wiring rule will not guess them");
            }
            comment = shifted;
          }
          edits.push({ find: text.slice(commentStart, commentEnd), replace: comment, count: 1 });
        }
        const titleAt = text.indexOf('it("opts exactly the ');
        if (titleAt === -1) {
          throw new Refusal("the wiring case title moved — the wiring rule will not guess it");
        }
        const titleStart = text.lastIndexOf(NL, titleAt) + 1;
        const titleEnd = text.indexOf(NL, titleAt);
        let title = text.slice(titleStart, titleEnd);
        if (title.includes("tree-editing stages into the pre-pass")) {
          title = title.replace("three tree-editing stages into the pre-pass", "four vocabulary-first stages into the pre-pass");
        } else {
          const shifted = shiftOrdinal(title, "exactly the ");
          if (shifted === null) {
            throw new Refusal("the wiring title's ordinal moved — the wiring rule will not guess it");
          }
          title = shifted;
        }
        edits.push({ find: text.slice(titleStart, titleEnd), replace: title, count: 1 });
        return edits;
      },
      verify: (text) => {
        // The for-line is canonical now: the members ride the table's own order, so the
        // verify reads the line back and checks the new stage sits inside a canonically
        // ordered list — the same shape the stage-order audit demands of the tree.
        const NLv = String.fromCharCode(10);
        const head = text.indexOf('for (const stageName of ["mutation-');
        if (head === -1 || wiringCount === null) return false;
        const lineStart = text.lastIndexOf(NLv, head) + 1;
        const lineEnd = text.indexOf(NLv, head);
        const line = text.slice(lineStart, lineEnd);
        const listOpen = line.indexOf('["');
        const listClose = line.indexOf('"]) {');
        if (listOpen === -1 || listClose === -1) return false;
        const cells = line
          .slice(line.indexOf('"', listOpen) + 1, line.lastIndexOf('"', listClose))
          .split('", "');
        const indices = cells.map((cell) => newOrder.indexOf(cell));
        return (
          cells.includes(stageName) &&
          indices.every(
            (value, position) => value !== -1 && (position === 0 || indices[position - 1] < value),
          ) &&
          text.includes(`${WIRING_COUNT_HEAD}${wiringCount + 1});`) &&
          !text.includes("the three tree-editing stages into the pre-pass")
        );
      },
      describe: "the vocabulary pre-pass wiring case carries the new stage and the count follows",
    },

    // The tail-zone claim in the alarm's suite: the sentence is derived from the real table
    // (`editing.length` is unchanged — the new stage is read-only — but the tail list swaps
    // the example for the new stage), so the needle is the claim the *current* table derives
    // and the replacement the edited table derives — both derived, so the rule survives the
    // onboarding it drafts for. A generation whose new stage lands outside the tail zone
    // leaves the sentence standing: the rule then holds instead of editing.
    {
      file: "src/test/gate-drift.test.ts",
      buildEdits(text) {
        const find = `          "the lint stage edits the tree, so it has to be ${currentClaim}",`;
        if (!text.includes(find)) {
          throw new Refusal(
            "the tail-zone claim moved — the sentence the alarm derives is not the sentence the suite quotes",
          );
        }
        if (currentClaim === tailZoneClaim) return [];
        return [
          {
            find,
            replace: `          "the lint stage edits the tree, so it has to be ${tailZoneClaim}",`,
            count: 1,
          },
        ];
      },
      verify: (text) => text.includes(`has to be ${tailZoneClaim}`),
      describe: "the tail-zone claim names the tail the edited table actually produces",
    },

    // The scratch e2e cases: once a sweep is onboarded for real, a case named after it on
    // the scratch tree hits the scaffold's own once-only refusal, so the cases move to a
    // fresh name — the onboarding name with `case` on it, which no onboarding ever uses.
    // The names are read from the suite rather than assumed, so the rule survives the
    // generation it drafts for, and every token naming the old sweep moves with it.
    {
      file: "src/test/gate-drift.test.ts",
      buildEdits(text) {
        const NL = String.fromCharCode(10);
        const marker = 'scaffold(root, ["--name=';
        // Identical needles recur across the two scratch cases (both scaffold calls, the
        // sweep path), so edits merge by needle: a second hit with the same replacement
        // bumps the occurrence count instead of queuing a duplicate hunk.
        const edits = [];
        const pushEdit = (find, replace, count) => {
          const existing = edits.find((edit) => edit.find === find);
          if (existing === undefined) {
            edits.push({ find, replace, count });
            return;
          }
          if (existing.replace !== replace) {
            throw new Refusal(`the e2e rule drafted two different replacements for ${JSON.stringify(find.slice(0, 60))}`);
          }
          existing.count += count;
        };
        let at = text.indexOf(marker);
        while (at !== -1) {
          const nameStart = at + marker.length;
          const quoteAt = text.indexOf(QT, nameStart);
          if (quoteAt === -1) break;
          const oldName = text.slice(nameStart, quoteAt);
          const after = text.slice(quoteAt + 1, quoteAt + 61);
          const onboarding = after.startsWith(', "--json"]);' + NL + NL + "    expect(status).toBe(0);");
          const drifted = after.startsWith(', "--json"]);' + NL + NL + "    expect(status).toBe(1);");
          if ((onboarding || drifted) && oldName !== target) {
            if (!movedNames.includes(oldName)) movedNames.push(oldName);
            const callFind = `scaffold(root, ["--name=${oldName}", "--json"])`;
            pushEdit(callFind, `scaffold(root, ["--name=${target}", "--json"])`, text.split(callFind).length - 1);
            if (onboarding) {
              pushEdit(
                `expect(report.name).toBe("mutation-${oldName}");`,
                `expect(report.name).toBe("mutation-${target}");`,
                1,
              );
              const stagesNeedle = `expect(report.stages).toBe(${currentOrder.length + 1});`;
              if (!text.includes(stagesNeedle)) {
                throw new Refusal("the e2e case's stage count moved — the e2e rule will not guess it");
              }
              pushEdit(stagesNeedle, `expect(report.stages).toBe(${newOrder.length + 1});`, 1);
            } else {
              pushEdit(
                `"${oldName.toUpperCase()}_SURVIVOR_WORDS"`,
                `"${target.toUpperCase()}_SURVIVOR_WORDS"`,
                1,
              );
            }
          }
          at = text.indexOf(marker, quoteAt + 1);
        }
        if (edits.length === 0) {
          throw new Refusal("the scaffold e2e cases already carry the fresh name — nothing to move");
        }
        // The sweep-file path is shared by both cases; one merged edit moves every occurrence.
        for (const oldName of movedNames) {
          const pathFind = `"mutation-${oldName}.mjs"`;
          pushEdit(pathFind, `"mutation-${target}.mjs"`, text.split(pathFind).length - 1);
        }
        return edits;
      },
      verify: (text) =>
        movedNames.every((oldName) => !text.includes(`"--name=${oldName}"`)) &&
        text.includes(`scaffold(root, ["--name=${target}", "--json"])`),
      describe: "the scaffold e2e cases draft with a fresh sweep name, so they still run after onboarding",
    },

  ];
}

function countRules({ currentOrder, newOrder }) {
  // Every multi-line toEqual([ block in the runner suite whose items are a subsequence of
  // the canonical order is a stage-array claim: the dry-run array (the full order), the
  // skip and compose arrays (the order without a stage or two), and the declared-scripts
  // array (the script-backed stages). The drafted text is the same subsequence taken over
  // the new order, so each claim moves with the table instead of being re-derived by
  // shape. Single-line toContain literals are deliberately untouched: they are
  // substring-safe by construction at either count, and the not-run lines are held by
  // their own rule. The pattern is composed rather than written as a literal so its
  // escapes cannot be mangled in transit; NL and BS are its only escape-bearing pieces.
  const NL = String.fromCharCode(10);
  const BS = String.fromCharCode(92);
  const isSubsequence = (small, big) => {
    let at = 0;
    for (const item of small) {
      at = big.indexOf(item, at);
      if (at === -1) return false;
      at += 1;
    }
    return true;
  };
  let renderedClaims = 0;
  const blockPattern = new RegExp(
    [
      "toEqual",
      BS + "(",
      BS + "[",
      BS + "n",
      '((?: {6}"[a-z-]+",',
      BS + "n",
      ")+) {4}",
      BS + "]",
      BS + ");",
    ].join(""),
    "g",
  );
  return [
    {
      file: "src/test/ci-runner.test.ts",
      buildEdits(text) {
        const edits = [];
        let sawFullOrder = false;
        const stageName = newOrder[newOrder.indexOf("mutation-example") + 1];
        // The block that anchors this rule is the one claiming the whole order — the whole
        // order *as the suite shows it before the extension lands*. On the extend path that
        // is currentOrder itself; on the draft-only path the table already carries the new
        // stage, so the un-extended suite's full claim is currentOrder minus the stage that
        // is not in the arrays yet. Anchoring there is what lets a re-draft find the
        // dry-run case at all instead of refusing on a claim it just moved.
        const expectedFull = currentOrder.filter((stage) => stage !== stageName);
        for (const match of text.matchAll(blockPattern)) {
          const items = match[1]
            .split(NL)
            .filter((row) => row.trim() !== "")
            .map((row) => {
              // Index-based, not regex-based: the cell is exactly six spaces, a double
              // quote, the stage name, a double quote, a comma — so the name is the
              // slice between the quotes, and anything else is a cell this rule does
              // not claim to read.
              const cell = row.trim();
              if (cell.length < 4 || cell[0] !== '"' || cell[cell.length - 2] !== '"' || cell[cell.length - 1] !== ',') {
                throw new Refusal(
                  "a stage-array cell is not the shape this rule parses: " + JSON.stringify(row.slice(0, 40)),
                );
              }
              return cell.slice(1, -2);
            });
          if (items.length < 2 || !isSubsequence(items, currentOrder)) continue;
          if (items.join(",") === expectedFull.join(",") || items.join(",") === currentOrder.join(",")) {
            if (sawFullOrder) {
              throw new Refusal("two stage-array blocks both claim the full canonical order — settle the suite first");
            }
            sawFullOrder = true;
          }
          // A block that already carries the new stage is already extended: re-inserting
          // would duplicate it, so the block is left as it stands rather than rewritten.
          if (items.includes(stageName)) continue;
          // The new text is the same claim over the new order: every item kept, and the
          // new stage inserted right after the example it was onboarded beside.
          const rebuilt = [];
          for (const item of items) {
            rebuilt.push('      "' + item + '",');
            if (item === "mutation-example") {
              rebuilt.push('      "' + stageName + '",');
            }
          }
          const replacement = "toEqual([" + NL + rebuilt.join(NL) + NL + "    ]);";
          if (replacement !== match[0]) {
            // The match starts mid-line (`toEqual(` follows the `expect(...)` prefix) and
            // ends mid-line, so the edit is widened to whole lines: the prefix and suffix
            // of the fragment's first and last lines join both sides, and the rendered
            // hunk's pre-image lines are the file's own lines, byte for byte.
            const lineStart = text.lastIndexOf(NL, match.index) + 1;
            const matchEnd = match.index + match[0].length;
            const lineEnd = text.indexOf(NL, matchEnd) === -1 ? text.length : text.indexOf(NL, matchEnd);
            const firstLinePrefix = text.slice(lineStart, match.index);
            const lastLineSuffix = text.slice(matchEnd, lineEnd);
            edits.push({
              find: firstLinePrefix + match[0] + lastLineSuffix,
              replace: firstLinePrefix + replacement + lastLineSuffix,
              count: 1,
            });
          }
        }
        if (!sawFullOrder) {
          throw new Refusal(
            "no stage-array block claims the full canonical order — the dry-run JSON case is missing or has moved",
          );
        }
        if (edits.length < 3) {
          throw new Refusal(
            "only " + edits.length + " stage-array block(s) need the new order — the suite's array claims have moved; pair them by hand",
          );
        }
        return edits;
      },
      verify: (text) => {
        const stageName = newOrder[newOrder.indexOf("mutation-example") + 1];
        const needle = [
          '      "test",',
          '      "preflight",',
          '      "drift",',
          '      "mutation-example",',
          '      "' + stageName + '",',
        ].join(NL);
        return (
          text.split(needle).length - 1 === 1 &&
          text.split('      "mutation-example",' + NL + '      "mutation-coverage",').length - 1 === 0
        );
      },
      describe: "the stage-array claims carry the new order (dry-run, skip, compose, declared)",
    },
    // The rendered stage-list claims: single-line strings and the one single-line array
    // that name a run of stages across the seam where the new stage lands — right after
    // whatever currently follows the example (banners, `have:` errors, resume tails, the
    // JSON stages array, the dry-run stage count). Every such claim gains the stage at
    // the seam, and any `N stage(s)` count in the same string follows the list. Lists
    // that stop before the seam or start after it (explicit `--only` selections,
    // changed-only runs that skip the example) do not change and are deliberately not
    // claimed; the changed-only not-run lines are the not-run rule's own claim.
    {
      file: "src/test/ci-runner.test.ts",
      buildEdits(text) {
        const stageName = newOrder[newOrder.indexOf("mutation-example") + 1];
        const follower = currentOrder[currentOrder.indexOf("mutation-example") + 1];
        const boundary = "mutation-example, " + follower;
        const insertion = "mutation-example, " + stageName + ", " + follower;
        const arrayBoundary = '"mutation-example", "' + follower + '"';
        const arrayInsertion = '"mutation-example", "' + stageName + '", "' + follower + '"';
        const lengthNeedle = "toHaveLength(" + currentOrder.length + ")";
        const edits = [];
        const stringPattern = new RegExp('"' + '[^"' + BS + "n]*" + boundary + '[^"' + BS + 'n]*"', "g");
        for (const match of text.matchAll(stringPattern)) {
          const lineStart = text.lastIndexOf(NL, match.index) + 1;
          const lineEndAt = text.indexOf(NL, match.index);
          const line = text.slice(lineStart, lineEndAt === -1 ? text.length : lineEndAt);
          if (line.includes("not run (nothing they read changed): ")) continue;
          const literal = match[0];
          if (literal.includes(stageName)) continue;
          renderedClaims += 1;
          let inner = literal.slice(1, -1).split(boundary).join(insertion);
          const counted = inner.match(new RegExp("^(.*?)(" + BS + "d+)( stage" + BS + "(s" + BS + "): )"));
          if (counted) {
            inner = counted[1] + (Number(counted[2]) + 1) + counted[3] + inner.slice(counted[0].length);
          }
          const edit = { find: literal, replace: '"' + inner + '"', count: text.split(literal).length - 1 };
          if (!edits.some((existing) => existing.find === edit.find)) edits.push(edit);
        }
        // The single-line array claims the seam with the stage BEFORE the example named
        // beside it: the wiring for-line rides the canonical order too, so an unanchored
        // seam needle would match it as well — and the wiring line is the wiring rule's
        // own claim. Two needles on one line is exactly the overlap the renderer refuses.
        const beforeExample = currentOrder[currentOrder.indexOf("mutation-example") - 1];
        const arrayFind =
          beforeExample === undefined
            ? arrayBoundary
            : '"' + beforeExample + '", "mutation-example", "' + follower + '"';
        const arrayReplace =
          beforeExample === undefined
            ? arrayInsertion
            : '"' + beforeExample + '", "mutation-example", "' + stageName + '", "' + follower + '"';
        const arrayCount = text.split(arrayFind).length - 1;
        if (arrayCount > 0) {
          edits.push({ find: arrayFind, replace: arrayReplace, count: arrayCount });
        }
        const lengthCount = text.split(lengthNeedle).length - 1;
        if (lengthCount !== 1) {
          throw new Refusal(
            "the dry-run stage-count assertion (" + lengthNeedle + ") found " + lengthCount + " time(s) — pair the count by hand",
          );
        }
        edits.push({ find: lengthNeedle, replace: "toHaveLength(" + newOrder.length + ")", count: 1 });
        if (edits.length < 3) {
          throw new Refusal(
            "the rendered stage-list claims have moved — " + renderedClaims + " seam string(s) found; pair them by hand",
          );
        }
        return edits;
      },
      verify: (text) => {
        const stageName = newOrder[newOrder.indexOf("mutation-example") + 1];
        const follower = currentOrder[currentOrder.indexOf("mutation-example") + 1];
        // The not-run lines carry the raw seam too, but they are the not-run rule's own
        // claim; this rule is verified per-rule on its own edited text, so those lines
        // are out of its scope here.
        const claimLines = text
          .split(NL)
          .filter(
            (line) =>
              !line.includes("not run (nothing they read changed): ") &&
              !line.includes('for (const stageName of ["mutation-'),
          );
        return (
          renderedClaims > 0 &&
          claimLines.every((line) => !line.includes("mutation-example, " + follower)) &&
          claimLines.every((line) => !line.includes('"mutation-example", "' + follower + '"')) &&
          claimLines.some((line) => line.includes("mutation-example, " + stageName + ", " + follower)) &&
          text.includes("toHaveLength(" + newOrder.length + ")")
        );
      },
      describe: "the rendered stage-list claims carry the new order (banners, errors, tails, counts)",
    },
  ];
}

function runStep(command, args) {
  const result = spawnSync(command, args, { cwd: ROOT, encoding: "utf8", env: runnerEnv() });
  if (result.error) throw new Refusal(`the scaffold could not spawn ${command}: ${result.error.message}`);
  return result;
}

function parseJson(result) {
  try {
    return JSON.parse(result.stdout ?? "");
  } catch {
    return null;
  }
}

/** The tree's own runner, auditing the stage order over the tree as it now stands. */
function stageOrderCheck() {
  const result = runStep(process.execPath, [PATHS.runner(), "--stages=check", "--json", "--no-cache"]);
  return { status: result.status, report: parseJson(result) };
}

function requireAuditGreen(when) {
  const { status, report } = stageOrderCheck();
  if (status !== 0 || report?.gate !== "pass") {
    const findings = (report?.findings ?? []).map((f) => `  ${f.kind}: ${f.detail}`).join("\n");
    throw new Refusal(`the stage order ${when} is red — settle it first:\n${findings || "(the audit could not answer)"}`);
  }
}

function requireParseable(path) {
  const result = runStep(process.execPath, ["--check", path]);
  if (result.status !== 0) {
    throw new Refusal(`${path} does not parse after the scaffold's edits:\n${result.stderr}`);
  }
}

// --- the suite patch: capture, derive, verify, render ------------------------

/** The patch file's path for a sweep name. */
function patchPath(name) {
  return join(FREEBUFF, `scaffold-tests-${name}.patch`);
}

/**
 * The stage names the alarm's `editsTree` rule reads — the group of tree editors — read
 * from the declarations the way the alarm itself reads them: an entry, then whether its
 * body carries `editsTree`.
 */
function suiteRulesEditingNames(alarmText) {
  const names = declaredStageNames(alarmText);
  const editors = [];
  for (const name of names) {
    const entryStart = alarmText.indexOf(`    name: "${name}",`);
    if (entryStart === -1) continue;
    const entryEnd = alarmText.indexOf("\n  },", entryStart);
    if (entryEnd === -1) continue;
    if (/\beditsTree:/.test(alarmText.slice(entryStart, entryEnd)) && !editors.includes(name)) {
      editors.push(name);
    }
  }
  return editors;
}

/**
 * The tail-zone sentence the alarm's own suite should claim after the stage lands, derived
 * the way the alarm derives it — which means derived in the case that holds the claim. That
 * case bends lint into a tree editor (`bent("lint", { editsTree: ... })`), so the editor
 * count the suite sees is the real editors plus the bend, and the tail is the last that
 * many slots of the *new* order: the example drops out positionally and the new stage
 * joins it.
 */
function deriveTailZoneClaim(alarmText, newOrder) {
  const realEditors = suiteRulesEditingNames(alarmText);
  const editors = realEditors.includes("lint") ? realEditors : [...realEditors, "lint"];
  const tail = newOrder.slice(newOrder.length - editors.length);
  return `one of the last ${editors.length} (${tail.join(", ")})`;
}

/**
 * The not-run lines the changed-only cases hold, captured from the real runner on the tree
 * as it stands — before any edit — so the draft carries the output the suite actually
 * asserts against, truncation and all. A fixture whose line cannot be captured is a
 * refusal: a rule quoting a captured line is better red here than drafted from a guess.
 */
function captureNotRunLines() {
  const fixtures = ["src/lib/foo.ts", ".freebuff/coverage-floor.mjs", ".freebuff/mutation-preflight.mjs"];
  const captured = [];
  for (const fixture of fixtures) {
    const result = spawnSync(process.execPath, [PATHS.runner(), "--changed-only", "--dry-run"], {
      cwd: ROOT,
      encoding: "utf8",
      env: {
        ...process.env,
        CI_CACHE_FILE: join(ROOT, ".scaffold-cache.json"),
        CI_CHANGED_FILES: fixture,
      },
    });
    const line = (result.stdout ?? "")
      .split("\n")
      .find((row) => row.startsWith("ci: not run (nothing they read changed):"));
    if (line === undefined) {
      throw new Refusal(
        `the suite patch could not capture the not-run line for ${fixture} from the tree's own runner — settle the runner first`,
      );
    }
    captured.push({ fixture, line });
  }
  return captured;
}

/**
 * The changed-only not-run rules: one edit per captured line. The needle is the *suite's*
 * current assertion — found in its own text, so a fixture's deliberately truncated prefix
 * is carried over rather than silently repaired — and the captured runner output is the
 * authority the result is held against: the drafted list must be a subsequence of what the
 * tree's own runner actually prints. The zip is positional; the capture's fixture order
 * mirrors the suite's case order, and a count that disagrees is a refusal to pair.
 */
function notRunRules({ captured, name, suiteText }) {
  const stageName = `mutation-${name}`;
  const assertions = [
    ...suiteText.matchAll(/^ {6}"not run \(nothing they read changed\): ([^"]*)",$/gm),
  ].map((match) => match[0]);
  if (assertions.length !== captured.length) {
    throw new Refusal(
      `the suite patch found ${assertions.length} not-run assertion(s) in src/test/ci-runner.test.ts for ${captured.length} captured fixture(s) — pair them by hand instead of letting the draft guess`,
    );
  }
  const isSubsequence = (small, big) => {
    let at = 0;
    for (const item of small) {
      at = big.indexOf(item, at);
      if (at === -1) return false;
      at += 1;
    }
    return true;
  };
  return [
    {
      file: "src/test/ci-runner.test.ts",
      edits: assertions.map((line, index) => {
        const { fixture, line: capturedLine } = captured[index];
        const claim = line.replace(/^ {6}"|",$/g, "");
        const list = claim.replace(/^not run \(nothing they read changed\): /, "").split(", ");
        if (list.includes(stageName)) {
          throw new Refusal(
            `the not-run assertion for ${fixture} already carries ${stageName} — the extension is applied, and the draft refuses rather than duplicate it`,
          );
        }
        const at = list.indexOf("mutation-example");
        if (at === -1) {
          throw new Refusal(
            `the not-run assertion for ${fixture} does not name mutation-example — the draft will not guess where the new stage lands`,
          );
        }
        const newList = [...list.slice(0, at + 1), stageName, ...list.slice(at + 1)];
        const runnerList = capturedLine
          .replace("ci: not run (nothing they read changed): ", "")
          .split(", ");
        if (!isSubsequence(newList, runnerList)) {
          throw new Refusal(
            `the drafted not-run line for ${fixture} does not agree with the tree's own runner output (${capturedLine.slice(0, 90)}…) — settle the runner first`,
          );
        }
        return {
          find: line,
          replace: `      "not run (nothing they read changed): ${newList.join(", ")}",`,
          count: 1,
        };
      }),
      verify: (text) => {
        const prefix = '      "not run (nothing they read changed): ';
        const lines = text.split(String.fromCharCode(10)).filter((line) => line.startsWith(prefix));
        return (
          lines.length === captured.length &&
          lines.every((line) => line.includes(`mutation-example, ${stageName}`))
        );
      },
      describe: "the changed-only not-run lines carry the new stage beside the example",
    },
  ];
}

/**
 * A unified diff of one file's drafted edits: repo-relative header paths with the `a/ b/`
 * prefixes `git apply` reads. Each edit contributes the rows its own change needs — the
 * edit's ±3-line window is diffed line by line, so a multi-line replacement shows its
 * removed lines as `-` and its added lines as `+` — and edits whose context windows
 * would touch share one hunk, since an interior hunk that ends on a bare `+` row has
 * no trailing context to anchor it and `git apply` refuses it. The result is a
 * handful of tight, local hunks, one per concern.
 */
function renderFilePatch(relFile, before, edits) {
  const NLc = String.fromCharCode(10);
  // A file that ends with a newline has no phantom last line; splitting the bytes as
  // they stand would invent one, and a context row over it could never match.
  const ends = before.endsWith(NLc);
  const a = (ends ? before.slice(0, before.length - 1) : before).split(NLc);
  const lines = [`--- a/${relFile}`, `+++ b/${relFile}`];
  let prevEnd = 0;
  let deltaSoFar = 0;
  let emitted = false;
  const context = 3;
  // Hunks are emitted in source order, one per cluster of edits: occurrences whose
  // context windows would touch share a hunk, the way git merges nearby changes — an
  // interior hunk that ends on a bare `+` row has no trailing context to anchor it,
  // and `git apply` refuses it. Edits may not overlap: two needles claiming one line
  // is a rule bug, refused rather than garbled into the byte stream.
  const located = edits.flatMap((edit) => {
    const found = [];
    let at = before.indexOf(edit.find);
    while (at !== -1) {
      found.push({ edit, at, startLine: before.slice(0, at).split(NLc).length - 1 });
      at = before.indexOf(edit.find, at + edit.find.length);
    }
    if (found.length === 0) {
      throw new Refusal(
        `the patch renderer lost an edit it had just applied in ${relFile} — refusing rather than guess the hunk`,
      );
    }
    return found;
  });
  located.sort((x, y) => x.startLine - y.startLine);
  // find/replace needles may be substrings of their first/last lines; a diff row is the
  // WHOLE line, so each located edit is widened to line boundaries. The replacement
  // keeps what the widening picked up: the lead before the raw find on its first line
  // and whatever followed the raw find on its last line.
  for (const found of located) {
    const headStart = before.lastIndexOf(NLc, found.at) + 1;
    const tailCharAt = found.at + found.edit.find.length - 1;
    const tailEnd = before.indexOf(NLc, tailCharAt);
    const widenedFind = before.slice(headStart, tailEnd === -1 ? before.length : tailEnd);
    const rawFindLines = found.edit.find.split(NLc);
    const rawReplaceLines = found.edit.replace.split(NLc);
    const widenedFindLines = widenedFind.split(NLc);
    const lead = widenedFindLines[0].slice(0, widenedFindLines[0].indexOf(rawFindLines[0]));
    const rest1 = widenedFindLines[0].slice(lead.length + rawFindLines[0].length);
    const lastWide = widenedFindLines[widenedFindLines.length - 1];
    const rawLast = rawFindLines[rawFindLines.length - 1];
    const rest2 = rawFindLines.length === 1 ? "" : lastWide.slice(lastWide.lastIndexOf(rawLast) + rawLast.length);
    const out = [];
    if (rawReplaceLines.length === 1) {
      out.push(lead + rawReplaceLines[0] + rest1 + rest2);
    } else {
      out.push(lead + rawReplaceLines[0] + rest1);
      for (let m = 1; m < rawReplaceLines.length - 1; m++) out.push(rawReplaceLines[m]);
      out.push(rawReplaceLines[rawReplaceLines.length - 1] + rest2);
    }
    found.edit = { ...found.edit, find: widenedFind, replace: out.join(NLc) };
  }
  for (let x = 1; x < located.length; x++) {
    const prevEndLine = located[x - 1].startLine + located[x - 1].edit.find.split(NLc).length;
    if (located[x].startLine < prevEndLine) {
      throw new Refusal(
        `two drafted edits in ${relFile} overlap inside one replaced region — the renderer refuses rather than merge their hunks blind`,
      );
    }
  }
  // A new cluster starts only when both full context windows would fit between the
  // edits (2*context unchanged lines or more); closer than that, the edit joins the
  // cluster it would have shared context with, and one hunk carries them together.
  const clusters = [];
  for (const occ of located) {
    const endLine = occ.startLine + occ.edit.find.split(NLc).length;
    const last = clusters[clusters.length - 1];
    if (last !== undefined && occ.startLine - last.end < 2 * context) {
      last.end = endLine;
      last.occurrences.push(occ);
    } else {
      clusters.push({ start: occ.startLine, end: endLine, occurrences: [occ] });
    }
  }
  for (const cluster of clusters) {
    const from = Math.max(prevEnd, cluster.start - context);
    const toA = Math.min(a.length, cluster.end + context);
    const rows = [];
    let position = from;
    for (const { edit, startLine } of cluster.occurrences) {
      for (let i = position; i < startLine; i++) rows.push([" ", a[i]]);
      for (const row of edit.find.split(NLc)) rows.push(["-", row]);
      for (const row of edit.replace.split(NLc)) rows.push(["+", row]);
      position = startLine + edit.find.split(NLc).length;
    }
    for (let i = position; i < toA; i++) rows.push([" ", a[i]]);
    const oldCount = rows.filter(([m]) => m !== "+").length;
    const newCount = rows.filter(([m]) => m !== "-").length;
    if (oldCount === 0 && newCount === 0) continue;
    // The new side starts where the old side does, moved by the net delta of every
    // preceding hunk.
    lines.push(`@@ -${from + 1},${oldCount} +${from + 1 + deltaSoFar},${newCount} @@`);
    for (const [mark, row] of rows) lines.push(mark + row);
    let added = 0;
    let removed = 0;
    for (const [mark] of rows) {
      if (mark === "+") added += 1;
      else if (mark === "-") removed += 1;
    }
    deltaSoFar += added - removed;
    // The next cluster starts a full context window later, so its leading context
    // begins exactly where this trailing context ends: no old line is emitted twice.
    prevEnd = toA;
    emitted = true;
  }
  if (!emitted) return "";
  return lines.join(NLc) + NLc;
}
function draftSuitePatch({ currentOrder, newOrder, name, tailZoneClaim, currentClaim }) {
  const captured = captureNotRunLines();
  const suiteText = readFileSync(join(ROOT, "src/test/ci-runner.test.ts"), "utf8");
  // The order the un-extended suites show: on a full run the table has not grown yet,
  // so this is currentOrder itself; on the draft-only path the table already carries
  // the stage, and the suites still show the order without it. Every needle read from
  // the suites is built over this order; every replacement over newOrder.
  const suiteOrder = currentOrder.filter((stage) => stage !== `mutation-${name}`);
  const rules = [
    ...suiteRules({ name, tailZoneClaim, currentClaim, currentOrder: suiteOrder, newOrder }),
    ...countRules({ currentOrder: suiteOrder, newOrder }),
    ...notRunRules({ captured, name, suiteText }),
  ];
  const byFile = new Map();
  const descriptions = [];
  for (const rule of rules) {
    const relFile = rule.file;
    if (!byFile.has(relFile)) {
      byFile.set(relFile, { original: readFileSync(join(ROOT, relFile), "utf8"), edits: [] });
    }
    const entry = byFile.get(relFile);
    const before = entry.original;
    const edits = rule.buildEdits
      ? rule.buildEdits(before)
      : rule.edits;
    // A rule may legitimately hold without editing — the tail-zone sentence at a
    // generation whose stage lands outside the tail zone says the same thing before and
    // after. An empty edit list backed by a passing verify is a hold, not a miss; an
    // empty list the rule cannot verify is still the changes-nothing refusal below.
    if (edits.length === 0 && rule.verify(before)) {
      descriptions.push(`${relFile}: ${rule.describe}`);
      continue;
    }
    const after = edits.reduce(
      (text, edit) => text.split(edit.find).join(edit.replace),
      before,
    );
    entry.edits.push(...edits);
    if (!rule.verify(after)) {
      throw new Refusal(
        `the suite patch's "${rule.describe}" edit did not leave the file in the state the rule verifies — the draft refuses rather than write a patch that reds the suites`,
      );
    }
    if (after === before) {
      throw new Refusal(
        `the suite patch's "${rule.describe}" edit changes nothing — the rule no longer names a live edit`,
      );
    }
    descriptions.push(`${relFile}: ${rule.describe}`);
  }
  // The patch is rendered per file from the file's original bytes and the edits the rules
  // contributed, so each hunk is local to the concern that produced it.
  const patch = [...byFile.entries()]
    .map(([file, entry]) => renderFilePatch(file, entry.original, entry.edits))
    .filter((text) => text !== "")
    .join("\n");
  if (patch.trim() === "") {
    throw new Refusal("the drafted patch is empty — every rule matched but nothing changed; refusing to write an empty patch");
  }
  return { patch, descriptions };
}

const CHECKLIST = [
  "the suites red by design until extended: the pre-pass wiring case refuses the new `vocabularyFirst` carrier, the stage-count literals trail the table, and gate-drift.test.ts's tail-zone claim names the old order — extend them deliberately, then run the suite green",
  "re-pin the three edited pins after the suites are green: MUTATION_LOCK_FILE=<lock> node .freebuff/gate-drift.mjs --write .freebuff/mutation-vocabulary.mjs .freebuff/gate-drift.mjs .freebuff/ci.mjs",
  "the new sweep file has no pin yet, and a targeted --write refuses new pins: record it through renderManifest, or npm run gates:pin when nothing else is drifted",
  "the stage-order audit is green now; the alarm will name the unpinned sweep until the re-pin — that is the designed friction",
];

function usage(message) {
  const text = message
    ? `${message}\nusage: node .freebuff/scaffold-sweep.mjs --name=<kebab> [--label=<label>] [--tests] [--json]\n`
    : "usage: node .freebuff/scaffold-sweep.mjs --name=<kebab> [--label=<label>] [--tests] [--json]\n";
  const error = new Refusal(text.trimEnd());
  error.exitCode = 2;
  throw error;
}

function main() {
  const argv = process.argv.slice(2);
  const json = argv.includes("--json");
  const tests = argv.includes("--tests");
  const named = argv.find((argument) => argument.startsWith("--name="));
  const labeled = argv.find((argument) => argument.startsWith("--label="));
  const unknown = argv.filter(
    (argument) =>
      !argument.startsWith("--name=") &&
      !argument.startsWith("--label=") &&
      argument !== "--json" &&
      argument !== "--tests",
  );
  if (named === undefined || unknown.length > 0) usage(unknown.length > 0 ? `unknown argument(s): ${unknown.join(" ")}` : undefined);
  const name = named.slice("--name=".length);
  const label = labeled ? labeled.slice("--label=".length) : `${name} vocabulary smoke`;
  if (!NAME_PATTERN.test(name)) {
    usage(`--name must be lowercase kebab-case (${NAME_PATTERN}), got ${JSON.stringify(name)}`);
  }
  const upper = name.replaceAll("-", "_").toUpperCase();
  const sweepPath = PATHS.sweep(name);

  for (const [what, path] of [
    ["the vocabulary module", PATHS.module()],
    ["the template sweep", PATHS.template()],
    ["the alarm", PATHS.alarm()],
    ["the runner", PATHS.runner()],
  ]) {
    if (!existsSync(path)) throw new Refusal(`${what} is not on disk where the scaffold reads it: ${path}`);
  }
  const moduleText = readFileSync(PATHS.module(), "utf8");
  const templateText = readFileSync(PATHS.template(), "utf8");
  const alarmText = readFileSync(PATHS.alarm(), "utf8");
  const runnerText = readFileSync(PATHS.runner(), "utf8");

  const tableNames = declaredStageNames(alarmText);
  // The order the un-extended suites show is the table as it stands; the draft derives
  // the claims it replaces from it.
  const currentOrder = tableNames;
  const stageName = `mutation-${name}`;
  const alreadyOnboarded =
    tableNames.includes(stageName) || existsSync(sweepPath) || moduleText.includes(`${upper}_SURVIVOR_WORDS`);
  if (alreadyOnboarded && !tests) {
    throw new Refusal(`${stageName} is already onboarded in this tree — the scaffold onboards a sweep once`);
  }
  if (!tableNames.includes("mutation-example")) {
    throw new Refusal("this tree's table has no mutation-example stage to build beside");
  }

  // Snapshots before anything is written, so any failure below restores the tree byte-exact.
  snapshot(PATHS.module());
  snapshot(PATHS.alarm());
  snapshot(PATHS.runner());
  snapshot(PATHS.runbook());
  snapshot(sweepPath);

  if (!process.env.SCAFFOLD_ROOT) {
    const alarm = runStep(process.execPath, [PATHS.alarm(), "--json"]);
    const alarmReport = parseJson(alarm);
    if (alarmReport?.gate !== "pass") {
      throw new Refusal(
        tests
          ? "the pin is drifted — a suite patch drafted over a drifted tree would quote lines nobody else's tree has; settle the pin first"
          : "the pin is drifted — the scaffold's edits would fold that drift into the next re-pin; settle the pin first",
      );
    }
  }
  requireAuditGreen("before the scaffold edits");

  // The draft-only path: the sweep is already onboarded, so there is nothing to build —
  // but the suites can still be waiting for their extensions, and a re-draft is cheaper
  // than remembering the command. Rules are computed and verified against the tree as it
  // stands; a rule whose needles no longer match names the count it found. Nothing here
  // writes a suite file: the patch is the artifact, and the operator applies and reviews it.
  if (alreadyOnboarded) {
    if (!tableNames.includes(stageName)) {
      throw new Refusal(
        `${stageName} is onboarded in this tree but the stage table does not name it — settle the onboarding first`,
      );
    }
    // The table already carries the stage, so the "new" order is the table's own order —
    // splicing the stage in again would double it, and every claim derived from the order
    // with it.
    const newOrder = [...tableNames];
    const suitePatch = draftSuitePatch({
      currentOrder: tableNames,
      newOrder,
      name,
      tailZoneClaim: deriveTailZoneClaim(alarmText, newOrder),
      currentClaim: deriveTailZoneClaim(alarmText, currentOrder.filter((stage) => stage !== stageName)),
    });
    const rel = (path) => path.slice(ROOT.length + 1);
    // The patch is the artifact and it is written under the same rollback discipline as
    // every other file the scaffold touches: snapshotted first, so a failure after this
    // point takes it back with the tree.
    snapshot(patchPath(name));
    writeFileSync(patchPath(name), suitePatch.patch, "utf8");
    if (json) {
      process.stdout.write(
        `${JSON.stringify(
          { gate: "pass", name: stageName, draftOnly: true, suitePatch: rel(patchPath(name)), rules: suitePatch.descriptions },
          null,
          2,
        )}\n`,
      );
    } else {
      process.stdout.write(
        [
          `scaffold: ${stageName} is already onboarded — drafted the suite extensions instead of refusing.`,
          `scaffold: wrote  ${rel(patchPath(name))} (${suitePatch.descriptions.length} rule(s))`,
          ...suitePatch.descriptions.map((line) => `  - ${line}`),
          "scaffold: review the patch, apply it, extend the runbook, then re-pin.",
          "",
        ].join("\n"),
      );
    }
    for (const temp of [".scaffold-lock.json", ".scaffold-cache.json"]) {
      rmSync(join(ROOT, temp), { force: true });
    }
    return;
  }

  const newOrder = [...tableNames];
  newOrder.splice(tableNames.indexOf("mutation-example") + 1, 0, stageName);
  const nextModule = planModule(moduleText, name, upper);
  const nextSweep = planSweep(templateText, name, upper);
  const nextAlarm = planTableEntry(alarmText, name, upper, label);
  const nextRunner = planLambda(planHeaderEnumeration(runnerText, tableNames, name), name);

  writeFileSync(PATHS.module(), nextModule, "utf8");
  writeFileSync(sweepPath, nextSweep, "utf8");
  writeFileSync(PATHS.alarm(), nextAlarm, "utf8");
  writeFileSync(PATHS.runner(), nextRunner, "utf8");
  const write = runStep(process.execPath, [PATHS.runner(), "--stages=write", "--no-cache"]);
  if (write.status !== 0) {
    throw new Refusal(`the tree's runner refused to regenerate the marked lines:\n${write.stderr}`);
  }

  for (const path of [PATHS.module(), sweepPath, PATHS.alarm(), PATHS.runner()]) requireParseable(path);
  requireAuditGreen("after the scaffold's edits");
  const vocabulary = runStep(process.execPath, [sweepPath, "--vocabulary", "--json"]);
  const vocabularyReport = parseJson(vocabulary);
  if (
    vocabulary.status !== 0 ||
    vocabularyReport?.gate !== "pass" ||
    vocabularyReport?.file !== `.freebuff/mutation-${name}.mjs` ||
    !Array.isArray(vocabularyReport?.words) ||
    vocabularyReport.words.length !== 2
  ) {
    throw new Refusal(`the generated sweep's vocabulary table is not a clean two-word report:\n${vocabulary.stdout}${vocabulary.stderr}`);
  }
  const demonstration = runStep(process.execPath, [sweepPath, "--json"]);
  const demonstrationReport = parseJson(demonstration);
  if (
    demonstration.status !== 0 ||
    demonstrationReport?.gate !== "pass" ||
    demonstrationReport?.checked !== 1 ||
    JSON.stringify(demonstrationReport?.survivors ?? []) !== "[]"
  ) {
    throw new Refusal(`the generated sweep's demonstration run is not one clean stamp:\n${demonstration.stdout}${demonstration.stderr}`);
  }

  // With --tests, the suite extensions are drafted against the tree as the scaffold has
  // just edited it — the rules verify against the suites' current text and the runner's
  // own account of the new order — and the patch is written beside the tree. The suites
  // themselves stay untouched: the operator reviews, applies, and runs them green.
  const checklist = [...CHECKLIST];
  let suitePatchNote;
  if (tests) {
    const suitePatch = draftSuitePatch({
      currentOrder: tableNames,
      newOrder,
      name,
      tailZoneClaim: deriveTailZoneClaim(alarmText, newOrder),
      currentClaim: deriveTailZoneClaim(alarmText, currentOrder.filter((stage) => stage !== stageName)),
    });
    suitePatchNote = patchPath(name);
    // Under the same rollback discipline as every other write: snapshotted before it is
    // written, so a failure after this point takes the patch back with the tree.
    snapshot(suitePatchNote);
    writeFileSync(suitePatchNote, suitePatch.patch, "utf8");
    const patchRel = suitePatchNote.slice(ROOT.length + 1).split("\\").join("/");
    checklist[0] =
      `the suite extensions are drafted, not applied: review and apply ${patchRel}, then run the suites green — the wiring case, the count literals, the tail-zone claim and the not-run lines are all in the patch`;
  }

  for (const temp of [".scaffold-lock.json", ".scaffold-cache.json"]) {
    rmSync(join(ROOT, temp), { force: true });
  }
  const created = [];
  const edited = [];
  for (const [path, before] of snapshots) {
    const now = existsSync(path) ? readFileSync(path, "utf8") : null;
    if (before === null && now !== null) created.push(path);
    else if (before !== null && now !== before) edited.push(path);
  }
  const rel = (path) => path.slice(ROOT.length + 1);
  if (json) {
    process.stdout.write(
      `${JSON.stringify(
        {
          gate: "pass",
          name: stageName,
          label,
          stages: newOrder.length,
          created: created.map(rel),
          edited: edited.map(rel),
          ...(suitePatchNote === undefined ? {} : { suitePatch: rel(suitePatchNote) }),
          checklist,
        },
        null,
        2,
      )}\n`,
    );
  } else {
    process.stdout.write(
      [
        `scaffold: ${stageName} onboarded — ${newOrder.length} stage(s), the stage-order audit green, the sweep answers both modes.`,
        `scaffold: created ${created.map(rel).join(", ") || "nothing"}`,
        `scaffold: edited  ${edited.map(rel).join(", ") || "nothing"}`,
        ...(suitePatchNote === undefined ? [] : [`scaffold: drafted ${rel(suitePatchNote)} — the suite extensions are in the patch, not applied`]),
        "scaffold: the operator's checklist:",
        ...checklist.map((line) => `  - ${line}`),
        "",
      ].join("\n"),
    );
  }
}

try {
  main();
} catch (error) {
  rollback();
  const refusal = error instanceof Refusal;
  const report = { gate: "fail", error: error instanceof Error ? error.message : String(error) };
  if (process.argv.includes("--json")) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else process.stderr.write(`scaffold: ${report.error}\n`);
  process.exit(refusal && error.exitCode ? error.exitCode : 1);
}

