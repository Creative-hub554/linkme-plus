/**
 * One definition of "a secret that must not be published", shared by the runner
 * (`ci.mjs`), the nightly report (`nightly-report.mjs`) and the comment poster
 * (`pr-comment.mjs`).
 *
 * All three write artifacts a person can read: `ci.mjs --explain-cache` names the files
 * behind each cache key, a failing stage's details name the files that failed, the nightly
 * job uploads the run's JSON next to its Markdown summary, and the poster puts a rendered
 * report on a *pull request*, which is the widest audience of the four. A secret is exactly
 * what none of them may carry, and there are two ways one gets in: a secret-looking **name**
 * (never its contents, which no writer here reads) and the two **values** a secret has when
 * it is written into prose at all — a URL with credentials in its userinfo, and a private key
 * written out between its markers. One module rather than a copy in each writer means the
 * four cannot come to disagree about what counts as secret.
 *
 * `redact` also returns a **record** of each substitution beside the count, because one of those
 * writers has to file what it removed rather than only say how much: the poster writes it next to
 * the body it scrubbed, so a reviewer can walk the `<redacted>` markers in the comment back to the
 * artifact that holds the raw text. The rule names below are what that record quotes.
 *
 * And the vocabulary has a second, softer half: `suspectTokens` finds the runs that look like a
 * generated key and are claimed by no rule at all. They are **not** hidden — a shape this module
 * cannot be sure of is exactly the wrong thing to collapse — they are handed back so a writer can
 * warn a person. Same question as the rules above (*is this a secret?*), opposite answer when the
 * answer is *I do not know*.
 */

/**
 * A basename that names a secret rather than the code that reads it. The list is
 * deliberately generous — a name wrongly hidden costs a reader one lookup, while a
 * name wrongly shown is a credential published in a CI log — and `.env` and its
 * variants, the names a `.gitignore` keeps out of the repo on purpose, are the case
 * that matters most here.
 */
export const SECRET_INPUT =
  /^(?:\.env(?:\..+)?|\.npmrc|\.netrc|\.dev\.vars|\.htpasswd|credentials(?:\..+)?|id_(?:rsa|ed25519|ecdsa)|.+\.(?:pem|key|p12|pfx|jks|keystore))$/i;

/** The marker that stands in for a secret-looking name. */
export const REDACTED_INPUT = "<redacted>";

/** Whether a path's own file name is the secret. */
export function isSecretInput(name) {
  const text = String(name ?? "");
  return SECRET_INPUT.test(text.slice(text.lastIndexOf("/") + 1));
}

/**
 * The publishable name for one path. A trailing `:line` or `:line:col` — the form a
 * survivor or a finding is named in — is kept, so a redacted location still points at
 * a line while saying nothing about which file: the path is what is secret, not where
 * in it the trouble is.
 */
export function redactInput(name) {
  const text = String(name ?? "");
  const match = /^(.*?)(:\d+(?::\d+)?)?$/.exec(text);
  const path = match?.[1] ?? text;
  const suffix = match?.[2] ?? "";
  return isSecretInput(path) ? `${REDACTED_INPUT}${suffix}` : text;
}

/**
 * The publishable names for a list: each redacted, then every run of redacted names
 * collapsed to one — how *many* secret files there are is itself a small thing not to
 * publish, and `<redacted>` once says the same as a dozen.
 */
export function redactInputs(names) {
  const out = [];
  for (const name of names ?? []) {
    const redacted = redactInput(name);
    if (redacted !== REDACTED_INPUT || !out.includes(REDACTED_INPUT)) out.push(redacted);
  }
  return out;
}

/**
 * The value-shaped secrets, each with the name of its rule and the replacement it writes, in
 * the order they are applied.
 *
 * A name is most of what there is to catch in a report about *files*; these are the shapes
 * that carry a secret with no file name at all, and they matter because one of this module's
 * writers publishes prose rather than paths. Values are applied before names, because the
 * name pass reads its way through the same text and a URL has to be collapsed as a whole or
 * its host would be left looking like a token a rule had matched.
 *
 * The name is not decoration: `redact` returns a record of what it replaced, and a record that
 * said only “something was hidden here” would leave its reader to guess which rule fired. These
 * are the names that record quotes, and the names the tests pin.
 *
 * Deliberately **not** a table of provider prefixes (`ghp_`, `sk-`, `AKIA…`). Such a list is
 * one release out of date the day it is written, and a reader who sees it starts trusting it
 * for the keys it does not name; a rule that is certain reads better than a table that is
 * hopeful. What is here is the two shapes an artifact has no legitimate reason to contain.
 */
const SECRET_VALUES = [
  // `scheme://user:password@host` — the userinfo is the secret half, and the scheme and host
  // are kept so a reader can see *what* was redacted rather than only that something was.
  // `ssh://git@host` has no colon before its `@` and is left alone, as is a bare `host:port`
  // and a `mailto:user@host`: none of them carries a credential, and hiding ordinary text
  // for no gain is its own kind of lie.
  ["url-credentials", /(\w[\w+.-]*:\/\/)[^\s/:@]+:[^\s/@]+@/g, `$1${REDACTED_INPUT}@`],
  // A key written out in full, and the header alone for one pasted truncated — which is the
  // shape a log or a truncated report actually tends to catch. Two rules rather than one, so
  // the record can tell a whole key from a paste that lost its end.
  [
    "private-key",
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    REDACTED_INPUT,
  ],
  ["private-key-header", /-----BEGIN [A-Z ]*PRIVATE KEY-----/g, REDACTED_INPUT],
];

/** The name the token pass records when a path-shaped token turns out to name a secret. */
const NAME_RULE = "secret-name";

/**
 * The shortest run worth a second look.
 *
 * The floor is where a key and a word stop being distinguishable by length alone: below it an
 * ordinary identifier overlaps a generated one, and a short token cannot carry enough entropy for
 * the measure below to tell them apart (`log2(20)` bits per character is the ceiling for a
 * twenty-character run, which several ordinary identifiers reach).
 */
export const SUSPECT_MIN_LENGTH = 24;

/**
 * The bits per character a run has to reach, measured the way Shannon measures it.
 *
 * Chosen from the data rather than from taste, and the margin is thin — every number here is a
 * trade, and `suspectTokens` says which way it was taken. Four bits is where a random run of this
 * length lands (a long, well-mixed key reaches five or more) and where a long identifier made of
 * words sits just under (four of them measured between 4.0 and 4.3, which is why entropy alone is
 * not the whole rule).
 */
export const SUSPECT_MIN_ENTROPY = 4;

/** The runs a *suspect* can be made of: characters a key and a word are both written in. */
const SUSPECT_RUN = new RegExp(`[A-Za-z0-9]{${SUSPECT_MIN_LENGTH},}`, "g");

/** Shannon entropy, in bits per character, of `text`. */
function entropyOf(text) {
  const counts = new Map();
  for (const character of text) counts.set(character, (counts.get(character) ?? 0) + 1);
  let bits = 0;
  for (const count of counts.values()) {
    const share = count / text.length;
    bits -= share * Math.log2(share);
  }
  return bits;
}

/**
 * The runs in `text` that look like a generated key and are claimed by no rule: what the rules
 * cannot be sure about, handed back rather than hidden.
 *
 * **This does not redact, on purpose.** The rules above are certain, and a certain match is safe to
 * collapse; a *shape* is not, and hiding an ordinary word costs more than it saves — it teaches the
 * reader that `<redacted>` sometimes means nothing. So a suspect is returned for a writer to warn
 * about, which is the honest answer to “I think this may be a secret” as against “this is one”.
 *
 * Four conditions, and each exclusion is the design rather than an accident:
 *
 *   - **Long enough** (`SUSPECT_MIN_LENGTH`), so an ordinary identifier is not mistaken for a key
 *     on length alone.
 *   - **Both cases and a digit.** Random runs mix cases; hex — the shape this repository's own
 *     reports are full of (git hashes, digests, the drift alarm's sha1s) — does not, and a UUID or
 *     a lowercase blob has neither, so a body quoting a *hash* is quiet while a body quoting a
 *     *key* is not. It is the one deliberate blind spot: a hex-encoded secret and a commit id are
 *     the same shape, and warning on every digest would train its reader to ignore the warning.
 *   - **Digits through the letters, not at the end.** This is the condition that earns its keep: a
 *     generated key interleaves them (`ghpA1b2C3d4…`), while a word carrying a year puts them
 *     trailing (`CollectBudgetProposal2026`), and long identifiers of that kind measure 4.0-4.3
 *     bits — at or above the entropy floor, so entropy alone cannot separate them. Interleaving
 *     can.
 *   - **High entropy** (`SUSPECT_MIN_ENTROPY`) on top of all three, which is what rejects a run
 *     that merely has the right punctuation, such as a repeated-word placeholder
 *     (`AKIAIOSFODNN7EXAMPLE` measures 3.7).
 *
 * What it still cannot do is the honest limit of the whole idea: a base64 blob of ordinary words
 * (`Zm9vYmFy…`) and a base64 API key are the same shape, and both are flagged. The warning is
 * sized for that: it costs a reader one look, where a wrong redaction would cost them the habit of
 * trusting the marker.
 *
 * @param {string} text
 * @returns {string[]} the runs, in the order they appear, without duplicates removed (a token
 *   repeated in a body is one thing to check, but two places to look at).
 */
export function suspectTokens(text) {
  const out = [];
  for (const run of String(text ?? "").match(SUSPECT_RUN) ?? []) {
    if (!/[a-z]/.test(run) || !/[A-Z]/.test(run) || !/\d/.test(run)) continue;
    if (!/\d[A-Za-z]/.test(run)) continue;
    if (entropyOf(run) < SUSPECT_MIN_ENTROPY) continue;
    out.push(run);
  }
  return out;
}

/**
 * The publishable text, how many substitutions it took, and a record of each one.
 *
 * The count exists for a writer that has to *say* something was hidden: the comment poster
 * puts a note on the run page when a body had to be scrubbed, and a count is what lets it say
 * how much without naming what was removed — naming it *there* would publish the thing it just
 * hid. `redactions` is `substitutions.length`; one number, so the two cannot disagree.
 *
 * The record is the other half, and it is for the opposite reader. A reviewer holding the posted
 * comment in one hand and the run's artifact in the other can see that a `<redacted>` stands
 * where something was, but not *what*; the record says which rule fired, the exact span it
 * replaced and what it wrote instead, so the pair can be walked substitution by substitution.
 * It carries the hidden text, which is why the poster files it *beside the body* rather than on
 * the pull request or the run page: it belongs where the raw text it maps already is, and no
 * wider. The order is the order applied, so it reads in step with the text.
 *
 * `redactText` is this function for the callers that only want the text.
 *
 * Idempotent: `redact(redact(text).text).text` is `redact(text).text`, and the second record is
 * empty. Nothing here matches the marker it writes, which is the property that makes the
 * function safe to apply to text that has already been through it.
 *
 * @param {string} text
 * @returns {{ text: string, redactions: number, substitutions: { rule: string, matched: string,
 *   replacement: string }[] }}
 */
export function redact(text) {
  const substitutions = [];
  const values = SECRET_VALUES.reduce((out, [rule, pattern, replacement]) => {
    return out.replace(pattern, (...args) => {
      // The replacement carries `$1` — the scheme — so it is expanded by hand here: passing
      // a callback to `replace` is the one form in which `$1` is not substituted for you.
      const written = replacement.replace("$1", args[1] ?? "");
      substitutions.push({ rule, matched: args[0], replacement: written });
      return written;
    });
  }, String(text ?? ""));
  const scrubbed = values.replace(/[\w.@/-]+/g, (token) => {
    if (!isSecretInput(token)) return token;
    substitutions.push({ rule: NAME_RULE, matched: token, replacement: REDACTED_INPUT });
    return REDACTED_INPUT;
  });
  return { text: scrubbed, redactions: substitutions.length, substitutions };
}

/**
 * The publishable form of a line of prose or tool output: every path-shaped token —
 * a bare name, a `dir/file`, a name with a `:line` suffix — whose file name is the
 * secret is collapsed in place, so a message that quotes a secret-looking path is
 * scrubbed too, and so is a URL carrying credentials or a private key written out.
 * Anything that is not one of those is left exactly as it was. This is `redact(text).text`,
 * for the callers that do not need the count.
 */
export function redactText(text) {
  return redact(text).text;
}
