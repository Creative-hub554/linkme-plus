import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { staleStageLists } from "@/test/convention-guards";
import { STAGE_NAMES } from "../../.freebuff/gate-drift.mjs";
import { makeScratchDir, removeScratchDir } from "./scratch";

/**
 * The stage order is stated once — the `STAGES` declarations in `.freebuff/ci.mjs` — and every
 * other statement of it is a copy: the runner's own header, the runbook, the expectations in
 * `src/test/ci-runner.test.ts` and `src/test/ci-runner-tree-editing.test.ts`, and the nightly
 * job's selection. A copy can be forgotten, and the failure is quiet: add a stage and the header
 * still says ten, remove one and a test still expects it, and nothing complains, because nothing
 * compared a copy to the table it copied.
 *
 * That comparison is what this test holds. It drives the runner's own `--stages` audit against
 * throwaway copies of the watched files, so every way a copy can disagree with the table — a
 * hand-typed generated line, a count beside a list that is not its length, a list written out of
 * order, a numbered enumeration that is not the table, a watched file that went away — is a named
 * finding rather than a silence; and it drives a *run* against a drifted copy, to prove the
 * finding stops the run before its first stage rather than printing an apology over a pass. The
 * two halves that make the guarantee worth anything are here as well: the table the audit answers
 * from is the `STAGES` declarations read out of the source (never a list kept in step by hand),
 * and the committed tree is green.
 *
 * `CI_STAGE_ORDER_ROOT` points the audit at a copy, the way `GATE_HASHES_FILE` points the drift
 * alarm at a fixture: nothing but a test ever sets it.
 *
 * These cases spawn the real runner, so a concurrent session's tree-editing sweep — which
 * rewrites `.freebuff/ci.mjs` in place while it goes, the same way the `mutation` stage does — can
 * read them red for a reason that is not this change: the sweep's `stage-order` strike is
 * *supposed* to be caught here, so the file must not skip while a lock is held, and a reader who
 * sees several of these fail at once during someone else's sweep is looking at that window rather
 * than at a regression.
 */

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));
const ciRunner = path.join(projectRoot, ".freebuff", "ci.mjs");
/** The alarm, where the stage table is declared: the file the runner imports its list from. */
const alarm = path.join(projectRoot, ".freebuff", "gate-drift.mjs");

/** The files the audit reads, so a scratch tree is a copy of exactly those. */
const WATCHED_FILES = [
  ".freebuff/ci.mjs",
  ".freebuff/run.md",
  // The table's own file: the declaration is read from the table rather than from the text, but a
  // *list* of stages written in a comment there is a claim like any other — and it is the file a
  // reader consults when asking what the pass is.
  ".freebuff/gate-drift.mjs",
  "src/test/ci-runner.test.ts",
  "src/test/ci-runner-tree-editing.test.ts",
  ".github/workflows/nightly.yml",
];

const STAGE_ORDER_BEGIN = "<!-- stage-order:begin -->";
const STAGE_ORDER_END = "<!-- stage-order:end -->";

interface Finding {
  file: string;
  line: number | null;
  kind: string;
  detail: string;
}

interface OrderReport {
  stages: string[];
  count: number;
  gate: "pass" | "fail";
  exitCode: number;
  findings: Finding[];
  /** Files the `--commentary` pass read; carried only when the flag was passed. */
  scanned?: number;
}

/** A run's refusal, as its `--json` report spells it. */
interface RefusalReport {
  gate: "fail";
  exitCode: number;
  error: string;
  orderDrift: Finding[];
  stages: string[];
  failed: string[];
}

let scratchRoot = "";
/** A stage script that says nothing and passes, so a run that is not refused costs nothing. */
let silentStub = "";

beforeAll(() => {
  scratchRoot = makeScratchDir("ci-stage-order-");
  silentStub = path.join(scratchRoot, "stage-pass.mjs");
  writeFileSync(silentStub, "process.exit(0);\n", "utf8");
});

afterAll(() => {
  removeScratchDir(scratchRoot);
});

/**
 * The stage names read straight out of the `STAGE_TABLE` declaration in `.freebuff/gate-drift.mjs`,
 * the way a reader counting the entries would — an entry starts at the array's own indentation,
 * whether it is written across lines or on one, and a nested `name:` (a check's own name, a
 * heading's) is indented deeper, which is why the match has to start with the entry's `{`.
 *
 * This is the half that makes the audit an answer rather than an echo: if the table the runner
 * reports ever stops being the declaration in the file it was imported from, this fails. It reads
 * the *file* rather than the import on purpose — the import is what the audit already uses, so a
 * reading taken the same way could only agree with itself.
 */
function declaredStageNames(): string[] {
  const source = readFileSync(alarm, "utf8");
  const start = source.indexOf("export const STAGE_TABLE = [");
  if (start === -1) {
    throw new Error("the STAGE_TABLE declaration is gone from .freebuff/gate-drift.mjs");
  }
  const rest = source.slice(start);
  const close = /\n\];/.exec(rest);
  if (close === null) throw new Error("the STAGE_TABLE declaration never closes");
  const element = /^ {2}\{ *(?:\n {4}name: "([a-z-]+)",|name: "([a-z-]+)",)/gm;
  return [...rest.slice(0, close.index).matchAll(element)].map((match) => match[1] ?? match[2]);
}

/**
 * Runs the audit alone against a tree, through the `--stages=check --json` contract.
 * When `watchGlob` is given it is passed as `--watch-glob=<glob>`, extending the audit
 * beyond `STAGE_ORDER_FILES` to the glob-matched files the caller names; `commentary`
 * passes `--commentary`, extending it once more to every source file's comments in the
 * tree, which is what `stages:lint` runs.
 */
function checkTree(
  root: string,
  watchGlob?: string,
  commentary = false,
): { status: number | null; report: OrderReport } {
  const args = ["--stages=check", "--json"];
  if (watchGlob !== undefined) args.push(`--watch-glob=${watchGlob}`);
  if (commentary) args.push("--commentary");
  const result = spawnSync(process.execPath, [ciRunner, ...args], {
    cwd: projectRoot,
    encoding: "utf8",
    env: { ...process.env, CI_STAGE_ORDER_ROOT: root },
  });
  return { status: result.status, report: JSON.parse(result.stdout) as OrderReport };
}

/** The table as `--stages=json` reports it, for the cases that never touch the tree. */
function stagesJson(): { stages: string[]; count: number } {
  const result = spawnSync(process.execPath, [ciRunner, "--stages=json"], {
    cwd: projectRoot,
    encoding: "utf8",
  });
  return JSON.parse(result.stdout) as { stages: string[]; count: number };
}

/**
 * The one line the generator writes, rebuilt here from `--stages=json` — a second reading of the
 * table, in the test's own words, so the format the files carry is held rather than assumed.
 */
function generatedLine(): string {
  const { stages, count } = stagesJson();
  return `${count} stage(s), in canonical order: ${stages.map((name) => `\`${name}\``).join(", ")}.`;
}

/**
 * The last numbered header line in the stage enumeration of `.freebuff/ci.mjs`, read from
 * the committed file rather than typed as a literal `* 10` — so the cases that hold it
 * stay anchored when a stage is added or removed. The count and final name come from
 * `--stages=json` (the same reading `generatedLine` takes), matched against the line so
 * a drift in the enumeration is a finding rather than a silent re-anchor. Returns `count`,
 * `name`, `line` (the full numbered header text without its trailing newline), and
 * `prefix` (the ` * <n>. \`<name>\`` head the name-drift case edits).
 */
function lastEnumeratedLine(): { count: number; name: string; line: string; prefix: string } {
  const { stages, count } = stagesJson();
  const name = stages[count - 1];
  const source = readFileSync(path.join(projectRoot, ".freebuff", "ci.mjs"), "utf8");
  const numberedHeader = /^[	 ]*\*[	 ]+(\d+)\.[ 	]+`([a-z-]+)`/;
  const lines = source.split("\n");
  let found = "";
  for (const line of lines) {
    const match = numberedHeader.exec(line);
    if (match !== null && Number(match[1]) === count && match[2] === name) {
      found = line;
    }
  }
  if (found === "") {
    throw new Error(`no numbered header for \`${name}\` at position ${count} in .freebuff/ci.mjs`);
  }
  const nameToken = `\`${name}\``;
  const prefix = found.slice(0, found.indexOf(nameToken) + nameToken.length);
  return { count, name, line: found, prefix };
}

/** What a generated block holds: the text between its markers, with the comment gutter taken off. */
function blockLine(text: string): string {
  const between = text.slice(
    text.indexOf(STAGE_ORDER_BEGIN) + STAGE_ORDER_BEGIN.length,
    text.indexOf(STAGE_ORDER_END),
  );
  return between
    .split("\n")
    .map((line) => line.trim().replace(/^\*\s*/, ""))
    .filter((line) => line !== "")
    .join("\n");
}

/** A throwaway copy of the watched files, with a handle for making it disagree with the table. */
interface Tree {
  /** The copied file's text. */
  read(file: string): string;
  /** Replaces the first occurrence of `anchor`, refusing when the anchor is not there. */
  edit(file: string, anchor: string, replacement: string): void;
  /** Takes a watched file away, the way a moved or renamed one would. */
  remove(file: string): void;
  /** Adds a new file to the tree, the way a newly introduced document would. */
  write(file: string, content: string): void;
}

/** Copies the watched files into a fresh directory under the scratch root, drifted by `mutate`. */
function driftedTree(label: string, mutate: (tree: Tree) => void): string {
  const root = path.join(scratchRoot, label);
  const tree: Tree = {
    read: (file) => readFileSync(path.join(root, file), "utf8"),
    edit: (file, anchor, replacement) => {
      const target = path.join(root, file);
      const text = readFileSync(target, "utf8");
      if (!text.includes(anchor)) {
        throw new Error(`${file} does not contain the anchor ${JSON.stringify(anchor)}`);
      }
      writeFileSync(target, text.replace(anchor, replacement), "utf8");
    },
    remove: (file) => rmSync(path.join(root, file)),
    write: (file, content) => {
      const target = path.join(root, file);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, content, "utf8");
    },
  };
  for (const file of WATCHED_FILES) {
    const target = path.join(root, file);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, readFileSync(path.join(projectRoot, file), "utf8"), "utf8");
  }
  mutate(tree);
  return root;
}

/**
 * Runs the real runner against a tree, `typecheck` only, with the stage itself stubbed and both
 * the result cache and the tree-editing lock pointed at the scratch directory — so the only thing
 * a run can be answering is the tree it was given.
 */
function runAgainst(root: string | null) {
  return spawnSync(process.execPath, [ciRunner, "--only=typecheck", "--json"], {
    cwd: projectRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      CI_TYPECHECK_SCRIPT: silentStub,
      CI_CACHE_FILE: path.join(scratchRoot, "cache.json"),
      MUTATION_LOCK_FILE: path.join(scratchRoot, "lock.json"),
      ...(root === null ? {} : { CI_STAGE_ORDER_ROOT: root }),
    },
  });
}

/**
 * Every drift carries the same two halves: the audit names it, and a run refuses on it before a
 * stage runs — `failed: []` is what says nothing was measured, and the error is what names the
 * way out.
 */
function expectDrift(label: string, kinds: string[], mutate: (tree: Tree) => void): void {
  const root = driftedTree(label, mutate);

  const { status, report } = checkTree(root);
  expect(status).toBe(1);
  expect(report.gate).toBe("fail");
  expect(report.findings.map((finding) => finding.kind)).toEqual(expect.arrayContaining(kinds));

  const run = runAgainst(root);
  expect(run.status).toBe(1);
  const payload = JSON.parse(run.stdout) as RefusalReport;
  expect(payload.orderDrift.map((finding) => finding.kind)).toEqual(
    expect.arrayContaining(kinds),
  );
  expect(payload.failed).toEqual([]);
  expect(payload.error).toContain("--stages=check");
}

describe("the CI stage order", () => {
  it("is the stage declarations, and every copy in the tree is that same order", () => {
    const { status, report } = checkTree(projectRoot);

    expect(status).toBe(0);
    expect(report.gate).toBe("pass");
    expect(report.findings).toEqual([]);
    // The table is the declaration above it, not a second copy of the same ten names.
    expect(report.stages).toEqual(declaredStageNames());
    expect(report.count).toBe(report.stages.length);

    // Both generated lines are exactly what the generator would write, read back through the
    // markers — which is what makes the count in the prose impossible to type by hand.
    expect(blockLine(readFileSync(path.join(projectRoot, ".freebuff/ci.mjs"), "utf8"))).toBe(
      generatedLine(),
    );
    expect(blockLine(readFileSync(path.join(projectRoot, ".freebuff/run.md"), "utf8"))).toBe(
      generatedLine(),
    );
  });

  it("reads a hand-typed generated line as a finding against both sides", () => {
    const root = driftedTree("generated-line", (tree) => {
      tree.edit(".freebuff/ci.mjs", "`runbook`, `lint`", "`lint`, `runbook`");
    });

    const { status, report } = checkTree(root);

    expect(status).toBe(1);
    const finding = report.findings.find((entry) => entry.file === ".freebuff/ci.mjs");
    expect(finding?.kind).toBe("generated");
    // Both sides are on the line, so the reader is not left to work out which half is wrong.
    expect(finding?.detail).toContain("the table says");
    expect(finding?.line).toBeTypeOf("number");
  });

  it("names a generated block that opens and never closes", () => {
    expectDrift("unterminated", ["generated"], (tree) => {
      tree.edit(
        ".freebuff/run.md",
        `\n${STAGE_ORDER_END}\n`,
        "\n",
      );
    });
  });

  it("names a generated block that is gone entirely", () => {
    expectDrift("absent", ["generated"], (tree) => {
      tree.edit(
        ".freebuff/run.md",
        `${STAGE_ORDER_BEGIN}\n`,
        "",
      );
    });
  });

  it("refuses to skip a watched file it cannot read", () => {
    expectDrift("unreadable", ["unreadable"], (tree) => {
      tree.remove("src/test/ci-runner-tree-editing.test.ts");
    });
  });

  it("holds a count beside a list to the length of that list", () => {
    // The nightly job's own selection, with a count that no longer matches it.
    expectDrift("count", ["count"], (tree) => {
      tree.edit(
        ".github/workflows/nightly.yml",
        "on:\n",
        "# this job runs 3 stage(s): `lint`, `drift`\non:\n",
      );
    });
  });

  it("holds a list of stages to the canonical order", () => {
    expectDrift("order", ["order"], (tree) => {
      tree.edit(
        ".github/workflows/nightly.yml",
        "on:\n",
        "# stages: `lint`, `typecheck`\non:\n",
      );
    });
  });

  it("reads the runbook, the tests and the workflows against the declaration they name", () => {
    // Every place the pass is restated is watched, including the file the table is declared in: a
    // list written in a comment there is a claim like any other, and one the reader of that file is
    // most likely to trust — so the audit has to see it. Written at the table's own declaration so
    // the case fails for that one reason and not for a drifted marker.
    expectDrift("table-prose", ["order"], (tree) => {
      tree.edit(
        ".freebuff/gate-drift.mjs",
        "export const STAGE_TABLE = [",
        "// The stage list runs `lint`, `typecheck`\nexport const STAGE_TABLE = [",
      );
    });
  });

  it("holds the header's numbered enumeration to the table, name by name", () => {
    const { prefix, name } = lastEnumeratedLine();
    expectDrift("enumerated-name", ["enumerate"], (tree) => {
      tree.edit(".freebuff/ci.mjs", prefix, prefix.replace(`\`${name}\``, "`sweep`"));
    });
  });

  it("holds the header's numbered enumeration to the table, length and all", { timeout: 30000 }, () => {
    const { line } = lastEnumeratedLine();
    expectDrift("enumerated-count", ["enumerate"], (tree) => {
      tree.edit(".freebuff/ci.mjs", `${line}\n`, "");
    });
  });

  it("regenerates the marked lines and leaves the tree green", { timeout: 30000 }, () => {
    const expected = generatedLine();
    const root = driftedTree("write", (tree) => {
      tree.edit(".freebuff/ci.mjs", expected, "eight stage(s), in canonical order.");
      tree.edit(".freebuff/run.md", expected, "8 stage(s), in canonical order.");
    });
    expect(checkTree(root).status).toBe(1);

    const written = spawnSync(process.execPath, [ciRunner, "--stages=write"], {
      cwd: projectRoot,
      encoding: "utf8",
      env: { ...process.env, CI_STAGE_ORDER_ROOT: root },
    });

    expect(written.status).toBe(0);
    // Both marked files, and no others: a file with no marker is the author's, not the generator's.
    expect(written.stdout).toContain(".freebuff/ci.mjs");
    expect(written.stdout).toContain(".freebuff/run.md");
    expect(
      blockLine(readFileSync(path.join(root, ".freebuff/ci.mjs"), "utf8")),
    ).toBe(expected);
    expect(
      blockLine(readFileSync(path.join(root, ".freebuff/run.md"), "utf8")),
    ).toBe(expected);
    expect(checkTree(root).status).toBe(0);
  });

  it("emits the stage-order snapshot for a lint-time reader, in the table's own shape", { timeout: 30000 }, () => {
    // No snapshot in the tree: the fresh-clone state, which `--stages=write` has to repair so a
    // lint-time reader (an ESLint rule, a convention guard) never has to spawn the runner for it.
    const root = driftedTree("snapshot", () => {});

    const written = spawnSync(process.execPath, [ciRunner, "--stages=write"], {
      cwd: projectRoot,
      encoding: "utf8",
      env: { ...process.env, CI_STAGE_ORDER_ROOT: root },
    });

    expect(written.status).toBe(0);
    expect(written.stdout).toContain(".freebuff/stage-order.json");
    const snapshot = JSON.parse(
      readFileSync(path.join(root, ".freebuff", "stage-order.json"), "utf8"),
    ) as { stages: string[]; count: number };
    // Exactly what `--stages=json` prints: a reader must not be able to tell which of the two
    // it was handed, or the snapshot would be a second statement of the order rather than a copy.
    expect(snapshot).toEqual(stagesJson());

    // A second write has nothing to rewrite: the file is held to the table, not written on
    // principle, so an unchanged snapshot is an unchanged file and no claim that it was touched.
    const again = spawnSync(process.execPath, [ciRunner, "--stages=write"], {
      cwd: projectRoot,
      encoding: "utf8",
      env: { ...process.env, CI_STAGE_ORDER_ROOT: root },
    });
    expect(again.status).toBe(0);
    expect(again.stdout).not.toContain("stage-order.json");
  });

  it("holds the snapshot on disk to the table from the audit itself, and a run refuses on it", () => {
    // The snapshot exists so nothing has to spawn the runner to learn the order — which is
    // also why nothing would ever notice a stale copy unless this pass reads it too. Reversed:
    // same count, wrong order, exactly the drift a hand-edited or half-regenerated file carries.
    const reversed = [...stagesJson().stages].reverse();
    const root = driftedTree("snapshot-drift", (tree) => {
      tree.write(
        ".freebuff/stage-order.json",
        `${JSON.stringify({ stages: reversed, count: reversed.length }, null, 2)}\n`,
      );
    });

    const { status, report } = checkTree(root);
    expect(status).toBe(1);
    const findings = report.findings.filter((entry) => entry.kind === "snapshot");
    expect(findings.map((entry) => entry.file)).toEqual([".freebuff/stage-order.json"]);
    // Both sides named, the way the generated-line finding names them.
    expect(findings[0].detail).toContain("the table says");

    // …and a run refuses on it before its first stage, with the repair named beside it —
    // `--stages=write` is what rewrites the snapshot, so it is the command the refusal quotes.
    const run = runAgainst(root);
    expect(run.status).toBe(1);
    const payload = JSON.parse(run.stdout) as RefusalReport;
    expect(payload.orderDrift.map((entry) => entry.kind)).toContain("snapshot");
    expect(payload.failed).toEqual([]);
    expect(payload.error).toContain("--stages=write");
  });

  it("holds the committed snapshot in this checkout to the same table", () => {
    // The snapshot ships with the tree so a reader on a fresh clone finds it — which only holds
    // while it agrees with the table it was copied from. `--stages=write` regenerates it, and
    // `--stages=check` verifies its contents whenever the tree carries one; this case is the
    // existence half no pass can report on a tree the file was never written to, and a
    // byte-shape check on the artifact itself, independent of the audit that reads it.
    const snapshot = JSON.parse(
      readFileSync(path.join(projectRoot, ".freebuff", "stage-order.json"), "utf8"),
    ) as { stages: string[]; count: number };
    expect(snapshot).toEqual(stagesJson());
  });

  it("answers from the declarations on a tree a run would refuse, so the fix path is open", () => {
    const root = driftedTree("answering", (tree) => {
      tree.edit(".freebuff/ci.mjs", "`runbook`, `lint`", "`lint`, `runbook`");
    });

    const result = spawnSync(process.execPath, [ciRunner, "--stages"], {
      cwd: projectRoot,
      encoding: "utf8",
      env: { ...process.env, CI_STAGE_ORDER_ROOT: root },
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain(generatedLine());
    // The finding and the repair, on the tree that just refused to run.
    expect(result.stderr).toContain("generated");
    expect(result.stderr).toContain("--stages=write");
  });

  it("does not refuse a run on the committed tree", { timeout: 30000 }, () => {
    const result = runAgainst(null);

    expect(result.status).toBe(0);
    const payload = JSON.parse(result.stdout) as { gate: string; orderDrift?: Finding[] };
    expect(payload.gate).toBe("pass");
    expect(payload.orderDrift).toBeUndefined();
  });

  it("scans --watch-glob files for stage-order claims the watched set does not see", () => {
    // A file outside STAGE_ORDER_FILES with an out-of-order stage list: invisible without
    // --watch-glob, caught with it. The line names `lint` and `typecheck` in that order —
    // `typecheck` is the table's first stage, so the list is not canonical.
    const root = driftedTree("watch-glob", (tree) => {
      tree.write("watch-glob-extra.md", "# stages: `lint`, `typecheck`\n");
    });

    // Without --watch-glob: the extra file is outside the fixed set, so the tree is green.
    expect(checkTree(root).status).toBe(0);

    // With --watch-glob matching `*.md`: the extra file is scanned and the claim named.
    const { status, report } = checkTree(root, "*.md");
    expect(status).toBe(1);
    const finding = report.findings.find((entry) => entry.file === "watch-glob-extra.md");
    expect(finding?.kind).toBe("order");
    expect(finding?.detail).toContain("not the canonical order");
  });

  it("does not double-scan files already in STAGE_ORDER_FILES through --watch-glob", () => {
    // .freebuff/run.md is both a STAGE_ORDER_FILE and matched by `*.md` — it must be
    // scanned once, from the fixed set, with no duplicate from the glob pass.
    const root = driftedTree("watch-glob-dedup", (tree) => {
      tree.edit(
        ".freebuff/run.md",
        "in canonical order: ",
        "in canonical order: `lint`, `typecheck`, ",
      );
    });

    const { status, report } = checkTree(root, "*.md");
    expect(status).toBe(1);
    const runMdFindings = report.findings.filter((entry) => entry.file === ".freebuff/run.md");
    // The edit rewrites the generated line to carry an out-of-order list, which
    // produces a generated finding plus line-level order and count findings.
    // The dedup is what holds each to one: a second scan from the glob pass would
    // add a second order and a second count.
    expect(runMdFindings.filter((f) => f.kind === "order").length).toBe(1);
    expect(runMdFindings.filter((f) => f.kind === "count").length).toBe(1);
  });

  it("refuses --watch-glob with --stages=json, as only --stages=check uses it", () => {
    const root = driftedTree("watch-glob-json", (tree) => {
      tree.write("fixture.md", "# stages: `lint`, `typecheck`\n");
    });

    const result = spawnSync(process.execPath, [ciRunner, "--stages=json", "--watch-glob=*.md"], {
      cwd: projectRoot,
      encoding: "utf8",
      env: { ...process.env, CI_STAGE_ORDER_ROOT: root },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--watch-glob only applies with --stages=check");
  });

  it("refuses --watch-glob with --stages=write, as only --stages=check scans glob files", () => {
    const root = driftedTree("watch-glob-write", (tree) => {
      tree.write("fixture.md", "# stages: `lint`, `typecheck`\n");
    });

    const result = spawnSync(process.execPath, [ciRunner, "--stages=write", "--watch-glob=*.md"], {
      cwd: projectRoot,
      encoding: "utf8",
      env: { ...process.env, CI_STAGE_ORDER_ROOT: root },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--watch-glob only applies with --stages=check");
  });

  it("rejects --watch-glob when the pattern is empty", () => {
    const root = driftedTree("watch-glob-empty", () => {});

    const result = spawnSync(
      process.execPath, [ciRunner, "--stages=check", "--watch-glob="], {
        cwd: projectRoot,
        encoding: "utf8",
        env: { ...process.env, CI_STAGE_ORDER_ROOT: root },
      },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("does not accept an empty pattern");
  });

  it(
    "wires the docs, workflows and commentary scans into lint time, and holds the committed tree to them",
    { timeout: 30000 },
    () => {
      // The audit only runs where something invokes it. `stages:lint` is the lint-time entry
      // point, and its globs are read back out of the script rather than restated here — the
      // command lint runs and the scan this case drives cannot drift into scanning different
      // trees, and neither can quietly stop being wired into lint at all.
      const pkg = JSON.parse(readFileSync(path.join(projectRoot, "package.json"), "utf8")) as {
        scripts: Record<string, string>;
      };
      const script = pkg.scripts["stages:lint"];
      expect(script, "package.json carries no stages:lint script").toBeDefined();
      expect(pkg.scripts["lint"] ?? "", "lint no longer runs stages:lint").toContain(
        "stages:lint",
      );
      expect(pkg.scripts["lint:ci"] ?? "", "lint:ci no longer runs stages:lint").toContain(
        "stages:lint",
      );

      const glob = /--watch-glob=([^"\s]+)/.exec(script ?? "")?.[1] ?? "";
      expect(glob, "stages:lint passes no --watch-glob pattern").not.toBe("");
      // Both places the claim lives are named: the documents, and the workflows that run the pass.
      expect(glob).toContain("docs/");
      expect(glob).toContain(".github/workflows/");
      // …and the tree-wide commentary pass, which is the half a glob cannot express: every
      // source file's comments, not only the files a pattern happens to name.
      expect(script, "stages:lint no longer scans every source file's commentary").toContain(
        "--commentary",
      );

      // …and the committed tree passes exactly the scan lint would run — fixed set, globs and
      // commentary, through the same JSON contract as every other case here.
      const { status, report } = checkTree(projectRoot, glob, true);
      expect(status, JSON.stringify(report.findings, null, 2)).toBe(0);
      expect(report.findings).toEqual([]);
      // Breadth held to the pass's own reading: an empty finding list over a walk that read
      // nothing would be the same silence the count exists to rule out.
      expect(report.scanned).toBeGreaterThan(300);
    },
  );
});

/**
 * The lint-time consumer the audit's watch set cannot be: the runner holds its fixed files (and
 * any `--watch-glob` set) to the table, `stages:lint` holds docs and workflows to it raw — and
 * `--commentary` holds every *comment* in the tree to it, which is where a hand-written claim
 * lands in a file nobody thought to add to a watch list.
 *
 * The scan itself lives in the runner (`stageCommentaryFindings` in `.freebuff/ci.mjs`, reading
 * every source file's commentary); what lives here is the hold on it: that the committed tree
 * passes, that the pass really read the tree rather than nothing, and that its reading is the
 * suite's own `staleStageLists` reading — comment-only, which the second case pins from this
 * side: the same tree scanned raw would be full of out-of-order lists on purpose, inside
 * assertion strings and fixtures, so a pass that quietly stopped blanking strings would fail
 * here rather than drown the finding in noise.
 */
describe("every commentary claim in the tree", () => {
  it("states the stage order the table's way, or not at all", { timeout: 30000 }, () => {
    const { status, report } = checkTree(projectRoot, undefined, true);
    expect(status, JSON.stringify(report.findings, null, 2)).toBe(0);
    expect(report.findings).toEqual([]);
    // The scan has to be the whole tree for `toEqual([])` to mean anything: a walk that found
    // no file would pass it vacuously, and `scanned` is the pass's own count of the source
    // files it read — hundreds of them, across every directory a build, a cache or a duplicate
    // checkout would otherwise hide a fixture in.
    expect(report.scanned).toBeGreaterThan(300);
  });

  it("reads commentary only — a list a string or the code carries is not a claim", () => {
    // A comment is a claim, in either direction…
    expect(staleStageLists("// stages: `lint`, `typecheck`", STAGE_NAMES)).toEqual([1]);
    expect(staleStageLists("// stages: `typecheck`, `lint`", STAGE_NAMES)).toEqual([]);
    // …while an assertion's string and code naming both stages apart are not.
    expect(staleStageLists('const claim = "// stages: `lint`, `typecheck`";', STAGE_NAMES)).toEqual(
      [],
    );
    expect(staleStageLists("const pair = [lint, typecheck];", STAGE_NAMES)).toEqual([]);
  });

  it("names the comment, and only the comment, where the suite's own detector names it", () => {
    // One file carrying both shapes — a stale comment, the same list inside a string, and the
    // pair as code — driven through the real flag, so the lexer ported into the runner is held
    // to the reading `staleStageLists` gives: the comment reported line for line, the string
    // and the code left alone.
    const source = [
      "// stages: `lint`, `typecheck`",
      'const claim = "// stages: `lint`, `typecheck`";',
      "const pair = [lint, typecheck];",
      "",
    ].join("\n");
    const root = driftedTree("commentary-probe", (tree) => {
      tree.write("probe.ts", source);
    });

    // Without the flag the default audit does not reach a new source file at all: the breadth
    // is the flag's, and a default audit that refused anyway would be a wider check than it
    // says it is.
    expect(checkTree(root).status).toBe(0);

    const { status, report } = checkTree(root, undefined, true);
    expect(status).toBe(1);
    const probe = report.findings.filter((entry) => entry.file === "probe.ts");
    expect(probe.map((entry) => entry.line)).toEqual(staleStageLists(source, STAGE_NAMES));
    expect(probe).toHaveLength(1);
    expect(probe[0].kind).toBe("order");
    expect(probe[0].detail).toContain("not the canonical order");
    expect(report.scanned).toBeGreaterThan(0);
  });

  it("refuses --commentary with --stages=json, as only --stages=check reads commentary", () => {
    const root = driftedTree("commentary-json", () => {});

    const result = spawnSync(process.execPath, [ciRunner, "--stages=json", "--commentary"], {
      cwd: projectRoot,
      encoding: "utf8",
      env: { ...process.env, CI_STAGE_ORDER_ROOT: root },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--commentary only applies with --stages=check");
  });

  it("refuses --commentary with --stages=write, as only --stages=check reads commentary", () => {
    const root = driftedTree("commentary-write", () => {});

    const result = spawnSync(process.execPath, [ciRunner, "--stages=write", "--commentary"], {
      cwd: projectRoot,
      encoding: "utf8",
      env: { ...process.env, CI_STAGE_ORDER_ROOT: root },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--commentary only applies with --stages=check");
  });
});
