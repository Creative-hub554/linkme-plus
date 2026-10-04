/**
 * `.freebuff/pr-comment.mjs` — the one poster the three workflow comment steps share.
 *
 * It was three copies of the same shell until the copies drifted: the collect-budget
 * summary step checked that its file existed before handing the path to `gh`, and the two
 * proposal steps did not, so a `gh` failure on a path that was not there read as success
 * under `continue-on-error` and left the comment missing with nothing on the page saying
 * why. The unit that replaced them is followed here the way `collect-gates.test.ts`
 * follows the run-summary renderer: the real script, spawned, over a real directory, with
 * `gh` replaced by a stub that records its argv (`PR_COMMENT_GH` is the seam) — so what is
 * asserted is the process's exit code, its output, the run page it wrote, and the exact
 * commands it issued, rather than a substring of a workflow file.
 *
 * The stub answers the two different calls it will see: the paged listing (`--jq`) prints
 * `GH_LOOKUP`, and a post exits with `GH_POST_EXIT` when that is set. `GH_LIST_EXIT` makes
 * the listing itself fail, which is the branch that decides between a duplicate comment and
 * no comment at all.
 *
 * Both halves of the same worry are followed here, because both end the same way for a
 * reviewer — with no comment on the pull request. A body that never arrived is *announced*
 * rather than posted, and a post `gh` refused is announced too: the exit status makes the
 * step red, but a `continue-on-error` step in an otherwise green job is one line in a log
 * nobody opens, so the run page has to carry it as well — and has to describe what is on the
 * pull request now, which differs between a failed `PATCH` and a failed `POST`.
 *
 * The third outcome ends the other way, with a comment and no failure: the listing failed
 * and the fallback `POST` landed, so the step is green and the pull request may now carry two
 * marked comments. That is announced as well — but only once the post has landed, which is why
 * the case below where both calls fail has a note about the failure and *not* about a
 * duplicate nobody can find.
 *
 * None of these exits 0 unless the comment is on the pull request, and that is a contract with
 * something outside this file: the comment steps are `continue-on-error`, so their exit status
 * is what `.freebuff/comment-gate.mjs` reads back per step at the end of the job. The run-page
 * note is the explanation; the exit code is the verdict the job is judged on.
 *
 * The fourth thing followed here is what the body *is* by the time it is posted. This is the
 * one artifact of the four the redactor serves that is published to a pull request, and it was
 * the one of them that let `gh` read the renderer's file itself — so both sources are read here
 * now, scrubbed through `.freebuff/redact.mjs`, and sent as the raw field `-f body=…`. The
 * consequences are pinned from both ends: what `gh` was handed, and what the run page says
 * about a body that had to be changed to be publishable.
 *
 * The fifth thing followed here is the dry run, which is the same path with the `gh` calls taken
 * out: it prints the payload and the run-page notes it would have produced and touches nothing.
 * What is asserted is that it calls nothing and writes nothing, that the payload it prints is
 * the argv the real posting would use, and that its exit status stays out of the way — `0` for a
 * rehearsal, and `2` still for an invocation the real run would refuse.
 *
 * The sixth is the record the poster files when it had to scrub: written beside the body it read
 * — `<body>.redactions.json`, in the artifact upload's reach — so a reviewer can walk the
 * `<redacted>` markers in the comment back to the raw text in the artifact. It carries the hidden
 * text, which is exactly why it is beside the body and not on the pull request or the run page:
 * the note there keeps counting, and now points at the record rather than repeating it.
 *
 * The seventh is the other half of that judgment: a body can carry a run that looks like a
 * generated key and is claimed by no rule, and the poster **warns** rather than redacts it. The
 * two notes are deliberately opposite — the redaction note withholds a value it removed, this one
 * names a value the comment is already carrying — so the tests here pin both the warning and the
 * fact that nothing was hidden to produce it.
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  announcement,
  failureAnnouncement,
  lookupAnnouncement,
  missingSource,
  parseArgs,
  pickCommentId,
  recordPathFor,
  UsageError,
} from "../../.freebuff/pr-comment.mjs";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));
const script = join(projectRoot, ".freebuff", "pr-comment.mjs");

/** The `gh` the script calls instead of the real one: it records, then answers. */
const STUB = `
import { appendFileSync } from "node:fs";

const args = process.argv.slice(2);
appendFileSync(process.env.GH_LOG, \`\${JSON.stringify(args)}\\n\`);
if (args.includes("--jq")) {
  if (process.env.GH_LIST_EXIT) process.exit(Number(process.env.GH_LIST_EXIT));
  process.stdout.write(process.env.GH_LOOKUP ?? "");
} else if (process.env.GH_POST_EXIT) {
  process.exit(Number(process.env.GH_POST_EXIT));
}
`;

/** The body file's name, relative to the run's directory — what `--body` is given. */
const BODY = "proposal.md";

/** The flags a step passes, with the marker and the wording it would use. */
const ARGS = [
  "--body",
  BODY,
  "--marker",
  "<!-- probe-marker -->",
  "--label",
  "Probe comment",
  "--producer",
  "Write the probe",
];

/** A directory, a stub `gh`, and a runner that spawns the real script in it. */
function harness() {
  const dir = mkdtempSync(join(tmpdir(), "pr-comment-"));
  const stub = join(dir, "gh-stub.mjs");
  writeFileSync(stub, STUB);
  const ghLog = join(dir, "gh.log");
  const summary = join(dir, "summary.md");
  return {
    dir,
    ghLog,
    summary,
    path: (name: string) => join(dir, name),
    run: (args: string[], env: Record<string, string> = {}) =>
      spawnSync(process.execPath, [script, ...args], {
        cwd: dir,
        encoding: "utf8",
        env: {
          ...process.env,
          GITHUB_REPOSITORY: "o/r",
          PR: "7",
          GH_TOKEN: "x",
          PR_COMMENT_GH: stub,
          GH_LOG: ghLog,
          GITHUB_STEP_SUMMARY: summary,
          ...env,
        },
      }),
    /** Every `gh` invocation the stub saw, as argv arrays — and none, if it never ran. */
    calls: () =>
      existsSync(ghLog)
        ? readFileSync(ghLog, "utf8")
            .split("\n")
            .filter((line) => line.trim().length > 0)
            .map((line) => JSON.parse(line) as string[])
        : [],
    summaryText: () => (existsSync(summary) ? readFileSync(summary, "utf8") : ""),
  };
}

/** The paged listing, whose marker the stub is not asked to honour. */
function listing(call: string[]) {
  return call.includes("--jq");
}

describe("posting nothing", () => {
  it.each([
    ["missing", null],
    ["empty", ""],
    ["blank", "   \n\t\n"],
  ])("announces a %s body instead of posting it, and says so in its exit status", (_case, contents) => {
    const { run, calls, summaryText, path } = harness();
    if (contents !== null) writeFileSync(path(BODY), contents);

    const result = run(ARGS);

    // 1, not 0: the note explains the skip, and the exit status is what the job's gate reads
    // — a run that owed a comment and posted none does not get to finish green.
    expect(result.status, result.stderr).toBe(1);
    expect(result.stdout).toContain(`${BODY} was not written, or was empty — nothing to post`);
    // The run page, which is the whole point: a skipped comment says so where a reviewer
    // looks, not only in a step log they never open.
    expect(summaryText()).toContain("## Probe comment — ❌ nothing to post");
    expect(summaryText()).toContain("The 'Write the probe' step left no `proposal.md`");
    // And nothing was sent: the guard is before the call, not beside it.
    expect(calls()).toEqual([]);
  });

  it("announces a blank reply text rather than posting an empty comment", () => {
    // The apply job's reply is composed in its step rather than written to a file, so it
    // arrives as `--text` — and it is the comment a reviewer is *waiting* on, which is why
    // a blank one has to say so on the run page instead of posting nothing at all.
    const { run, calls, summaryText } = harness();

    const result = run(["--text", "  \n", "--marker", "<!-- probe-marker -->", "--label", "Probe reply", "--producer", "Reply on the pull request"]);

    expect(result.status, result.stderr).toBe(1);
    expect(result.stdout).toContain("was not written, or was empty — nothing to post");
    expect(summaryText()).toContain("## Probe reply — ❌ nothing to post");
    expect(summaryText()).toContain("The 'Reply on the pull request' step produced no reply text");
    expect(calls()).toEqual([]);
  });

  it("posts inline text as a raw field, so nothing gh reads is unredacted", () => {
    // `-f body=…` and `-F body=@path` are not interchangeable: the second tells `gh` to open
    // the value as a file, so a reply that happened to start with `@` would be read from disk
    // — or fail to be read at all. It is now the shape for a file body too, because `gh`
    // opening the file is exactly the read the redaction has to happen before.
    const { run, calls } = harness();
    const text = "<!-- probe-marker -->\n\nApplied in a follow-up pull request.";

    const result = run(["--text", text, "--marker", "<!-- probe-marker -->", "--label", "Probe reply", "--producer", "Reply on the pull request"], { GH_LOOKUP: "42\n" });

    expect(result.status, result.stderr).toBe(0);
    expect(calls().filter((call) => !listing(call))).toEqual([
      ["api", "-X", "PATCH", "repos/o/r/issues/comments/42", "-f", `body=${text}`],
    ]);
  });

  it("posts an empty body only if the file has content", () => {
    // The boundary the guard turns on, from the other side — the case the tests above are
    // the complement of, and the one that proves they are not passing for a missing `gh`.
    const { run, calls, path } = harness();
    writeFileSync(path(BODY), "\n  x \n");

    const result = run(ARGS, { GH_LOOKUP: "" });

    expect(result.status, result.stderr).toBe(0);
    // The contents, not the path: what `gh` is handed is what this script read.
    expect(calls().filter((call) => !listing(call))).toEqual([
      ["api", "-X", "POST", "repos/o/r/issues/7/comments", "-f", "body=\n  x \n"],
    ]);
  });
});

describe("posting the comment", () => {
  it("updates the marked comment when the marker finds one", () => {
    const { run, calls, path, summaryText } = harness();
    writeFileSync(path(BODY), "## Proposal\n");

    const result = run(ARGS, { GH_LOOKUP: "42\n" });

    expect(result.status, result.stderr).toBe(0);
    const [list, post] = calls();
    // The marker is grepped for as a jq string literal, so the listing finds the previous
    // comment rather than describing it.
    expect(list).toEqual([
      "api",
      "repos/o/r/issues/7/comments",
      "--paginate",
      "--jq",
      '.[] | select(.body | contains("<!-- probe-marker -->")) | .id',
    ]);
    expect(post).toEqual([
      "api",
      "-X",
      "PATCH",
      "repos/o/r/issues/comments/42",
      "-f",
      "body=## Proposal\n",
    ]);
    // A posted comment is not news: the run page is for the miss, not the success.
    expect(summaryText()).toBe("");
  });

  it("creates the first comment when the marker finds none", () => {
    const { run, calls, path } = harness();
    writeFileSync(path(BODY), "## Proposal\n");

    const result = run(ARGS, { GH_LOOKUP: "\n" });

    expect(result.status, result.stderr).toBe(0);
    expect(calls().filter((call) => !listing(call))).toEqual([
      ["api", "-X", "POST", "repos/o/r/issues/7/comments", "-f", "body=## Proposal\n"],
    ]);
  });

  it("updates the oldest comment when the listing returns more than one", () => {
    // `--paginate` prints an id per matching comment per page, and a pull request that has
    // somehow acquired two must be updated in place rather than accumulating a third.
    const { run, calls, path } = harness();
    writeFileSync(path(BODY), "## Proposal\n");

    const result = run(ARGS, { GH_LOOKUP: "12\n\n 34 \n56\n" });

    expect(result.status, result.stderr).toBe(0);
    expect(calls().filter((call) => !listing(call))).toEqual([
      ["api", "-X", "PATCH", "repos/o/r/issues/comments/12", "-f", "body=## Proposal\n"],
    ]);
  });
});

describe("the body it will publish", () => {
  it("scrubs a secret-looking name before the body reaches the pull request", () => {
    // The reason this path reads the file rather than handing `gh` its path: a summary or a
    // proposal that names a `.env` is exactly what a comment must not become, and `-F
    // body=@path` is the form in which nobody but `gh` would ever have seen it.
    const { run, calls, summaryText, path } = harness();
    writeFileSync(path(BODY), "## Proposal\n\nThe budget for `.env.production` moved.\n");

    const result = run(ARGS, { GH_LOOKUP: "" });

    expect(result.status, result.stderr).toBe(0);
    const posted = calls().filter((call) => !listing(call))[0]?.[5] ?? "";
    expect(posted).toContain("The budget for `<redacted>` moved.");
    expect(posted).not.toContain(".env.production");
    // And the run page says so, with how many: a `<redacted>` in a comment the reviewer is
    // reading has to have an explanation somewhere, or it reads as a renderer that lost a name.
    expect(summaryText()).toContain("## Probe comment — ⚠️ the comment was redacted before posting");
    expect(summaryText()).toContain("needed 1 substitution");
    // The names are not repeated on the page: they are what was taken out.
    expect(summaryText()).not.toContain(".env.production");
  });

  it("scrubs credentials and keys, and counts every substitution it made", () => {
    // The two value shapes, both of which have no file name to match: a connection string with
    // its password in the userinfo, and a key written out. A name-based scrubber is blind to
    // both, which is why the vocabulary they are caught by lives in `redact.mjs` beside it.
    const { run, calls, summaryText, path } = harness();
    writeFileSync(
      path(BODY),
      "## Proposal\n\nDATABASE_URL=postgresql://builder:hunter2@db.internal:5432/app\n\n" +
        "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA\n-----END RSA PRIVATE KEY-----\n",
    );

    const result = run(ARGS, { GH_LOOKUP: "" });

    expect(result.status, result.stderr).toBe(0);
    const posted = calls().filter((call) => !listing(call))[0]?.[5] ?? "";
    expect(posted).toContain("postgresql://<redacted>@db.internal:5432/app");
    expect(posted).toContain("<redacted>");
    expect(posted).not.toContain("BEGIN RSA PRIVATE KEY");
    expect(posted).not.toContain("hunter2");
    expect(posted).not.toContain("MIIEowIBAAKCAQEA");
    expect(summaryText()).toContain("needed 2 substitutions");
  });

  it("scrubs the reply text as well, since a step composes it too", () => {
    // `--text` is the apply job's reply, built from a case table in shell. It goes through the
    // same scrub on the way out, because "this step composes its own text" is not a reason for
    // it to be the one body that bypasses the rule.
    const { run, calls, summaryText } = harness();
    const text = "<!-- probe-marker -->\n\nRefused — see `.env.local` for the token.";

    const result = run([
      "--text",
      text,
      "--marker",
      "<!-- probe-marker -->",
      "--label",
      "Probe reply",
      "--producer",
      "Reply on the pull request",
    ], { GH_LOOKUP: "" });

    expect(result.status, result.stderr).toBe(0);
    const posted = calls().filter((call) => !listing(call))[0]?.[5] ?? "";
    expect(posted).toContain("see `<redacted>` for the token");
    expect(posted).not.toContain(".env.local");
    expect(summaryText()).toContain("## Probe reply — ⚠️ the comment was redacted before posting");
  });

  it("keeps the marker, so the comment still updates in place rather than stacking", () => {
    // The marker is what identifies the previous comment, and it survives the scrub only
    // because it is not shaped like anything in the vocabulary — which is worth pinning, since
    // losing it would not fail: it would start posting a new comment on every push.
    const { run, calls, path } = harness();
    writeFileSync(path(BODY), "<!-- probe-marker -->\n\nBudget for `.env.production`.\n");

    const result = run(ARGS, { GH_LOOKUP: "42\n" });

    expect(result.status, result.stderr).toBe(0);
    const [list, post] = calls();
    expect(list[4]).toBe('.[] | select(.body | contains("<!-- probe-marker -->")) | .id');
    expect(post?.[5]).toMatch(/^body=<!-- probe-marker -->/);
  });

  it("says nothing when the body needed no scrubbing", () => {
    // Ordinary text — including a URL with no credentials and a bare `host:port` — is left
    // exactly as it was, and a page that announced a redaction that did not happen would send
    // a reader looking for a loss that is not there.
    const { run, summaryText, path } = harness();
    writeFileSync(
      path(BODY),
      "## Proposal\n\nSee https://example.com:8080/guide and ssh://git@github.com/org/repo.\n",
    );

    const result = run(ARGS, { GH_LOOKUP: "" });

    expect(result.status, result.stderr).toBe(0);
    expect(summaryText()).toBe("");
  });
});

describe("the record of what it redacted", () => {
  it("files what was hidden beside the body, where the artifact is", () => {
    // The map between the two things a reviewer holds: the comment shows `<redacted>` and the
    // artifact shows the raw text, and only the record says which span the two differ by. Beside
    // the body so it rides in the same upload — and carrying the hidden text, which is why it is
    // here rather than on the pull request.
    const { run, calls, summaryText, path } = harness();
    writeFileSync(
      path(BODY),
      "## Proposal\n\nMoved: `.env.production`, and postgresql://builder:hunter2@db.internal:5432/app.\n",
    );

    const result = run(ARGS, { GH_LOOKUP: "42\n" });

    expect(result.status, result.stderr).toBe(0);
    const record = JSON.parse(readFileSync(path("proposal.redactions.json"), "utf8"));
    expect(record.body).toBe(BODY);
    // Which comment the record maps to, named the way the failure note names it — so a reader
    // with only the record knows what to compare it against.
    expect(record.posted).toBe("PATCH repos/o/r/issues/comments/42");
    expect(record.redactions).toBe(2);
    expect(record.substitutions).toEqual([
      {
        rule: "url-credentials",
        matched: "postgresql://builder:hunter2@",
        replacement: "postgresql://<redacted>@",
      },
      { rule: "secret-name", matched: ".env.production", replacement: "<redacted>" },
    ]);
    // What `gh` was handed still carries neither: the record is where the text lives, and it is
    // not on the pull request.
    const posted = calls().filter((call) => !listing(call))[0]?.[5] ?? "";
    expect(posted).not.toContain("hunter2");
    expect(posted).not.toContain(".env.production");
    // The run page points at the record without repeating what is in it.
    expect(summaryText()).toContain("recorded in `proposal.redactions.json`");
    expect(summaryText()).not.toContain("hunter2");
    expect(summaryText()).not.toContain(".env.production");
  });

  it("writes no record when there was nothing to redact", () => {
    // An empty record would be a second file saying nothing, and a reviewer who found one beside a
    // body with no markers would start looking for a substitution that never happened.
    const { run, path, summaryText } = harness();
    writeFileSync(path(BODY), "## Proposal\n");

    const result = run(ARGS, { GH_LOOKUP: "" });

    expect(result.status, result.stderr).toBe(0);
    expect(existsSync(path("proposal.redactions.json"))).toBe(false);
    expect(summaryText()).toBe("");
  });

  it("writes none for a composed reply, which has no body for a reviewer to compare", () => {
    // `--text` is the apply job's reply, built in the step. There is no body file in any artifact
    // to compare it against, so a record would have nothing to map — and writing one anyway would
    // put the secret in the checkout rather than in an artifact.
    const { run, dir } = harness();
    const text = "<!-- probe-marker -->\n\nRefused — see `.env.local` for the token.";

    const result = run(
      ["--text", text, "--marker", "<!-- probe-marker -->", "--label", "Probe reply", "--producer", "Reply on the pull request"],
      { GH_LOOKUP: "" },
    );

    expect(result.status, result.stderr).toBe(0);
    expect(readdirSync(dir).filter((name) => name.endsWith(".redactions.json"))).toEqual([]);
  });

  it("still exits 0 when the record cannot be written, and does not promise the file", () => {
    // The comment is already on the pull request by the time the record is written, and the exit
    // status answers only whether it arrived — so a failed record write is a stderr line and a
    // note that goes without the path, never a red step or a promise of a file that is not there.
    // A directory where the record should go is the cheapest way to make the write fail.
    const { run, calls, summaryText, path } = harness();
    writeFileSync(path(BODY), "## Proposal\n\nMoved: `.env.production`.\n");
    mkdirSync(path("proposal.redactions.json"));

    const result = run(ARGS, { GH_LOOKUP: "" });

    expect(result.status, result.stderr).toBe(0);
    // The post still happened, and the comment is still scrubbed.
    const posted = calls().filter((call) => !listing(call))[0]?.[5] ?? "";
    expect(posted).toContain("Moved: `<redacted>`");
    expect(result.stderr).toContain("could not write the redaction record");
    // The note still explains the marker; it just does not name a record that is not there.
    expect(summaryText()).toContain("## Probe comment — ⚠️ the comment was redacted before posting");
    expect(summaryText()).toContain("needed 1 substitution");
    expect(summaryText()).not.toContain("recorded in");
  });

  it("names the record a real run would file, without filing it, in a dry run", () => {
    // The rehearsal's note is the note a real run writes — record path and all — but a dry run
    // writes nothing, so the file is named and not created.
    const { run, path, summaryText } = harness();
    writeFileSync(path(BODY), "## Proposal\n\nMoved: `.env.production`.\n");

    const result = run([...ARGS, "--dry-run"], { GH_LOOKUP: "42\n" });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("recorded in `proposal.redactions.json`");
    expect(existsSync(path("proposal.redactions.json"))).toBe(false);
    expect(summaryText()).toBe("");
  });
});

describe("the runs it cannot be sure about", () => {
  it("warns on the run page and names them, and posts them unredacted", () => {
    // The softer half of the vocabulary, from the page a reviewer reads: a shape no rule claims is
    // shown to a person rather than hidden, so the token really is in the comment — which is exactly
    // why the note names it. Withholding it would hide the thing the note is about.
    const { run, calls, summaryText, path } = harness();
    writeFileSync(path(BODY), "## Proposal\n\nkey: sklive9Xk2Qp7Zr4Tn8Vw1YsAbb12\n");

    const result = run(ARGS, { GH_LOOKUP: "" });

    expect(result.status, result.stderr).toBe(0);
    const posted = calls().filter((call) => !listing(call))[0]?.[5] ?? "";
    // Not redacted: the exit status answers only whether the comment arrived, and it did.
    expect(posted).toContain("sklive9Xk2Qp7Zr4Tn8Vw1YsAbb12");
    expect(summaryText()).toContain(
      "## Probe comment — ⚠️ the body carries a run that may be a secret",
    );
    expect(summaryText()).toContain("carries 1 run long and mixed");
    expect(summaryText()).toContain("sklive9Xk2Qp7Zr4Tn8Vw1YsAbb12");
    expect(result.stderr).toContain("not redacted");
    // Nothing was replaced, so there is nothing to map and no record to file.
    expect(existsSync(path("proposal.redactions.json"))).toBe(false);
  });

  it("says nothing about the digests and identifiers a report is made of", () => {
    // The half of the rule that keeps the warning worth reading: the bodies these steps post are
    // full of paths, timings and hashes, and a warning on any of those would be noise.
    const { run, summaryText, path } = harness();
    writeFileSync(
      path(BODY),
      "## Proposal\n\nhash 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b\n\nscope `CollectBudgetProposal2026`\n",
    );

    const result = run(ARGS, { GH_LOOKUP: "" });

    expect(result.status, result.stderr).toBe(0);
    expect(summaryText()).toBe("");
  });

  it("names the first few and counts the rest, so a body of them cannot flood the page", () => {
    // A body can carry more of these than a reader wants to look at. The cap is what keeps the note
    // a warning rather than a wall, and the count is what keeps it honest about what it left out.
    const { run, summaryText, path } = harness();
    const tokens = Array.from({ length: 7 }, (_unused, index) => `sklive9Xk2Qp7Zr4Tn8Vw1YsAbb1${index}`);
    writeFileSync(path(BODY), `## Proposal\n\n${tokens.join("\n\n")}\n`);

    const result = run(ARGS, { GH_LOOKUP: "" });

    expect(result.status, result.stderr).toBe(0);
    expect(summaryText()).toContain("carries 7 runs");
    expect(summaryText()).toContain("…and 2 more.");
    // The fifth is named and the sixth is not — the boundary asserted rather than assumed.
    expect(summaryText()).toContain(`- \`${tokens[4]}\``);
    expect(summaryText()).not.toContain(`- \`${tokens[5]}\``);
  });

  it("prints the warning in a dry run too, since a note is all a rehearsal can show", () => {
    const { run, path, summaryText } = harness();
    writeFileSync(path(BODY), "## Proposal\n\nkey: sklive9Xk2Qp7Zr4Tn8Vw1YsAbb12\n");

    const result = run([...ARGS, "--dry-run"]);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(
      "## Probe comment — ⚠️ the body carries a run that may be a secret",
    );
    expect(result.stdout).toContain("sklive9Xk2Qp7Zr4Tn8Vw1YsAbb12");
    expect(summaryText()).toBe("");
  });

  it("carries both notes when a body has something hidden and something uncertain", () => {
    // One body, two questions, and the page answers each: what a rule was sure of is hidden and
    // recorded, what it could not be sure of is shown and named. Under one heading name, so a
    // reader is not sent to two places for one step.
    const { run, summaryText, path } = harness();
    writeFileSync(
      path(BODY),
      "## Proposal\n\nMoved: `.env.production`.\n\nkey: sklive9Xk2Qp7Zr4Tn8Vw1YsAbb12\n",
    );

    const result = run(ARGS, { GH_LOOKUP: "" });

    expect(result.status, result.stderr).toBe(0);
    expect(summaryText()).toContain("## Probe comment — ⚠️ the comment was redacted before posting");
    expect(summaryText()).toContain(
      "## Probe comment — ⚠️ the body carries a run that may be a secret",
    );
    // The hidden name is still absent from the page; the uncertain one is deliberately present.
    expect(summaryText()).not.toContain(".env.production");
    expect(summaryText()).toContain("sklive9Xk2Qp7Zr4Tn8Vw1YsAbb12");
  });
});

describe("the dry run", () => {
  it("prints the payload and the notes it would publish, and calls nothing", () => {
    // The rehearsal travels the same path — parse, read, scrub, payload — and stops before the
    // first `gh` call. What it prints is what a real run would have handed `gh` and the run-page
    // note that run would have written, with neither the call nor the line actually made.
    const { run, calls, summaryText, path } = harness();
    writeFileSync(path(BODY), "## Proposal\n\nThe budget for `.env.production` moved.\n");

    const result = run([...ARGS, "--dry-run"], { GH_LOOKUP: "42\n" });

    expect(result.status, result.stderr).toBe(0);
    // Not even the listing: the lookup is itself a `gh` call, and a dry run makes none.
    expect(calls()).toEqual([]);
    // And the run page is left exactly as it was — a rehearsal that appended a note would be a post.
    expect(summaryText()).toBe("");
    expect(result.stdout).toContain("no `gh` command was run");
    // The payload, redacted as a real run would send it: this is the assertion that makes the dry
    // run a rehearsal rather than another copy of the body.
    expect(result.stdout).toContain("-f body=## Proposal\n\nThe budget for `<redacted>` moved.");
    expect(result.stdout).not.toContain(".env.production");
    // The note it would have published, so a `<redacted>` in the payload has the explanation a
    // real run would have put beside it — the same text, only a different reader.
    expect(result.stdout).toContain("the run page would say:");
    expect(result.stdout).toContain("## Probe comment — ⚠️ the comment was redacted before posting");
    expect(result.stdout).toContain("needed 1 substitution");
  });

  it("prints exactly the payload a real run would hand gh", () => {
    // The tie that keeps the two from drifting: the rehearsal's printed payload is compared
    // against the real posting's argv, rather than each against a fixture a hand keeps in step.
    const dry = harness();
    writeFileSync(dry.path(BODY), "## Proposal\n");
    const real = harness();
    writeFileSync(real.path(BODY), "## Proposal\n");

    const rehearse = dry.run([...ARGS, "--dry-run"], { GH_LOOKUP: "42\n" });
    const posted = real.run(ARGS, { GH_LOOKUP: "42\n" });

    expect(rehearse.status, rehearse.stderr).toBe(0);
    expect(posted.status, posted.stderr).toBe(0);
    const sent = real.calls().filter((call) => !listing(call))[0];
    expect(sent?.[5]).toBe("body=## Proposal\n");
    expect(rehearse.stdout).toContain(`-f ${sent?.[5]}`);
  });

  it("names both verbs rather than guessing the one the skipped lookup decides", () => {
    // Whether the comment would be created or updated is the marker lookup's answer, and the
    // lookup is exactly the `gh` call a dry run does not make. Showing one verb would be wrong
    // half the time and wrong silently; showing both is the honest half-answer.
    const { run, calls, path } = harness();
    writeFileSync(path(BODY), "## Proposal\n");

    const result = run([...ARGS, "--dry-run"]);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("-X POST repos/o/r/issues/7/comments");
    expect(result.stdout).toContain("-X PATCH repos/o/r/issues/comments/<id>");
    expect(calls()).toEqual([]);
  });

  it("shows the note a missing body would publish, and still exits 0", () => {
    // The empty branch is part of the path too, so a dry run shows the ❌ note it would write —
    // and exits 0 where a real run exits 1: a rehearsal has lost nothing, so it must not read as
    // a lost comment to the job's gate, and the line it prints is the verdict the real run would get.
    const { run, calls, summaryText, path } = harness();

    const result = run([...ARGS, "--dry-run"], { GH_LOOKUP: "42\n" });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(`${BODY} was not written, or was empty — nothing to post`);
    expect(result.stdout).toContain("## Probe comment — ❌ nothing to post");
    expect(result.stdout).toContain("a real run would exit 1");
    expect(summaryText()).toBe("");
    expect(calls()).toEqual([]);
    // The file really was absent — the case is a missing body, not a guard that stopped early.
    expect(existsSync(path(BODY))).toBe(false);
  });

  it("still refuses an invocation a real run would refuse, before any gh", () => {
    // A rehearsal that accepted an invocation the real run rejects would be rehearsing a
    // different path, so the usage errors hold and `--dry-run` changes nothing about them.
    const { run, ghLog } = harness();

    const result = run([...ARGS, "--dry-run"], { PR: "" });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("GITHUB_REPOSITORY and PR must both be set");
    expect(existsSync(ghLog)).toBe(false);
  });
});

describe("when the call itself fails", () => {
  it("fails the step with gh's status, and announces the refusal on the run page", () => {
    const { run, summaryText, path } = harness();
    writeFileSync(path(BODY), "## Proposal\n");

    const result = run(ARGS, { GH_LOOKUP: "", GH_POST_EXIT: "1" });

    // The step is `continue-on-error`, so the exit status makes it a red step rather than a
    // red job. That was the whole of it: a red line in a log nobody opens, in a job that is
    // otherwise green, so the run page had to learn to say it too.
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("the comment was not posted");
    expect(summaryText()).toContain("## Probe comment — ❌ the comment was not posted");
    // The note names what was attempted and what it left behind, which is the part a
    // reviewer cannot recover from the page otherwise.
    expect(summaryText()).toContain("api -X POST repos/o/r/issues/7/comments");
    expect(summaryText()).toContain("which failed with exit 1");
    expect(summaryText()).toContain("No comment was left on the pull request at all.");
    // A failure is not a miss: the page must not answer a refused post with the diagnosis
    // that belongs to a body which never arrived, which would send the reader to look for a
    // file that was there all along.
    expect(summaryText()).not.toContain("nothing to post");
    expect(summaryText()).not.toContain("was not written, or was empty");
  });

  it("names the comment a failed PATCH left standing", () => {
    // The trap a bare failure hides: an update that failed leaves the *previous* summary on
    // the pull request, where it reads as this run's until somebody checks the date.
    const { run, summaryText, path } = harness();
    writeFileSync(path(BODY), "## Proposal\n");

    const result = run(ARGS, { GH_LOOKUP: "42\n", GH_POST_EXIT: "3" });

    expect(result.status).toBe(3);
    expect(summaryText()).toContain("api -X PATCH repos/o/r/issues/comments/42");
    expect(summaryText()).toContain("which failed with exit 3");
    expect(summaryText()).toContain("The comment the marker found is untouched");
    expect(summaryText()).not.toContain("No comment was left on the pull request at all");
  });

  it("announces a gh that could not be started, as the runner's failure rather than a refusal", () => {
    // The one failure where `gh` itself said nothing, so the note carries the reason. The
    // exit code is 1 rather than 2 for the same reason: 2 means this refused to act, and
    // here it acted and could not.
    const { run, dir, summaryText, path } = harness();
    writeFileSync(path(BODY), "## Proposal\n");

    const result = run(ARGS, { PR_COMMENT_GH: join(dir, "no-such-gh") });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("could not run");
    expect(summaryText()).toContain("## Probe comment — ❌ the comment was not posted");
    expect(summaryText()).toContain("which could not be started");
    expect(summaryText()).toContain("No comment was left on the pull request at all.");
    expect(summaryText()).not.toContain("nothing to post");
  });

  it("falls back to a new comment when the listing fails, and says why", () => {
    // A transient listing failure costs a duplicate comment before it costs the comment:
    // the step's job is to leave the reviewer something, and the warning is what explains
    // the second sticky comment a person will see.
    const { run, calls, path } = harness();
    writeFileSync(path(BODY), "## Proposal\n");

    const result = run(ARGS, { GH_LIST_EXIT: "1" });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toContain("could not list");
    expect(calls().filter((call) => !listing(call))).toEqual([
      ["api", "-X", "POST", "repos/o/r/issues/7/comments", "-f", "body=## Proposal\n"],
    ]);
  });

  it("tells the run page about the duplicate the fallback may have left", () => {
    // The one outcome here that is neither a green run nor a loss: the step succeeded, so
    // nothing is red and nothing is missing — and a reviewer is looking at two sticky
    // comments with no explanation. That is the run page's subject, not the log's.
    const { run, summaryText, path } = harness();
    writeFileSync(path(BODY), "## Proposal\n");

    const result = run(ARGS, { GH_LIST_EXIT: "1" });

    expect(result.status, result.stderr).toBe(0);
    expect(summaryText()).toContain(
      "## Probe comment — ⚠️ the previous comment could not be looked up",
    );
    expect(summaryText()).toContain("could not list the comments on #7 (the lookup exited 1)");
    expect(summaryText()).toContain("the pull\nrequest now shows two of them");
    // Past tense, because it is only written once the post has landed: a note that said a
    // comment had been posted when it had not would be the failure note's job done wrong.
    expect(summaryText()).not.toContain("the comment was not posted");
  });

  it("does not claim a duplicate when the fallback post failed as well", () => {
    // Two failures, one note. Nothing was posted, so there is no second comment to explain
    // and no reason to send the reader looking for one — announcing the lookup here would be
    // a diagnosis of a state the pull request is not in.
    const { run, summaryText, path } = harness();
    writeFileSync(path(BODY), "## Proposal\n");

    const result = run(ARGS, { GH_LIST_EXIT: "1", GH_POST_EXIT: "1" });

    expect(result.status).toBe(1);
    expect(summaryText()).toContain("## Probe comment — ❌ the comment was not posted");
    expect(summaryText()).not.toContain("could not be looked up");
    expect(summaryText()).not.toContain("now shows two of them");
  });
});

describe("the invocation it refuses", () => {
  it.each([
    ["an unreadable flag", ["--body", BODY, "--producer", "x", "--label", "y", "--wat", "z"], "unknown flag --wat"],
    ["a flag with no value", ["--body", BODY, "--marker=", "--label", "y", "--producer", "x"], "--marker needs a value"],
    ["a missing flag", ARGS.slice(0, -2), "--producer is required"],
    ["a stray argument", [...ARGS, "extra"], "unexpected argument 'extra'"],
    ["no body at all", ARGS.slice(2), "--body or --text is required"],
    ["both sources", [...ARGS, "--text", "t"], "--body and --text are alternatives; give one"],
    ["a switch given a value", [...ARGS, "--dry-run=true"], "--dry-run does not take a value"],
  ])("refuses %s rather than posting", (_case, args, message) => {
    const { run, ghLog } = harness();

    const result = run(args);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain(message);
    expect(result.stderr).toContain("usage: pr-comment.mjs");
    expect(existsSync(ghLog)).toBe(false);
  });

  it("refuses to post without a repository and a pull request to post to", () => {
    // Without them the API path would be a well-formed request to nowhere — `repos//issues/`,
    // which `gh` answers with an opaque error the step's `continue-on-error` would swallow.
    const { run, ghLog } = harness();

    const result = run(ARGS, { PR: "" });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("GITHUB_REPOSITORY and PR must both be set");
    expect(existsSync(ghLog)).toBe(false);
  });
});

describe("the pieces it is read through", () => {
  it("takes the first id an answer offers, ignoring blank lines", () => {
    expect(pickCommentId("")).toBe("");
    expect(pickCommentId("\n \n")).toBe("");
    expect(pickCommentId("12\n34\n")).toBe("12");
    expect(pickCommentId("  42  \n")).toBe("42");
    expect(pickCommentId(undefined as unknown as string)).toBe("");
  });

  it("derives the record's path from the body, beside it and named for it", () => {
    // Derived rather than passed as a flag: a path a step had to name separately is a path a step
    // can forget, and the workflow's artifact list is held to this derivation by a test in
    // `src/test/collect-budget.test.ts`. A body with no extension keeps its whole name, and a
    // dot-file keeps its dot rather than being read as having one.
    expect(recordPathFor(".freebuff/collect-gates.md")).toBe(
      ".freebuff/collect-gates.redactions.json",
    );
    expect(recordPathFor(".coverage/coverage-proposal.md")).toBe(
      ".coverage/coverage-proposal.redactions.json",
    );
    expect(recordPathFor("proposal.md")).toBe("proposal.redactions.json");
    expect(recordPathFor(".freebuff/notes")).toBe(".freebuff/notes.redactions.json");
    expect(recordPathFor(".env")).toBe(".env.redactions.json");
  });

  it("reads flags as `--flag value` or `--flag=value`, and refuses anything else", () => {
    expect(parseArgs(ARGS)).toEqual({
      body: BODY,
      marker: "<!-- probe-marker -->",
      label: "Probe comment",
      producer: "Write the probe",
      dryRun: false,
    });
    expect(parseArgs([`--body=${BODY}`, "--marker=m", "--label=l", "--producer=p"])).toEqual({
      body: BODY,
      marker: "m",
      label: "l",
      producer: "p",
      dryRun: false,
    });
    // The one switch: present or absent, and it moves nothing else about the invocation.
    expect(parseArgs([...ARGS, "--dry-run"])).toEqual({
      body: BODY,
      marker: "<!-- probe-marker -->",
      label: "Probe comment",
      producer: "Write the probe",
      dryRun: true,
    });
    expect(() => parseArgs(["--body", BODY])).toThrow(UsageError);
    expect(() => parseArgs(["--body", BODY, "--marker", "m", "--label", "l", "--producer"])).toThrow(
      "--producer needs a value",
    );
  });

  it("names what was missing, for a file body and for reply text", () => {
    // The two sources have different things to name: a path a step should have written, or
    // text it should have composed. A note that said “left no ``” about a reply would send
    // the reader looking for a file that was never meant to exist.
    expect(missingSource({ body: BODY })).toBe("left no `proposal.md`");
    expect(missingSource({})).toBe("produced no reply text");
  });

  it("writes the run-page note from the flags it was given", () => {
    // The page names the file and the step that should have written it — the two things a
    // reader needs to match the note against the log above it.
    const note = announcement({
      source: missingSource({ body: BODY }),
      label: "Probe comment",
      producer: "Write the probe",
    });

    expect(note).toContain("## Probe comment — ❌ nothing to post");
    expect(note).toContain("The 'Write the probe' step left no `proposal.md`");
    expect(note).toContain("Check that step's log on this run.");
  });

  it("writes the failure note around what the pull request shows now", () => {
    // One shape, two outcomes, and the outcome that differs is the one a reader has to act
    // on: whether the marked comment is stale or absent. A note that said the same thing
    // either way would be worse than no note, because it would look authoritative.
    const base = {
      label: "Probe comment",
      producer: "Write the probe",
      command: "gh",
      url: "repos/o/r/issues/7/comments",
      status: 1,
    };
    const created = failureAnnouncement({ ...base, verb: "POST" });
    const updated = failureAnnouncement({
      ...base,
      verb: "PATCH",
      url: "repos/o/r/issues/comments/42",
    });

    expect(created).toContain("## Probe comment — ❌ the comment was not posted");
    expect(created).toContain("The 'Write the probe' step ran `gh api -X POST");
    expect(created).toContain("which failed with exit 1.");
    expect(created).toContain("No comment was left on the pull request at all.");
    expect(updated).toContain("`gh api -X PATCH repos/o/r/issues/comments/42`");
    expect(updated).toContain("The comment the marker found is untouched");
    // And the same note covers the runner's own failure, which is the case where `gh` had
    // no message of its own to give.
    const unreachable = failureAnnouncement({
      ...base,
      verb: "POST",
      status: null,
      detail: "spawn gh ENOENT",
    });
    expect(unreachable).toContain("which could not be started (spawn gh ENOENT)");
    expect(unreachable).toContain("the reason it could not start is above");
  });

  it("writes the duplicate note around the marker's old comment", () => {
    // A warning, not a loss — the step is green and the comment is on the pull request — so
    // it is marked as one, and it says the thing the reader cannot see from the page: that
    // the comment they are reading may be the older of two.
    const note = lookupAnnouncement({
      label: "Probe comment",
      producer: "Write the probe",
      pr: "7",
      lookup: "could not list the comments on #7 (the lookup exited 1)",
    });

    expect(note).toContain("## Probe comment — ⚠️ the previous comment could not be looked up");
    expect(note).toContain(
      "The 'Write the probe' step could not list the comments on #7 (the lookup exited 1)",
    );
    expect(note).toContain(
      "the marker would have found. If a marked comment was already on #7, the pull",
    );
    expect(note).toContain("The step stays green");
    // Not a ❌: nothing failed and nothing is missing, and sharing the failure note's mark
    // would put a refusal and a duplicate on the same footing on the page.
    expect(note).not.toContain("❌");
  });
});
