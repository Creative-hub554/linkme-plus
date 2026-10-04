#!/usr/bin/env node
/**
 * Preflight before registering the dev server in the Preview tab.
 *
 * ## Why this exists
 *
 * Registering a preview points the app at a live dev server, and every way that
 * can go wrong fails *quietly*: a fresh worktree with no `node_modules` or no
 * `.env.local` starts a server that boots and then 500s on its first query; a
 * dev server started in a *different* checkout is already listening on the same
 * port, so the new one is refused and the URL is registered against somebody
 * else's tree; a `vinext dev` that was killed leaves its lock file behind, so a
 * probe of `127.0.0.1` reports the port closed while the server is in fact
 * serving on IPv6 loopback. Each of those costs a launch attempt and reads like
 * a bug in the app rather than a missing step.
 *
 * This script makes those states loud and cheap to detect, and its exit code is
 * the gate: it is 0 only when every required check passes, so the runbook's
 * "register a preview" step can be "run this, then register". It is deliberately
 * a plain script and not a test — it inspects machine state (a running process,
 * a listening socket) that a test in the suite would have neither the server nor
 * the permission to establish.
 *
 * ## What it checks
 *
 *  1. `node_modules`   — the dependency tree is installed (`vinext` and `next`).
 *  2. `.env.local`     — present, non-empty, and carrying the keys the app reads.
 *                        Key *names* only are reported; values are never read
 *                        into the output.
 *  3. the shell env    — none of those keys is set in the process environment,
 *                        where a stale value shadows `.env.local` (the runbook's
 *                        `DATABASE_URL` gotcha, generalised to every key).
 *  4. the dev lock     — `.vinext/dev/lock.json` exists and parses. That file is
 *                        what `vinext dev` itself writes and reads to refuse a
 *                        second server, so it — not a hand-rolled pid file — is
 *                        the source of truth. A lock that is *absent* is not
 *                        fatal on its own: before the first launch there is no
 *                        lock yet, so when a server already answers on the
 *                        lock's default port this is downgraded to a warning
 *                        and the gate stays 0 (see the reachability pass
 *                        below).
 *  5. the dev server   — the pid in the lock is alive (`process.kill(pid, 0)`,
 *                        the same test vinext uses; a dead pid means a stale lock
 *                        to clear rather than a server to register).
 *  6. the lock's `cwd` — the running server is in *this* checkout and not another
 *                        worktree that happens to be holding the port.
 *  7. reachability     — `http://localhost:<port>/` answers. IPv6 loopback
 *                        (`[::1]`) and IPv4 loopback (`127.0.0.1`) are probed
 *                        separately: the server binds IPv6 loopback, so an
 *                        IPv4-only probe reads as "down" while it is serving.
 *                        A refusing `127.0.0.1` is therefore reported as an
 *                        *expected* note, not a warning — the point is that
 *                        `localhost` and `[::1]` answer.
 *  8. the port's owner — reachability says something answers, never that the
 *                        something is *this* checkout's server. A dev server in
 *                        another checkout answers a probe exactly as happily as
 *                        this one's, and registering that URL points the preview
 *                        at somebody else's tree — the mistake the lock's `cwd`
 *                        check catches one layer up. So the listener that holds
 *                        `:port` is identified and held against the lock: the
 *                        port has to belong to the pid the lock names, or to a
 *                        process whose command line runs out of this checkout.
 *                        Any other owner fails, and is named. The process table
 *                        is read through PowerShell, so where that lookup does
 *                        not exist the check reports that it did not look rather
 *                        than passing on a port nobody vouched for;
 *                        `PREFLIGHT_PORT_OWNER` is the seam the test file drives
 *                        every verdict through, because a test cannot arrange a
 *                        foreign listener portably (`unknown` stands for a
 *                        machine that could not be read).
 *  9. the server's health — the pid in the lock is alive *and* something
 *                        answers. A pid that survives `kill(pid, 0)` is not the
 *                        same as a server that serves: a wedged or mid-restart
 *                        `vinext dev` keeps the lock and answers nothing, and
 *                        the remedy for that is to kill it, not to start
 *                        another (the live lock makes vinext refuse a second
 *                        server). So a dead pid and a live pid that answers
 *                        nothing are told apart, and each names its own fix.
 * 10. the preview tab  — a server that is up while the browser tab that showed
 *                        it is gone is a preview that died mid-session, and no
 *                        amount of probing loopback can see it: this script
 *                        inspects the machine, not the browser. `--tab-state`
 *                        is how the caller hands over what its preview panel
 *                        has open (`[]` for none); with that, "up but no tab"
 *                        is a failure, the mirror case — a tab left on a port
 *                        nothing answers on — is named too, and without it the
 *                        check reports that it was not checked rather than
 *                        passing silently.
 *
 * Usage:
 *   npm run preview:preflight                 # port taken from the lock, else 3000
 *   node .freebuff/preview-preflight.mjs --port 3001
 *   node .freebuff/preview-preflight.mjs --timeout 4000
 *   node .freebuff/preview-preflight.mjs --json   # machine-readable report
 *   node .freebuff/preview-preflight.mjs --only=reach   # gate on matching checks
 *   node .freebuff/preview-preflight.mjs --tab-state='[]'   # diagnose a closed tab
 *   node .freebuff/preview-preflight.mjs --tab-state=.freebuff/tabs.json
 *
 * `--tab-state` takes either the JSON itself (starts with `[` or `{`) or a path
 * to it, in the shape a tab list arrives in — an array, or an object with a
 * `tabs` array, of entries that are a URL string or carry `url` (or `appUrl`).
 * `--tab-state='[]'`
 * therefore means "nothing is open", which is exactly the state this check
 * exists to diagnose.
 *
 * The human report is the default. `--json` replaces it with a single JSON
 * object on stdout — the same per-check statuses plus the final gate — so CI or
 * another tool can consume the result without parsing the formatted lines. The
 * exit code is unchanged either way: 0 only when no check failed.
 *
 * `--only=<check>` (comma-separated; each token matches a check name
 * case-insensitively as a substring) narrows both the report and the gate to the
 * named checks, so a caller can gate on one concern — `--only=reach` for
 * reachability, `--only=.env.local` for the env file, `--only="dev server pid"`
 * for that one check. Checks that do not match are still evaluated but neither
 * appear in the report nor count toward the gate. A selector that matches no
 * check fails loudly rather than passing on an empty gate. The selection is
 * surfaced in the JSON as `only`.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const PROJECT_ROOT = process.cwd();

/** The lock `vinext dev` writes and reads: `<root>/.vinext/dev/lock.json`. */
const LOCK_PATH = join(PROJECT_ROOT, ".vinext", "dev", "lock.json");

/**
 * Env keys the app reads, checked by name only. Taken from the keys in the main
 * checkout's `.env.local`; a missing one is a real "the app will not boot"
 * failure, and a present one in the *shell* is the shadowing hazard.
 */
const REQUIRED_ENV_KEYS = [
  "DATABASE_URL",
  "AUTH_SECRET",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET_NAME",
  "R2_PUBLIC_URL",
  "TOKEN_VALUE",
];

/** The default port, used only when the lock is absent or unreadable. */
const DEFAULT_PORT = 3000;

/**
 * How long the process lookup may take before it is reported as unread. Generous
 * — a PowerShell start is slow on a cold box, and a lookup that gives up early
 * would read as "could not identify" for a port that is perfectly identifiable.
 */
const LOOKUP_TIMEOUT = 15000;

/**
 * The seam the test file drives the owner verdicts through: a process record
 * (`{"pid":123,"commandLine":"…"}`) or the literal `unknown`, standing in for
 * what the machine reports. It exists because the real lookup is a Windows read
 * and a test cannot arrange a foreign listener on every platform; the verdicts it
 * reaches are the same ones a real run reaches, driven from a record instead of
 * from the process table. No run and no sweep sets it.
 */
const ownerSeam = process.env.PREFLIGHT_PORT_OWNER;

/** The seam's record, parsed once: null when it is unset, `unknown`, or no record. */
const ownerSeamRecord = (() => {
  if (ownerSeam === undefined) return null;
  try {
    const parsed = JSON.parse(ownerSeam);
    return typeof parsed?.pid === "number" && parsed.pid > 0 ? parsed : null;
  } catch {
    return null;
  }
})();

function argValue(name) {
  const joined = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (joined !== undefined) return joined.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

const portArg = argValue("--port");
if (portArg !== undefined && !/^\d+$/.test(portArg)) {
  console.error(`preview-preflight: --port must be a number, got ${portArg}`);
  process.exit(1);
}
const timeoutArg = argValue("--timeout");
if (timeoutArg !== undefined && !/^\d+$/.test(timeoutArg)) {
  console.error(`preview-preflight: --timeout must be a number of milliseconds, got ${timeoutArg}`);
  process.exit(1);
}
const PROBE_TIMEOUT = timeoutArg === undefined ? 8000 : Number(timeoutArg);

/** `--json` swaps the human report for a machine-readable one. */
const JSON_OUTPUT = process.argv.includes("--json");

/**
 * `--only=<check>` narrows the report and the gate to the checks whose names
 * match. Tokens match a check name case-insensitively as a substring, so
 * `--only=reach` gates on every reachability check and `--only=dev` on the dev
 * lock and its pid. A selector that matches nothing is a caller error (see the
 * report tail), because gating on no check must never exit 0.
 */
const onlyRaw = argValue("--only");
if (
  (process.argv.includes("--only") || process.argv.includes("--only=")) &&
  (onlyRaw === undefined || onlyRaw.trim() === "")
) {
  console.error("preview-preflight: --only needs at least one check name, e.g. --only=reach");
  process.exit(1);
}
const onlyTokens =
  onlyRaw === undefined
    ? null
    : onlyRaw
        .split(",")
        .map((token) => token.trim().toLowerCase())
        .filter(Boolean);

/** Whether a check named `name` is part of the `--only` selection (all, if unset). */
const matchesOnly = (name) =>
  onlyTokens === null || onlyTokens.some((token) => name.toLowerCase().includes(token));

/**
 * `--tab-state <json|path>`: what the browser has open, which this script cannot
 * discover for itself. It is optional, and its *absence* is reported as an
 * unchecked concern rather than a pass — a check that cannot look must not read
 * as one that looked and found nothing. The value is used as JSON when it starts
 * with `[` or `{`, and as a file path otherwise.
 */
const tabStateArg = argValue("--tab-state");
if (process.argv.includes("--tab-state") && (tabStateArg === undefined || tabStateArg.trim() === "")) {
  console.error(
    "preview-preflight: --tab-state needs the tab list, e.g. --tab-state='[]' or --tab-state=<file>",
  );
  process.exit(1);
}

/**
 * Reads the tab list `--tab-state` names, as JSON. Returns `{ urls }` or
 * `{ error }`; every entry must carry a URL, because an entry with none is a
 * caller mistake that would otherwise read as "no tab on that port".
 */
function readTabState(value) {
  const trimmed = value.trim();
  const inline = trimmed.startsWith("[") || trimmed.startsWith("{");
  const source = inline ? "--tab-state" : resolve(PROJECT_ROOT, value);
  let raw = trimmed;
  if (!inline) {
    try {
      raw = readFileSync(source, "utf8");
    } catch {
      return { error: `the tab state file ${source} could not be read` };
    }
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return { error: `${source} does not parse as JSON (${error.message})` };
  }
  const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.tabs) ? parsed.tabs : null;
  if (list === null) {
    return { error: `${source} is not a tab list (expected an array, or { tabs: [...] })` };
  }
  const urls = [];
  for (const entry of list) {
    const url = typeof entry === "string" ? entry : (entry?.url ?? entry?.appUrl);
    if (typeof url !== "string" || url.trim() === "") {
      return { error: `${source} has an entry with no url` };
    }
    urls.push(url.trim());
  }
  return { urls, source };
}

/**
 * The loopback identity of a URL, for comparing a browser tab with the server
 * the probes reached. `localhost`, `127.0.0.1` and `[::1]` are one machine here
 * — the dev server binds IPv6 loopback while the tab says `localhost` — so they
 * normalise to one key. Anything that is not loopback returns null: a tab
 * pointing at a deployed site is not a tab pointing at *this* preview.
 */
function loopbackKey(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, "");
  if (host !== "localhost" && host !== "127.0.0.1" && host !== "::1") return null;
  // `URL` has already folded the scheme's default port away — `:80` and `:443`
  // both report `""` — and this key is taken on *both* sides of the comparison,
  // so the raw port is the whole key: a tab at `http://localhost/` and a probe at
  // `http://localhost:80/` still come out equal. Filling the default in by hand
  // would change nothing for that case; it would only make an `https://localhost/`
  // tab look like an http preview on :80.
  return { port: parsed.port };
}

/** A process exists if `kill(pid, 0)` survives, or fails with `EPERM` (not ours). */
function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

/** Reads and validates the dev lock the way vinext's own loader does. */
function readLock() {
  let raw;
  try {
    raw = readFileSync(LOCK_PATH, "utf8");
  } catch {
    return { state: "missing" };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { state: "malformed" };
  }
  const shaped =
    typeof parsed?.pid === "number" &&
    typeof parsed?.port === "number" &&
    typeof parsed?.hostname === "string" &&
    typeof parsed?.appUrl === "string" &&
    typeof parsed?.startedAt === "number" &&
    typeof parsed?.cwd === "string";
  return shaped ? { state: "ok", lock: parsed } : { state: "malformed" };
}

/**
 * The pid listening on `port`, or why that could not be read: `{ state: "known",
 * pid }` or `{ state: "unknown", reason }`. Nothing here guesses — a lookup that
 * cannot answer says so, and the caller reports that as a question it did not
 * answer rather than as an all-clear.
 *
 * `netstat` is the read rather than `Get-NetTCPConnection`: the cmdlet takes
 * seconds (2.7s measured against 0.08s here) and this runs on every preflight that
 * gates the owner. The two families are asked separately because Windows' `-p tcp`
 * does not list a listener bound to `[::1]` — which is exactly the family
 * `vinext dev` binds.
 */
function listenerOn(port) {
  if (ownerSeam !== undefined) {
    const raw = ownerSeam.trim();
    if (raw === "unknown") {
      return { state: "unknown", reason: "PREFLIGHT_PORT_OWNER says the machine could not be read" };
    }
    if (ownerSeamRecord !== null) return { state: "known", pid: ownerSeamRecord.pid };
    return { state: "unknown", reason: `PREFLIGHT_PORT_OWNER holds no pid (${raw.slice(0, 60)})` };
  }

  if (process.platform !== "win32") {
    return {
      state: "unknown",
      reason: `no process lookup for ${process.platform} — the port's owner is a Windows read`,
    };
  }

  const pids = new Set();
  for (const protocol of ["tcp", "tcpv6"]) {
    const read = spawnSync("netstat", ["-ano", "-p", protocol], {
      encoding: "utf8",
      timeout: LOOKUP_TIMEOUT,
      windowsHide: true,
    });
    if (read.error || read.status !== 0) {
      return { state: "unknown", reason: `netstat -p ${protocol} did not answer` };
    }
    for (const row of (read.stdout ?? "").split(/\r?\n/)) {
      // `Proto  Local Address  Foreign Address  State  PID`.
      const cells = row.trim().split(/\s+/);
      if (cells.length < 5 || cells[0] !== "TCP" || cells[3].toUpperCase() !== "LISTENING") continue;
      const address = cells[1];
      const bracket = address.lastIndexOf("]");
      // `0.0.0.0:3000` and `[::1]:3001` are the same question asked of two families.
      const localPort =
        bracket === -1 ? address.slice(address.lastIndexOf(":") + 1) : address.slice(bracket + 2);
      if (localPort !== String(port)) continue;
      const pid = Number(cells[4]);
      if (Number.isInteger(pid) && pid > 0) pids.add(pid);
    }
  }
  if (pids.size === 0) {
    return { state: "unknown", reason: `nothing in netstat is listening on :${port}` };
  }
  if (pids.size > 1) {
    return {
      state: "unknown",
      reason: `:${port} has no single owner (pids ${[...pids].join(", ")})`,
    };
  }
  return { state: "known", pid: [...pids][0] };
}

/**
 * What the process with `pid` is running, or why that could not be read:
 * `{ state: "known", commandLine }` or `{ state: "unknown", reason }`. This is the
 * slower half of the read — the process table itself, a PowerShell start — so the
 * caller asks for it only when the pid alone cannot answer, which is to say when
 * the lock does not already name that pid.
 */
function processCommandLine(pid) {
  if (ownerSeam !== undefined) {
    if (typeof ownerSeamRecord?.commandLine === "string" && ownerSeamRecord.commandLine.trim() !== "") {
      return { state: "known", commandLine: ownerSeamRecord.commandLine };
    }
    return { state: "unknown", reason: `PREFLIGHT_PORT_OWNER gives no command line for pid ${pid}` };
  }
  if (process.platform !== "win32") {
    return { state: "unknown", reason: `no process lookup for ${process.platform}` };
  }
  const script =
    `$p = Get-CimInstance Win32_Process -Filter "ProcessId=${pid}" -ErrorAction SilentlyContinue; ` +
    "if ($p) { Write-Output $p.CommandLine }";
  const read = spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], {
    encoding: "utf8",
    timeout: LOOKUP_TIMEOUT,
    windowsHide: true,
  });
  if (read.error || read.status !== 0) {
    return {
      state: "unknown",
      reason: "the Windows process lookup did not answer (powershell, Win32_Process)",
    };
  }
  const line = (read.stdout ?? "").trim();
  if (line === "") {
    return { state: "unknown", reason: `the process table gave no command line for pid ${pid}` };
  }
  return { state: "known", commandLine: line };
}

/**
 * The owner as a failure names it: the pid, and whatever the process table says
 * it is running. A reader who is told "somebody else holds the port" needs to see
 * *who* — the command line is what tells a stray `next` from another worktree's
 * dev server, and a pid alone would leave them guessing which to look at.
 */
function describeOwner(commandLine) {
  const line = typeof commandLine === "string" ? commandLine.trim() : "";
  if (line === "") return "(no command line in the process table)";
  return `(${line.length > 140 ? `${line.slice(0, 139)}…` : line})`;
}

/**
 * Whether a command line runs out of this checkout. This is the only evidence
 * available for a server no lock vouches for — one started by another tool, or by
 * `npm run dev` whose lock was removed while it kept serving — and it is what lets
 * the preflight stay usable before the first launch instead of accusing every
 * server that is not in a lock. Path separators and case are folded because a
 * Windows command line spells a path differently from `process.cwd()`.
 */
function commandLineIsThisCheckout(commandLine) {
  if (typeof commandLine !== "string" || commandLine === "") return false;
  const flat = commandLine.replace(/\\/g, "/").toLowerCase();
  const root = PROJECT_ROOT.replace(/\\/g, "/").replace(/\/$/, "").toLowerCase();
  return flat.includes(root);
}

/** The key names defined by `.env.local`, without ever reading a value. */
function envLocalKeys(text) {
  const keys = new Set();
  for (const line of text.split(/\r?\n/)) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=/.exec(line.trim());
    if (match) keys.add(match[1]);
  }
  return keys;
}

/** One HTTP probe. Any HTTP status counts as reachable — the transport works. */
async function probe(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT);
  const started = Date.now();
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: "manual" });
    return { reachable: true, status: response.status, ms: Date.now() - started };
  } catch (error) {
    const code = error?.cause?.code ?? error?.name ?? String(error);
    return { reachable: false, code, ms: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

/** Formats a started-at timestamp as "how long ago". */
function since(startedAt) {
  const seconds = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
  if (seconds < 90) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `${minutes}m ago`;
  return `${Math.round(minutes / 60)}h ago`;
}

const results = [];
// Every check name seen this run, even ones `--only` filters out, so a selector
// that matches nothing can name what was available.
const seenChecks = [];
const record = (name, status, detail, fix) => {
  const entry = { name, status, detail, fix };
  if (!seenChecks.includes(name)) seenChecks.push(name);
  // A non-selected check is still evaluated but not recorded: it neither shows
  // in the report nor counts toward the gate.
  if (matchesOnly(name)) results.push(entry);
  return entry;
};

// 1. node_modules
{
  const vinextPkg = join(PROJECT_ROOT, "node_modules", "vinext", "package.json");
  const nextPkg = join(PROJECT_ROOT, "node_modules", "next", "package.json");
  if (!existsSync(vinextPkg) || !existsSync(nextPkg)) {
    record(
      "node_modules",
      "fail",
      "not installed (missing vinext and/or next)",
      "npm install --legacy-peer-deps",
    );
  } else {
    let version = "unknown";
    try {
      version = JSON.parse(readFileSync(vinextPkg, "utf8")).version ?? "unknown";
    } catch {
      /* version is cosmetic */
    }
    record("node_modules", "ok", `installed (vinext ${version})`);
  }
}

// 2. .env.local
{
  const envPath = join(PROJECT_ROOT, ".env.local");
  if (!existsSync(envPath)) {
    record(
      ".env.local",
      "fail",
      "missing",
      "copy .env.local from the main checkout (do not symlink)",
    );
  } else if (statSync(envPath).size === 0) {
    record(".env.local", "fail", "present but empty", "copy it again from the main checkout");
  } else {
    const keys = envLocalKeys(readFileSync(envPath, "utf8"));
    const missing = REQUIRED_ENV_KEYS.filter((key) => !keys.has(key));
    if (missing.length > 0) {
      record(
        ".env.local",
        "fail",
        `${missing.length} required key(s) absent: ${missing.join(", ")}`,
        "copy the real .env.local from the main checkout",
      );
    } else {
      record(
        ".env.local",
        "ok",
        `present (${keys.size} keys, all ${REQUIRED_ENV_KEYS.length} required present)`,
      );
    }
  }
}

// 3. shell environment shadowing
{
  const shadowing = REQUIRED_ENV_KEYS.filter((key) => process.env[key] !== undefined);
  if (shadowing.length > 0) {
    record(
      "shell environment",
      "warn",
      `set here and will shadow .env.local: ${shadowing.join(", ")}`,
      "start the server with a clean environment, e.g. Remove-Item Env:DATABASE_URL",
    );
  } else {
    record("shell environment", "ok", "no app key set here, so .env.local wins");
  }
}

// 4-6. the dev lock, its pid, and its checkout
const lock = readLock();
let lockPort = DEFAULT_PORT;
// Holds the "no lock" entry so the reachability pass can decide whether an
// absent lock is fatal (nothing serving) or merely a pre-first-launch warning
// (something already answers). Only the *absent* case is downgraded; a
// malformed lock is a corrupt file and stays a hard failure.
let absentLockEntry = null;
if (lock.state === "missing") {
  absentLockEntry = record(
    "dev lock",
    "fail",
    ".vinext/dev/lock.json is absent",
    "npm run dev (a running server writes it)",
  );
} else if (lock.state === "malformed") {
  record("dev lock", "fail", ".vinext/dev/lock.json does not parse", "remove it and run npm run dev");
} else {
  const info = lock.lock;
  lockPort = info.port;
  record(
    "dev lock",
    "ok",
    `pid ${info.pid}, port ${info.port}, started ${since(info.startedAt)}`,
  );

  if (isPidAlive(info.pid)) {
    record("dev server pid", "ok", `process ${info.pid} is running`);
  } else {
    record(
      "dev server pid",
      "fail",
      `process ${info.pid} is gone (stale lock)`,
      "the next npm run dev takes the stale lock over; or delete .vinext/dev/lock.json",
    );
  }

  const lockCwd = resolve(info.cwd);
  if (lockCwd === resolve(PROJECT_ROOT)) {
    record("lock cwd", "ok", "the server runs from this checkout");
  } else {
    record(
      "lock cwd",
      "fail",
      `the server runs from ${lockCwd}`,
      "start the server from this checkout (or register the other one)",
    );
  }
}

// 7. loopback reachability
const port = portArg === undefined ? lockPort : Number(portArg);
// The lock's pid, read once: the two checks below both want it, and whether the
// probe is aimed at the lock's own port is what makes "nothing answered" a
// statement about *this* server rather than about whatever port was asked for.
const lockPid = lock.state === "ok" ? lock.lock.pid : null;
const lockPidAlive = lockPid !== null && isPidAlive(lockPid);
const probedPortMatchesLock = portArg === undefined || Number(portArg) === lockPort;
const targets = [
  { label: "localhost", url: `http://localhost:${port}/` },
  { label: "IPv6 [::1]", url: `http://[::1]:${port}/` },
  { label: "IPv4 127.0.0.1", url: `http://127.0.0.1:${port}/` },
];
const probes = await Promise.all(targets.map((target) => probe(target.url)));
const anyReachable = probes.some((result) => result.reachable);
const ipv6 = probes[1];
const ipv4 = probes[2];
// A lock that is *held by a live process* while nothing answers on its port. That
// is not the stale-lock case the `dev server pid` check names (a dead pid, which
// the next `npm run dev` takes over) — here the next `npm run dev` is refused,
// because vinext reads this very lock.
const wedged = lockPidAlive && !anyReachable && probedPortMatchesLock;
const reachableIndex = probes.findIndex((result) => result.reachable);
const probeUrl =
  reachableIndex >= 0 ? targets[reachableIndex].url : `http://localhost:${port}/`;
const registerUrl = probeUrl.replace(/\/$/, "");

for (const [index, target] of targets.entries()) {
  const result = probes[index];
  if (result.reachable) {
    record(`reach ${target.label}`, "ok", `${result.ms}ms → ${result.status}`);
  } else if (target.label === "IPv4 127.0.0.1" && ipv6.reachable) {
    // Expected: the dev server binds IPv6 loopback, so this is the probe that
    // reads as "down" while the server is serving. Not a warning.
    record(
      `reach ${target.label}`,
      "info",
      `no answer (${result.code}) — expected: the server binds IPv6 loopback`,
    );
  } else {
    record(`reach ${target.label}`, "warn", `no answer (${result.code})`);
  }
}

if (!anyReachable) {
  record(
    `reach port ${port}`,
    "fail",
    "nothing answered on loopback",
    // Starting another server is not the fix when the lock's own process is
    // still alive: the `dev server health` check below names that case and its
    // remedy, so this line points at it instead of repeating a command that
    // would be refused.
    wedged
      ? "the lock's process is alive but not serving — see the `dev server health` check"
      : "npm run dev, then re-run this preflight",
  );
} else if (!ipv6.reachable && ipv4.reachable) {
  record(
    "loopback family",
    "warn",
    "only IPv4 answered — an IPv4-only probe is the false-negative case the runbook warns about",
  );
}

// 8. the port's owner: a probe says something answers, never that the something
//    is *this* checkout's server. A dev server in another checkout (or any other
//    app that happens to hold the port) answers exactly as happily, and the URL
//    would then point the preview at somebody else's tree — so the listener is
//    identified and held against the lock: the port has to belong to the pid the
//    lock names, or to a process whose command line runs out of this checkout.
//    The lookup costs a subprocess on Windows, so it is only paid for when a
//    check that reads it is selected: a `--only` run that neither shows nor gates
//    the owner has no question for the process table.
const ownerNeeded = matchesOnly("port owner") || matchesOnly("dev server health");
const listing = ownerNeeded && anyReachable ? listenerOn(port) : null;
const ownerPid = listing?.state === "known" ? listing.pid : null;
// A pid the lock already names needs no introduction, so the slower half of the
// read — what that process is running — is only paid for when the pid alone cannot
// answer: a pid that is not the lock's, holding a port the lock does or does not
// describe, or a port no lock vouches for at all.
const ownerIsLockPid = ownerPid !== null && ownerPid === lockPid;
const ownerCommand = ownerPid !== null && !ownerIsLockPid ? processCommandLine(ownerPid) : null;
const ownerRunsThisCheckout =
  ownerCommand?.state === "known" && commandLineIsThisCheckout(ownerCommand.commandLine);
const ownerIsThisCheckout = ownerIsLockPid || ownerRunsThisCheckout;
const ownerDescription = describeOwner(
  ownerCommand?.state === "known" ? ownerCommand.commandLine : null,
);
// A known owner that is not this checkout's, answering on the port under test.
// Nothing here accuses a machine it could not read: an unread process table is a
// question this check did not answer, which is not an answer of "fine".
const answeredByAnother = ownerPid !== null && !ownerIsThisCheckout;

if (ownerNeeded) {
  if (!anyReachable) {
    record(
      "port owner",
      "info",
      `nothing answered on :${port}, so there is no listener to identify (see the reach checks)`,
    );
  } else if (listing.state === "unknown") {
    record("port owner", "info", `could not identify the listener on :${port} — ${listing.reason}`);
  } else if (ownerIsThisCheckout) {
    record(
      "port owner",
      "ok",
      ownerIsLockPid
        ? `the listener on :${port} is pid ${ownerPid}, the process the lock names`
        : `pid ${ownerPid} holds :${port} and runs from this checkout ${ownerDescription}`,
    );
  } else if (ownerCommand.state === "unknown") {
    // The pid is known and something answers through it, but what it runs could not
    // be read, so this checkout cannot say the port is its own. That fails rather
    // than warns: the whole point is not to register a port nobody can vouch for.
    record(
      "port owner",
      "fail",
      `:${port} is held by pid ${ownerPid}, and what that process runs could not be read (${ownerCommand.reason}) — this checkout cannot vouch for the port`,
      `check the pid by hand (tasklist /FI "PID eq ${ownerPid}"), then register only if it is this checkout's server`,
    );
  } else if (lock.state === "ok" && probedPortMatchesLock && lockPidAlive) {
    record(
      "port owner",
      "fail",
      `:${port} is held by pid ${ownerPid} ${ownerDescription}, not by the pid ${lockPid} the lock names`,
      `do not register ${registerUrl}: free :${port}, or run this checkout's server on a port of its own`,
    );
  } else if (lock.state === "ok" && probedPortMatchesLock) {
    record(
      "port owner",
      "fail",
      `:${port} is held by pid ${ownerPid} ${ownerDescription} while the lock's pid ${lockPid} is gone — another process has taken the port the lock names`,
      `do not register ${registerUrl}; npm run dev -- --port <free-port> writes a lock for the server you want`,
    );
  } else if (lock.state === "ok") {
    record(
      "port owner",
      "fail",
      `the lock names pid ${lockPid} on :${lockPort}, but :${port} is held by pid ${ownerPid} ${ownerDescription} — not a port the lock describes`,
      `register the port the lock names, or start this checkout's server on :${port} deliberately`,
    );
  } else {
    record(
      "port owner",
      "fail",
      `:${port} answers from pid ${ownerPid} ${ownerDescription}, and no dev lock in this checkout vouches for a server`,
      `do not register ${registerUrl}: npm run dev writes the lock for this checkout's own server`,
    );
  }
}

// 9. the server's health: a pid that is alive is not a server that serves. A
//    wedged or mid-restart `vinext dev` keeps the lock and answers nothing, and
//    the remedy for that is to kill it — starting another is refused while the
//    lock is held by a live pid, so the stale-lock advice would send the reader
//    in a circle.
if (!lockPidAlive) {
  record(
    "dev server health",
    "info",
    "no live lock pid to check (see the dev lock and dev server pid checks)",
  );
} else if (answeredByAnother) {
  record(
    "dev server health",
    "fail",
    `process ${lockPid} is alive, but :${port} answers from pid ${ownerPid} — the answer is not that process's`,
    "see the `port owner` check: this URL would not be this checkout's server",
  );
} else if (anyReachable) {
  record("dev server health", "ok", `process ${lockPid} is up and serving on :${port}`);
} else if (wedged) {
  record(
    "dev server health",
    "fail",
    `process ${lockPid} is alive and holds the lock, but nothing answers on :${port} ` +
      `(started ${since(lock.lock.startedAt)})`,
    `taskkill /PID ${lockPid} /F, then npm run dev — a live lock makes vinext refuse a second server`,
  );
} else {
  record(
    "dev server health",
    "info",
    `process ${lockPid} is running on :${lockPort}, and :${port} is not its port — nothing to judge`,
  );
}

// 10. the preview tab: a server that is up while the tab showing it is gone is a
//    preview that died mid-session, and no loopback probe can see it — this
//    script inspects the machine, not the browser. `--tab-state` is how the
//    caller hands its open tabs over; without it the check says it did not look
//    rather than reporting a pass it never earned.
if (tabStateArg === undefined) {
  record(
    "preview tab",
    "info",
    "not checked — this script cannot see a browser; pass --tab-state=<json|file> with the open tabs",
  );
} else {
  const tabState = readTabState(tabStateArg);
  if (tabState.error) {
    record("preview tab", "fail", tabState.error, "pass the tab list as JSON, e.g. --tab-state='[]'");
  } else {
    const targetKey = loopbackKey(probeUrl);
    const onThisPort = tabState.urls.filter((url) => {
      const key = loopbackKey(url);
      return key !== null && targetKey !== null && key.port === targetKey.port;
    });
    const listed =
      tabState.urls.length === 0
        ? "no tabs are open"
        : `open: ${tabState.urls.slice(0, 3).join(", ")}` +
          (tabState.urls.length > 3 ? `, +${tabState.urls.length - 3} more` : "");
    if (anyReachable && onThisPort.length > 0) {
      record("preview tab", "ok", `a tab is open on :${port} (${onThisPort[0]})`);
    } else if (anyReachable) {
      record(
        "preview tab",
        "fail",
        `the dev server answers on :${port} but no open tab points at it — ${listed}; the preview tab is gone`,
        `re-open the preview at ${registerUrl} (or register it again)`,
      );
    } else if (onThisPort.length > 0) {
      record(
        "preview tab",
        "warn",
        `tab ${onThisPort[0]} is still open on :${port}, but nothing answers there — the server died behind the tab`,
        "npm run dev, then re-open the preview",
      );
    } else {
      record(
        "preview tab",
        "info",
        `no tab points at :${port} and nothing answers there (see the reach checks)`,
      );
    }
  }
}

// Before the first launch there is no lock for `vinext dev` to have written, yet
// a server can still be healthy and registrable (a server started by another
// tool, or one whose lock was removed while it kept running). When that server
// answers, an absent lock is a warning rather than a gate failure, so this
// preflight is usable before the first launch. With nothing answering, the
// `reach port` failure above already fails the run and the lock stays FAIL.
if (absentLockEntry && anyReachable) {
  absentLockEntry.status = "warn";
  absentLockEntry.detail =
    `.vinext/dev/lock.json is absent, but a server already answers on :${port} ` +
    "(usable before the first launch)";
  absentLockEntry.fix =
    "nothing to do while a server answers; npm run dev writes the lock";
}

// Report
const failures = results.filter((result) => result.status === "fail");
const warnings = results.filter((result) => result.status === "warn");
// A `--only` that matched nothing is a caller error, not a passing gate: gating
// on no check must never exit 0, so it fails like any failed check.
const noMatch = onlyTokens !== null && results.length === 0;
const noMatchMessage =
  `preview-preflight: --only=${onlyTokens?.join(",")} matched no check` +
  (seenChecks.length > 0 ? ` (checks here: ${seenChecks.join(", ")})` : "");
const exitCode = noMatch || failures.length > 0 ? 1 : 0;
// A `--only` that filtered reachability out did not verify a server, so a gate
// pass must not advertise a register URL it never confirmed is answering.
const reachGated = results.some(
  (result) => result.name.startsWith("reach ") && result.status === "ok",
);

// `--json`: the same statuses plus the gate, as one object on stdout, and the
// same exit code. The human report below is skipped entirely. `only` carries the
// check selector (null when unset) so a consumer can tell what was gated.
if (JSON_OUTPUT) {
  const payload = {
    projectRoot: PROJECT_ROOT,
    port,
    gate: exitCode === 0 ? "pass" : "fail",
    exitCode,
    only: onlyTokens,
    ...(noMatch ? { error: noMatchMessage } : {}),
    registerUrl: exitCode === 0 && (onlyTokens === null || reachGated) ? registerUrl : null,
    pid: lockPid,
    failures: failures.map((result) => result.name),
    warnings: warnings.map((result) => result.name),
    checks: results.map((result) => ({
      name: result.name,
      status: result.status,
      detail: result.detail,
      ...(result.fix ? { fix: result.fix } : {}),
    })),
  };
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  process.exit(exitCode);
}

if (noMatch) {
  console.error(`\n${noMatchMessage}`);
  process.exit(1);
}

const width = Math.max(...results.map((result) => result.name.length));
const MARK = { ok: "OK  ", warn: "WARN", info: "INFO", fail: "FAIL" };
console.log(
  `preview-preflight: ${PROJECT_ROOT}${onlyTokens ? ` (gating only: ${onlyTokens.join(", ")})` : ""}\n`,
);
for (const result of results) {
  console.log(`  ${MARK[result.status]}  ${result.name.padEnd(width)}  ${result.detail}`);
  if (result.fix && result.status !== "ok" && result.status !== "info") {
    console.log(`        ${" ".repeat(width)}  fix: ${result.fix}`);
  }
}

if (failures.length > 0) {
  console.error(
    `\npreview-preflight: ${failures.length} check(s) failed — do not register a preview yet.`,
  );
  process.exit(1);
}

if (onlyTokens) {
  // The reachability checks may have been filtered out, so a pass here is not a
  // registrable preview — say so rather than claiming readiness.
  console.log(
    `\npreview-preflight: gate passed for --only=${onlyTokens.join(",")} ` +
      `(${results.length} check(s)${warnings.length > 0 ? `, ${warnings.length} warning(s)` : ""}). ` +
      "This does not confirm a registrable preview — drop --only to gate on that.",
  );
} else {
  console.log(
    `\npreview-preflight: ready to register ${registerUrl}` +
      ` (pid ${lockPid ?? "unknown"}` +
      `${warnings.length > 0 ? `, ${warnings.length} warning(s)` : ""}).`,
  );
}
