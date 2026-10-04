/**
 * `.freebuff/redact.mjs` — the one definition of what must not be published.
 *
 * It began as a vocabulary of secret-looking *names*, for two writers that only ever printed
 * names: the runner naming the files behind a cache key and the files that failed a stage, and
 * the nightly report publishing those results. This file is where the vocabulary itself is
 * pinned rather than only where its effects are: the rules are what the four writers agree on,
 * and `src/test/ci-runner.test.ts`, `gate-drift.test.ts` and `nightly-report.test.ts` each prove
 * their own writer uses them, which would go on passing if a rule were quietly dropped.
 *
 * The second half is newer, and it exists because the fourth writer prints *prose*: a comment is
 * a body of text on a pull request, and text can carry a secret that has no file name —
 * `postgresql://user:password@host` and a key written out between its markers. Both are shapes
 * rather than guesses, and the tests below keep them apart from the near-misses that must be
 * left alone (`ssh://git@host`, `https://host:8080/path`, `mailto:`, a bare `host:port`), since
 * a scrubber that hides ordinary text teaches its readers to distrust the marker.
 *
 * The third thing pinned here is the *record* `redact` returns beside the count: the rule that
 * fired, the exact span it replaced and what it wrote there. One writer files it — the poster
 * writes it beside the body it scrubbed — and this is where the vocabulary's own names are held,
 * since a record that named the wrong rule would mislead the reader it exists for.
 *
 * The fourth is the softer half, `suspectTokens`: the runs that look like a key and are claimed by
 * no rule. They are **not** hidden, so the thing to pin is the opposite of a redaction — that the
 * text is left exactly as it was, and that the shapes a report is made of (hashes, digests, UUIDs,
 * identifiers with a year on them) stay quiet, because a warning that fires on those is a warning
 * its reader learns to ignore.
 */
import { describe, expect, it } from "vitest";
import {
  REDACTED_INPUT,
  isSecretInput,
  redact,
  redactInput,
  redactInputs,
  redactText,
  SECRET_INPUT,
  suspectTokens,
} from "../../.freebuff/redact.mjs";

describe("the names it hides", () => {
  it("collapses a secret-looking name wherever it appears in prose", () => {
    const { text, redactions } = redact("Wrote .env.local and read .npmrc, then src/app/page.tsx");

    expect(text).toBe("Wrote <redacted> and read <redacted>, then src/app/page.tsx");
    expect(redactions).toBe(2);
  });

  it("keeps the line a redacted location names", () => {
    // The `:line` suffix is the form a survivor or a finding is named in: the path is the
    // secret, not where in the file the trouble is, so the location survives the redaction.
    expect(redactText("id_rsa:12:3")).toBe("<redacted>:12:3");
    expect(redactInput("deploy/id_ed25519:40")).toBe("<redacted>:40");
  });

  it("treats a name that is not a secret as ordinary text", () => {
    expect(isSecretInput("src/app/api/posts/route.ts")).toBe(false);
    expect(redactText(".env.example is committed while .env is not")).toBe(
      "<redacted> is committed while <redacted> is not",
    );
    // The whole vocabulary is a set of anchored patterns, and it is exported so a reader can
    // see what it does *not* cover as plainly as what it does.
    expect(SECRET_INPUT.test("keys.pem")).toBe(true);
    expect(SECRET_INPUT.test("pem-notes.md")).toBe(false);
  });

  it("collapses a run of redacted names to one, since how many there are is also private", () => {
    expect(redactInputs([".env", ".env.local", "src/app/page.tsx"])).toEqual([
      "<redacted>",
      "src/app/page.tsx",
    ]);
  });
});

describe("the values it hides", () => {
  it("takes the credentials out of a URL and leaves the host readable", () => {
    // The password is the secret; the scheme and host are what tell a reader *what* was
    // redacted, and hiding them too would trade one loss for two.
    const { text, redactions } = redact("DATABASE_URL=postgresql://builder:hunter2@db.internal:5432/app");

    expect(text).toBe(`DATABASE_URL=postgresql://${REDACTED_INPUT}@db.internal:5432/app`);
    expect(redactions).toBe(1);
  });

  it("hides a key written out, whole or cut off", () => {
    const whole = redact(
      "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA\n-----END RSA PRIVATE KEY-----",
    );
    expect(whole.text).toBe(REDACTED_INPUT);
    expect(whole.redactions).toBe(1);
    // A truncated paste is the shape a log actually catches, and the marker on its own is
    // enough to say the thing that follows it is not for a reader.
    const truncated = redact("key: -----BEGIN OPENSSH PRIVATE KEY-----");
    expect(truncated.text).toBe(`key: ${REDACTED_INPUT}`);
    expect(truncated.redactions).toBe(1);
  });

  it("leaves the URLs that carry no credentials exactly as they were", () => {
    // The near-misses, and the reason the rule asks for a colon *before* the `@`: a git URL, a
    // port on a host, a mailto, a bare `host:port`. Redacting any of these would be a false
    // positive that costs a reader real information for no secrecy at all.
    const text =
      "ssh://git@github.com/org/repo https://example.com:8080/guide mailto:a@b.example 127.0.0.1:5432";

    expect(redact(text)).toEqual({ text, redactions: 0, substitutions: [] });
  });

  it("counts every substitution across both vocabularies", () => {
    const { text, redactions } = redact(
      "read .env, then postgres://u:p@h/x, then say nothing about 127.0.0.1:5432",
    );

    expect(redactions).toBe(2);
    expect(text).toContain(`read ${REDACTED_INPUT}`);
    expect(text).toContain(`postgres://${REDACTED_INPUT}@h/x`);
    expect(text).toContain("127.0.0.1:5432");
  });
});

describe("the two views of one function", () => {
  it("is what the writers that only want the text are handed", () => {
    // `redactText` is `redact(text).text` — one implementation, two shapes — and the callers
    // that publish text (`ci.mjs`, `gate-drift.mjs`, `nightly-report.mjs`) go on reading it as
    // a string while the poster, which has to *say* how much it hid, reads the count.
    const body = "secret in .env and in postgres://u:p@h/db";
    expect(redactText(body)).toBe(redact(body).text);
  });

  it("is idempotent, so text already scrubbed is not scrubbed again", () => {
    // Nothing in the vocabulary matches the marker it writes. That is what makes it safe to
    // apply at more than one layer — and a second count of zero is what says so.
    const once = redact("read .env at postgres://u:p@h/db").text;
    expect(redact(once)).toEqual({ text: once, redactions: 0, substitutions: [] });
    expect(redactText(once)).toBe(once);
  });
});

describe("the runs it cannot be sure about", () => {
  it("finds a key-shaped run and hands it back without hiding it", () => {
    // The whole point of the softer half: a run long and mixed enough to be a generated key, with
    // the digits through the letters, is returned for a writer to warn about — and the text it came
    // from is untouched, because an uncertain shape is the wrong thing to collapse.
    const text = "token sklive9Xk2Qp7Zr4Tn8Vw1YsAbb12 end";

    expect(suspectTokens(text)).toEqual(["sklive9Xk2Qp7Zr4Tn8Vw1YsAbb12"]);
    expect(redactText(text)).toBe(text);
  });

  it("leaves the shapes a report is made of alone", () => {
    // Every exclusion is the design rather than an accident, and each is one this repository's own
    // reports contain: a git hash or a digest is hexadecimal (one case, so no shift), a UUID and a
    // lowercase blob have no second case, a long identifier carrying a year measures at or above
    // the entropy floor but gathers its digits at the end, and a short run is just short. A warning
    // that fired on any of these would teach its reader to ignore it — and unlike a rule, this one
    // has no certainty to fall back on.
    const quiet = [
      "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b", // a git/sha1 digest
      "0123456789abcdef0123456789abcdef01234567", // hex, and longer
      "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef", // hex, and repeating
      "550e8400-e29b-41d4-a716-446655440000", // a UUID
      "CollectBudgetProposal2026", // a word with a year on it
      "ImportStaleThresholdsAndSoftBands2026", // the same shape, longer
      "nextjsVercelEdgeRuntimeAdapter2026", // and one more
      "sklive9Xk2Qp7Zr", // long enough to look like one, short enough to be a word
      "https://example.com:8080/guide", // ordinary text
      "src/test/collect-budget.test.ts", // a path
    ];

    for (const token of quiet) expect(suspectTokens(token), token).toEqual([]);
  });

  it("turns on where the digits sit as much as on the entropy", () => {
    // The two runs differ only in where the digit is, and they are the two shapes the rule has to
    // separate: a digit through the letters is what a generated key looks like, and a digit at the
    // end is what a word with a year on it looks like — which entropy alone cannot tell apart, since
    // a long identifier reaches the same per-character entropy as a short key.
    expect(suspectTokens("Abc3defghijklmnopqrstuvwxy")).toEqual(["Abc3defghijklmnopqrstuvwxy"]);
    expect(suspectTokens("Abcdefghijklmnopqrstuvwxy3")).toEqual([]);
  });

  it("finds nothing in the marker the rules write, only in what survives them", () => {
    // A writer scans the text it would post, so a run a rule already replaced is gone. The marker
    // itself must not be a suspect either, or every redacted body would warn about its own
    // redaction.
    const { text, substitutions } = redact("read .env.local, key sklive9Xk2Qp7Zr4Tn8Vw1YsAbb12");

    expect(substitutions).toHaveLength(1);
    expect(suspectTokens(text)).toEqual(["sklive9Xk2Qp7Zr4Tn8Vw1YsAbb12"]);
    expect(suspectTokens(REDACTED_INPUT)).toEqual([]);
  });
});

describe("the record of what it replaced", () => {
  it("names the rule, the span and the replacement, in the order they were applied", () => {
    // The record is what a reviewer compares the posted comment against the artifact with: the
    // comment holds a `<redacted>` marker and no value, the artifact holds the value and no
    // marker, and only the record says which span the two differ by. It carries the hidden text
    // on purpose — it ships in the same artifact the raw text does — and the rule name is what
    // makes a substitution legible rather than just visible.
    const { redactions, substitutions } = redact("read .env then postgres://builder:hunter2@db/app");

    // The count and the record are one number: two views of the same list, so they cannot
    // disagree about how much was hidden.
    expect(redactions).toBe(substitutions.length);
    expect(substitutions).toEqual([
      // The URL rule matches up to its `@`, so the span it names is the credential half and not
      // the host — which is what a reader sends to look at the artifact for.
      {
        rule: "url-credentials",
        matched: "postgres://builder:hunter2@",
        replacement: "postgres://<redacted>@",
      },
      { rule: "secret-name", matched: ".env", replacement: "<redacted>" },
    ]);
  });

  it("tells a whole key apart from one pasted truncated, by the rule that caught it", () => {
    // Two rules rather than one, so the record can say which shape it was: a key written out
    // between its markers, or the header alone that a truncated paste leaves behind. A reader who
    // sees `private-key-header` knows the artifact has no end to compare against.
    const whole = redact("-----BEGIN RSA PRIVATE KEY-----\nMIIB\n-----END RSA PRIVATE KEY-----");
    expect(whole.substitutions).toEqual([
      {
        rule: "private-key",
        matched: "-----BEGIN RSA PRIVATE KEY-----\nMIIB\n-----END RSA PRIVATE KEY-----",
        replacement: "<redacted>",
      },
    ]);
    const cut = redact("key: -----BEGIN OPENSSH PRIVATE KEY-----");
    expect(cut.substitutions).toEqual([
      {
        rule: "private-key-header",
        matched: "-----BEGIN OPENSSH PRIVATE KEY-----",
        replacement: "<redacted>",
      },
    ]);
  });

  it("has nothing to record when no rule fired", () => {
    // The near-misses again, from the record's side: a body a reviewer can read unaided must leave
    // an empty record rather than one with an entry that hid nothing.
    const clean = "See https://example.com:8080/guide and ssh://git@github.com/org/repo";
    expect(redact(clean)).toEqual({ text: clean, redactions: 0, substitutions: [] });
  });

  it("records nothing on a second pass, because the marker matches no rule", () => {
    const once = redact("read .env at postgres://u:p@h/db");
    const twice = redact(once.text);

    expect(once.substitutions).toHaveLength(2);
    expect(twice.substitutions).toEqual([]);
    expect(twice.redactions).toBe(0);
  });
});
