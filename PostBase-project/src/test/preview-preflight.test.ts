/// <reference types="vite/client" />
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The real preflight, driven for real.
 *
 * The two death modes this file holds are the ones a machine check cannot see by
 * looking at the lock alone: a lock whose pid is alive while nothing serves, and
 * a server that is up while the browser tab that showed it is gone. Neither can
 * be faked past the script — the pid is this test process's own, and the server
 * is a listener this file opened — so the assertions are about the script's own
 * reasoning rather than about a stub of it.
 *
 * Nothing here starts, stops or touches the development server a preview would be
 * registered against: a scratch lock lives in a temp directory and the one
 * reachable server is an in-process stub on an ephemeral port.
 */
const projectRoot = fileURLToPath(new URL("../..", import.meta.url));
const preflight = path.join(projectRoot, ".freebuff", "preview-preflight.mjs");

/** The slice of the `--json` payload these cases read. */
interface PreflightPayload {
  gate: "pass" | "fail";
  exitCode: number;
  only: string[] | null;
  registerUrl: string | null;
  failures: string[];
  warnings: string[];
  checks: { name: string; status: string; detail: string; fix?: string }[];
}

/**
 * Runs the real preflight in `cwd` and parses the JSON object it always writes.
 *
 * Asynchronous on purpose: `spawnSync` would block this worker's event loop, and
 * the stub server the tab cases probe lives on it — a synchronous run would time
 * out against a server that is listening and simply never gets scheduled.
 */
function runPreflight(
  args: string[],
  cwd: string = projectRoot,
  env: Record<string, string> = {},
) {
  return new Promise<{
    result: { status: number | null; stdout: string; stderr: string };
    payload: PreflightPayload;
  }>((resolve, reject) => {
    const child = spawn(process.execPath, [preflight, "--json", "--timeout", "700", ...args], {
      cwd,
      env: { ...process.env, ...env },
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (status) => {
      resolve({
        result: { status, stdout, stderr },
        payload: JSON.parse(stdout) as PreflightPayload,
      });
    });
  });
}

/** One check by name; the name is the contract `--only` selects on. */
const checkNamed = (payload: PreflightPayload, name: string) =>
  payload.checks.find((entry) => entry.name === name);

/** A port nothing is listening on: bound to learn it, then released. */
async function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createNetServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      server.close(() => resolvePort(port));
    });
  });
}

/**
 * A throwaway HTTP server this file owns, on an ephemeral port: something that
 * genuinely answers, so the health check can be driven down its healthy branch
 * without going anywhere near the server a preview would be registered against.
 * The caller closes it.
 */
async function startStubServer() {
  const server = createHttpServer((_request, response) => {
    response.statusCode = 200;
    response.end("ok");
  });
  await new Promise<void>((ready, reject) => {
    server.once("error", reject);
    server.listen(0, () => ready());
  });
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  return {
    port,
    close: () => new Promise<void>((closed) => server.close(() => closed())),
  };
}

/**
 * A server this test file started, in a child process of its own: a `-e` script that
 * answers on an ephemeral port, and — when `namesPath` is given — carries that path
 * as an argument, so its command line names it. That is both shapes the owner check
 * has to tell apart: a command line with no path of ours in it (the hazard — another
 * checkout's app, or any other process, holding the port) and one that names this
 * checkout (a server started another way, which the preflight must still accept).
 */
async function startChildServer(namesPath = ""): Promise<{ pid: number; port: number; stop: () => void }> {
  const script = [
    "const http = require('node:http');",
    "const server = http.createServer((_req, res) => { res.statusCode = 200; res.end('ok'); });",
    "server.listen(0, () => process.stdout.write(String(server.address().port)));",
  ].join("");
  const child = spawn(process.execPath, ["-e", script, ...(namesPath === "" ? [] : [namesPath])], {
    cwd: tmpdir(),
    stdio: ["ignore", "pipe", "ignore"],
  });
  const port = await new Promise<number>((resolvePort, reject) => {
    child.stdout?.setEncoding("utf8").on("data", (chunk: string) => resolvePort(Number(chunk)));
    child.once("error", reject);
  });
  return { pid: child.pid ?? 0, port, stop: () => child.kill() };
}

/**
 * Whether this machine can be asked who holds a port — the same question the owner
 * check asks it. Windows always can; a POSIX machine needs `lsof` or Linux's `ss`.
 * Where neither exists the check reports that it did not look rather than passing,
 * so the cases that assert a *verdict* from the real read are skipped there instead
 * of failed — the seam cases above cover the reasoning on every platform.
 */
function processTableReadable(): boolean {
  if (process.platform === "win32") return true;
  return ["lsof", "ss"].some(
    (tool) => spawnSync(tool, ["-h"], { stdio: "ignore" }).error === undefined,
  );
}

const cleanup: string[] = [];

/**
 * A scratch checkout whose dev lock says whatever the case under test needs. The
 * lock's `cwd` is this directory, so the script sees a server that runs from the
 * checkout it was told to inspect.
 */
function scratchCheckout(lock: Record<string, unknown> | null): string {
  const dir = mkdtempSync(path.join(tmpdir(), "preview-preflight-"));
  cleanup.push(dir);
  if (lock !== null) {
    mkdirSync(path.join(dir, ".vinext", "dev"), { recursive: true });
    writeFileSync(
      path.join(dir, ".vinext", "dev", "lock.json"),
      JSON.stringify({ hostname: "localhost", startedAt: Date.now(), cwd: dir, ...lock }),
    );
  }
  return dir;
}

/** A pid that is genuinely gone: a process spawned and already reaped. */
function deadPid(): number {
  return spawnSync(process.execPath, ["-e", ""]).pid ?? 0;
}

afterAll(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

describe("the preflight's read of a lock held by a process that is alive and not serving", () => {
  it("calls it wedged and names killing that process, not starting another", async () => {
    const port = await freePort();
    const dir = scratchCheckout({
      pid: process.pid,
      port,
      appUrl: `http://localhost:${port}`,
    });
    const { result, payload } = await runPreflight(
      ["--port", String(port), "--only=dev server health"],
      dir,
    );

    expect(payload.only).toEqual(["dev server health"]);
    expect(payload.gate).toBe("fail");
    expect(result.status).toBe(1);

    const health = checkNamed(payload, "dev server health");
    expect(health?.status).toBe("fail");
    // The pid is this very test process, so the lock is genuinely held.
    expect(health?.detail).toContain(`process ${process.pid} is alive`);
    expect(health?.detail).toContain(`nothing answers on :${port}`);
    // The remedy must be the one that works while the lock is held: `npm run dev`
    // would be refused, so the fix is to kill the wedged process first.
    expect(health?.fix).toContain(`taskkill /PID ${process.pid} /F`);
    expect(health?.fix).toContain("npm run dev");
  });

  it("keeps the stale-lock advice for a dead pid, so the two cases are told apart", async () => {
    const port = await freePort();
    const dir = scratchCheckout({
      pid: deadPid(),
      port,
      appUrl: `http://localhost:${port}`,
    });
    const { payload } = await runPreflight(
      ["--port", String(port), "--only=dev server pid,dev server health"],
      dir,
    );

    const pid = checkNamed(payload, "dev server pid");
    const health = checkNamed(payload, "dev server health");
    expect(pid?.status).toBe("fail");
    expect(pid?.detail).toContain("stale lock");
    expect(pid?.fix).toContain("takes the stale lock over");
    // A dead pid is not a wedged server: no kill, and the health check does not
    // accuse a process that is not there.
    expect(pid?.fix).not.toContain("taskkill");
    expect(health?.status).toBe("info");
    expect(health?.detail).toContain("no live lock pid");
  });

  it("does not judge a running server when the probe was aimed at another port", async () => {
    const lockPort = await freePort();
    const probed = await freePort();
    const dir = scratchCheckout({
      pid: process.pid,
      port: lockPort,
      appUrl: `http://localhost:${lockPort}`,
    });
    const { payload } = await runPreflight(
      ["--port", String(probed), "--only=dev server health"],
      dir,
    );

    // The lock's server was never probed, so "nothing answered" on `probed` says
    // nothing about it — and must not read as a wedged server.
    const health = checkNamed(payload, "dev server health");
    expect(health?.status).toBe("info");
    expect(health?.detail).toContain(`running on :${lockPort}`);
    expect(health?.detail).toContain(`:${probed} is not its port`);
    expect(payload.gate).toBe("pass");
  });

  it("points the reach failure at the health check, not at a launch that would be refused", async () => {
    const port = await freePort();
    const dir = scratchCheckout({
      pid: process.pid,
      port,
      appUrl: `http://localhost:${port}`,
    });
    const { payload } = await runPreflight(["--port", String(port), "--only=reach port"], dir);

    // The server is wedged, so `npm run dev` is not the remedy for the failed
    // probe: vinext reads the live lock and refuses a second server. The fix has
    // to send the reader to the check that names the kill instead.
    const reach = checkNamed(payload, `reach port ${port}`);
    expect(reach?.status).toBe("fail");
    expect(reach?.fix).toContain("dev server health");
    expect(reach?.fix).not.toContain("npm run dev");
  });
});

describe("the preflight's read of a lock held by a process that is alive and serving", () => {
  it("passes, so the wedged remedy never fires for a server that answers", async () => {
    const stub = await startStubServer();
    try {
      const dir = scratchCheckout({
        pid: process.pid,
        port: stub.port,
        appUrl: `http://localhost:${stub.port}`,
      });
      const { payload } = await runPreflight(
        ["--port", String(stub.port), "--only=dev server health"],
        dir,
      );

      // The mirror of the wedged case, and the reason its verdict can be
      // trusted: a live pid whose own port answers is a healthy server.
      const health = checkNamed(payload, "dev server health");
      expect(health?.status).toBe("ok");
      expect(health?.detail).toContain(
        `process ${process.pid} is up and serving on :${stub.port}`,
      );
      expect(health?.fix).toBeUndefined();
      expect(payload.gate).toBe("pass");
    } finally {
      await stub.close();
    }
  });
});

describe("the preflight's read of who holds the port", () => {
  /**
   * The verdicts below rest on what the machine's process table says, and a test
   * cannot arrange a foreign listener portably — so the record is handed over
   * through `PREFLIGHT_PORT_OWNER`, the way `--tab-state` hands over the tabs. What
   * is exercised is the script's own reasoning about an owner, and the real lookup
   * is pinned separately, below.
   */
  const ownership = (owner: Record<string, unknown> | "unknown") => ({
    PREFLIGHT_PORT_OWNER: typeof owner === "string" ? owner : JSON.stringify(owner),
  });

  it("reads the lock's own pid as this checkout's server, so the owner check is not always red", async () => {
    const stub = await startStubServer();
    try {
      const dir = scratchCheckout({
        pid: process.pid,
        port: stub.port,
        appUrl: `http://localhost:${stub.port}`,
      });
      // No command line at all: with nothing but the pid, the lock's own record is
      // the only thing that can make this server this checkout's.
      const { payload } = await runPreflight(
        ["--port", String(stub.port), "--only=port owner"],
        dir,
        ownership({ pid: process.pid }),
      );

      const owner = checkNamed(payload, "port owner");
      expect(owner?.status).toBe("ok");
      expect(owner?.detail).toContain(`the listener on :${stub.port} is pid ${process.pid}`);
      expect(owner?.detail).toContain("the process the lock names");
      expect(owner?.fix).toBeUndefined();
      expect(payload.gate).toBe("pass");
    } finally {
      await stub.close();
    }
  });

  it("fails a port that answers from another checkout, and names the process holding it", async () => {
    const stub = await startStubServer();
    const foreign = {
      pid: 35224,
      commandLine:
        '"C:\\Program Files\\nodejs\\node.exe" C:\\Workspace\\Base88\\node_modules\\next\\dist\\server\\lib\\start-server.js',
    };
    try {
      const dir = scratchCheckout({
        pid: process.pid,
        port: stub.port,
        appUrl: `http://localhost:${stub.port}`,
      });
      const { result, payload } = await runPreflight(
        ["--port", String(stub.port), "--only=port owner"],
        dir,
        ownership(foreign),
      );

      // The whole point: something answers, and it is not this checkout's server.
      // "Named" is part of the verdict, so the pid and the command line are both
      // asserted — a reader has to be told *who* took the port, not only that it went.
      const owner = checkNamed(payload, "port owner");
      expect(owner?.status).toBe("fail");
      expect(owner?.detail).toContain(`pid ${foreign.pid}`);
      expect(owner?.detail).toContain("Base88");
      expect(owner?.detail).toContain(`not by the pid ${process.pid} the lock names`);
      expect(owner?.fix).toContain("do not register");
      expect(payload.failures).toContain("port owner");
      // A failing gate advertises no register URL at all.
      expect(payload.registerUrl).toBeNull();
      expect(result.status).toBe(1);
    } finally {
      await stub.close();
    }
  });

  it("accepts a server this checkout started that no lock names", async () => {
    const stub = await startStubServer();
    try {
      // The documented "usable before the first launch" state: a server started by
      // another tool, or one whose lock was removed while it kept serving. Without
      // a lock, where the process runs from is the only evidence there is.
      const dir = scratchCheckout(null);
      const { payload } = await runPreflight(
        ["--port", String(stub.port), "--only=port owner"],
        dir,
        ownership({
          pid: 4242,
          commandLine: `"node" "${path.join(dir, "node_modules", "vinext", "dist", "cli.js")}" dev`,
        }),
      );

      const owner = checkNamed(payload, "port owner");
      expect(owner?.status).toBe("ok");
      expect(owner?.detail).toContain(`pid 4242 holds :${stub.port} and runs from this checkout`);
      expect(payload.gate).toBe("pass");
    } finally {
      await stub.close();
    }
  });

  it("has no listener to identify when nothing answers, rather than failing the port", async () => {
    const port = await freePort();
    const dir = scratchCheckout({ pid: process.pid, port, appUrl: `http://localhost:${port}` });
    const { payload } = await runPreflight(
      ["--port", String(port), "--only=port owner"],
      dir,
    );

    // Nothing is listening, so there is nobody to accuse: the reach checks are the
    // ones that fail. A check that invented an owner here would be worse than none.
    const owner = checkNamed(payload, "port owner");
    expect(owner?.status).toBe("info");
    expect(owner?.detail).toContain("no listener to identify");
    expect(payload.failures).not.toContain("port owner");
    expect(payload.gate).toBe("pass");
  });

  it("says it could not identify the listener rather than passing", async () => {
    const stub = await startStubServer();
    try {
      const dir = scratchCheckout({
        pid: process.pid,
        port: stub.port,
        appUrl: `http://localhost:${stub.port}`,
      });
      const { payload } = await runPreflight(
        ["--port", String(stub.port), "--only=port owner"],
        dir,
        ownership("unknown"),
      );

      // A machine this script cannot read is a question it did not answer — which
      // must not read as an answer of "fine".
      const owner = checkNamed(payload, "port owner");
      expect(owner?.status).toBe("info");
      expect(owner?.detail).toContain(`could not identify the listener on :${stub.port}`);
      expect(payload.failures).not.toContain("port owner");
      expect(payload.gate).toBe("pass");
    } finally {
      await stub.close();
    }
  });

  it("fails a port it cannot vouch for when the process table will not say what runs on the port", async () => {
    const stub = await startStubServer();
    try {
      const dir = scratchCheckout({
        pid: process.pid,
        port: stub.port,
        appUrl: `http://localhost:${stub.port}`,
      });
      // A pid, and nothing else: something answers through a process whose command
      // line could not be read. That must not pass as this checkout's server merely
      // because a server is answering — the port is one nobody can vouch for.
      const { payload } = await runPreflight(
        ["--port", String(stub.port), "--only=port owner"],
        dir,
        ownership({ pid: 4242 }),
      );

      const owner = checkNamed(payload, "port owner");
      expect(owner?.status).toBe("fail");
      expect(owner?.detail).toContain(`pid 4242`);
      expect(owner?.detail).toContain("could not be read");
      expect(owner?.fix).toContain("tasklist /FI \"PID eq 4242\"");
      expect(payload.gate).toBe("fail");
    } finally {
      await stub.close();
    }
  });

  it("does not call another process's port the lock's server", async () => {
    const stub = await startStubServer();
    try {
      const dir = scratchCheckout({
        pid: process.pid,
        port: stub.port,
        appUrl: `http://localhost:${stub.port}`,
      });
      const { payload } = await runPreflight(
        ["--port", String(stub.port), "--only=dev server health"],
        dir,
        ownership({ pid: 35224, commandLine: '"node" "C:/Workspace/Base88/next.js"' }),
      );

      // The health line said "up and serving" for a process that is not the one
      // serving — the one claim this check must not make.
      const health = checkNamed(payload, "dev server health");
      expect(health?.status).toBe("fail");
      expect(health?.detail).toContain(`process ${process.pid} is alive`);
      expect(health?.detail).toContain("answers from pid 35224");
      expect(health?.fix).toContain("port owner");
      expect(payload.failures).toContain("dev server health");
    } finally {
      await stub.close();
    }
  });

  it.runIf(processTableReadable())(
    "identifies the process holding the port on this machine, and fails when it is not this checkout's",
    async () => {
      // The one case the seam cannot stand in for: the real process lookup, against a
      // listener that genuinely belongs to somebody else. This is also what pins each
      // platform's own read — the sweep's mutations are all in the shared verdict
      // logic, because an anchor inside one platform's read would survive on the other.
      const foreign = await startChildServer();
      try {
        const dir = scratchCheckout({
          pid: process.pid,
          port: foreign.port,
          appUrl: `http://localhost:${foreign.port}`,
        });
        const { payload } = await runPreflight(
          ["--port", String(foreign.port), "--only=port owner"],
          dir,
        );

        const owner = checkNamed(payload, "port owner");
        expect(owner?.status).toBe("fail");
        expect(owner?.detail).toContain(`pid ${foreign.pid}`);
        expect(payload.gate).toBe("fail");
      } finally {
        foreign.stop();
      }
      // Two child processes and a process-table read: slow enough on a loaded box
      // that the default budget is not a statement about the check.
    },
    30_000,
  );

  it.runIf(processTableReadable())(
    "accepts a server this machine can see running out of this checkout, with no lock naming it",
    async () => {
      // The mirror of the case above, through the same real read: a server the
      // preflight did not start and no lock names, whose command line says it runs
      // out of this checkout. It must be accepted, or the documented "usable before
      // the first launch" state would fail on the machine it was written for.
      const dir = scratchCheckout(null);
      const child = await startChildServer(dir);
      try {
        const { payload } = await runPreflight(
          ["--port", String(child.port), "--only=port owner"],
          dir,
        );

        const owner = checkNamed(payload, "port owner");
        expect(owner?.status).toBe("ok");
        expect(owner?.detail).toContain(
          `pid ${child.pid} holds :${child.port} and runs from this checkout`,
        );
        expect(payload.gate).toBe("pass");
      } finally {
        child.stop();
      }
    },
    30_000,
  );
});

describe("the preflight's read of a live server whose browser tab is gone", () => {
  let stub: Awaited<ReturnType<typeof startStubServer>>;
  let port = 0;

  beforeAll(async () => {
    stub = await startStubServer();
    port = stub.port;
  });

  afterAll(async () => {
    await stub.close();
  });

  it("fails a server that answers with no tab pointing at it, and names re-opening the preview", async () => {
    const { result, payload } = await runPreflight([
      "--port",
      String(port),
      "--only=preview tab",
      "--tab-state=[]",
    ]);

    const tab = checkNamed(payload, "preview tab");
    expect(tab?.status).toBe("fail");
    expect(tab?.detail).toContain(`the dev server answers on :${port}`);
    expect(tab?.detail).toContain("no open tab points at it");
    expect(tab?.detail).toContain("no tabs are open");
    expect(tab?.fix).toContain(`re-open the preview at http://localhost:${port}`);
    expect(payload.failures).toContain("preview tab");
    expect(result.status).toBe(1);
  });

  it("passes when a tab is open on that port, so the check is not always red", async () => {
    // The tab says `127.0.0.1` where the probe says `localhost`: loopback is one
    // machine here, and a check that knew only one spelling would cry wolf.
    const { payload } = await runPreflight([
      "--port",
      String(port),
      "--only=preview tab",
      `--tab-state=[{"url":"http://127.0.0.1:${port}/"}]`,
    ]);

    const tab = checkNamed(payload, "preview tab");
    expect(tab?.status).toBe("ok");
    expect(tab?.detail).toContain(`a tab is open on :${port}`);
    expect(payload.gate).toBe("pass");
    // A narrowed pass still must not advertise a server it never probed.
    expect(payload.registerUrl).toBeNull();
  });

  it("reads a tab on IPv6 loopback as the same machine, not just 127.0.0.1", async () => {
    const { payload } = await runPreflight([
      "--port",
      String(port),
      "--only=preview tab",
      `--tab-state=[{"url":"http://[::1]:${port}/"}]`,
    ]);

    // `URL` keeps the brackets in `hostname`, and the server binds IPv6
    // loopback, so only the bracket strip makes this tab read as this machine.
    const tab = checkNamed(payload, "preview tab");
    expect(tab?.status).toBe("ok");
    expect(tab?.detail).toContain(`a tab is open on :${port}`);
  });

  it("does not read a tab elsewhere, a portless URL, or one that will not parse, as this preview", async () => {
    // Same port, different host: without the loopback guard this would pass as
    // the preview's own tab, and the check would go quiet about a real death.
    const elsewhere = await runPreflight([
      "--port",
      String(port),
      "--only=preview tab",
      `--tab-state=[{"url":"http://example.com:${port}/"}]`,
    ]);
    const elsewhereTab = checkNamed(elsewhere.payload, "preview tab");
    expect(elsewhereTab?.status).toBe("fail");
    expect(elsewhereTab?.detail).toContain(`open: http://example.com:${port}/`);

    // A portless URL is the scheme's default port, not this server's: `URL` folds
    // `:80` away, so the raw port is compared and a tab at `http://localhost/`
    // cannot be mistaken for a preview on a high port.
    const portless = await runPreflight([
      "--port",
      String(port),
      "--only=preview tab",
      `--tab-state=[{"url":"http://localhost/"}]`,
    ]);
    expect(checkNamed(portless.payload, "preview tab")?.status).toBe("fail");

    // A tab entry that is a string but not a URL is a caller's mistake, not a
    // tab on this preview: the check must survive it and still report the death.
    const garbage = await runPreflight([
      "--port",
      String(port),
      "--only=preview tab",
      `--tab-state=["not a url"]`,
    ]);
    const garbageTab = checkNamed(garbage.payload, "preview tab");
    expect(garbageTab?.status).toBe("fail");
    expect(garbageTab?.detail).toContain("open: not a url");
  });

  it("names the open tab that is not on the server's port", async () => {
    const { payload } = await runPreflight([
      "--port",
      String(port),
      "--only=preview tab",
      "--tab-state=[{\"url\":\"http://localhost:1/\"}]",
    ]);

    const tab = checkNamed(payload, "preview tab");
    expect(tab?.status).toBe("fail");
    expect(tab?.detail).toContain("open: http://localhost:1/");
    expect(tab?.fix).toContain(`http://localhost:${port}`);
  });

  it("warns when a tab is left open on a port nothing answers on", async () => {
    const dead = await freePort();
    const { payload } = await runPreflight([
      "--port",
      String(dead),
      "--only=preview tab",
      `--tab-state=[{"url":"http://localhost:${dead}/"}]`,
    ]);

    // The mirror of the headline case: the tab is fine and the server died.
    const tab = checkNamed(payload, "preview tab");
    expect(tab?.status).toBe("warn");
    expect(tab?.detail).toContain("died behind the tab");
    expect(payload.warnings).toContain("preview tab");
    expect(tab?.fix).toContain("npm run dev");
  });

  it("reads the same tab list from a file as from inline JSON", async () => {
    const dir = scratchCheckout(null);
    const tabsPath = path.join(dir, "tabs.json");
    writeFileSync(tabsPath, JSON.stringify({ tabs: [{ url: `http://localhost:${port}/` }] }));

    const { payload } = await runPreflight([
      "--port",
      String(port),
      "--only=preview tab",
      `--tab-state=${tabsPath}`,
    ]);

    expect(checkNamed(payload, "preview tab")?.status).toBe("ok");
    expect(payload.gate).toBe("pass");
  });

  it("fails loudly on a tab list it cannot read, rather than reporting a pass", async () => {
    const { payload } = await runPreflight([
      "--port",
      String(port),
      "--only=preview tab",
      "--tab-state={not json",
    ]);

    const tab = checkNamed(payload, "preview tab");
    expect(tab?.status).toBe("fail");
    expect(tab?.detail).toContain("does not parse as JSON");
    expect(typeof tab?.fix).toBe("string");
  });

  it("fails a tab list whose entries carry no url, and a path that is not there", async () => {
    const noUrl = await runPreflight([
      "--port",
      String(port),
      "--only=preview tab",
      "--tab-state=[{}]",
    ]);
    const noUrlCheck = checkNamed(noUrl.payload, "preview tab");
    expect(noUrlCheck?.status).toBe("fail");
    expect(noUrlCheck?.detail).toContain("entry with no url");

    const absent = await runPreflight([
      "--port",
      String(port),
      "--only=preview tab",
      `--tab-state=${path.join(projectRoot, "no-such-tabs.json")}`,
    ]);
    const absentCheck = checkNamed(absent.payload, "preview tab");
    expect(absentCheck?.status).toBe("fail");
    expect(absentCheck?.detail).toContain("could not be read");
  });

  it("accepts the entry shapes a caller hands over, not just { url }", async () => {
    // The caller is the preview panel, and what it hands over is whatever its
    // tab list looks like: bare URL strings, or an entry carrying `appUrl`.
    const bare = await runPreflight([
      "--port",
      String(port),
      "--only=preview tab",
      `--tab-state=["http://localhost:${port}/"]`,
    ]);
    expect(checkNamed(bare.payload, "preview tab")?.status).toBe("ok");

    const appUrl = await runPreflight([
      "--port",
      String(port),
      "--only=preview tab",
      `--tab-state=[{"appUrl":"http://localhost:${port}/"}]`,
    ]);
    expect(checkNamed(appUrl.payload, "preview tab")?.status).toBe("ok");
  });

  it("stays quiet when neither a tab nor a server is on that port, leaving the reach checks to speak", async () => {
    const dead = await freePort();
    const { payload } = await runPreflight([
      "--port",
      String(dead),
      "--only=preview tab",
      "--tab-state=[]",
    ]);

    // There is no server whose tab could be missing and no tab left behind on a
    // port that died, so this check has nothing to accuse: the reach checks are
    // the ones that fail, and a quiet INFO here must not read as a verdict.
    const tab = checkNamed(payload, "preview tab");
    expect(tab?.status).toBe("info");
    expect(tab?.detail).toContain(`no tab points at :${dead} and nothing answers there`);
    expect(payload.failures).not.toContain("preview tab");
    expect(payload.gate).toBe("pass");
  });

  it("reports the tab unchecked when no tab state is supplied", async () => {
    const { payload } = await runPreflight(["--port", String(port), "--only=preview tab"]);

    // Not looked at is not the same as looked at and clean: the check says which
    // it was, so a gate on it cannot read as a verdict about the browser.
    const tab = checkNamed(payload, "preview tab");
    expect(tab?.status).toBe("info");
    expect(tab?.detail).toContain("not checked");
  });
});

/**
 * The report tail, held by its shape.
 *
 * `preview-preflight.mjs` is written in place by whoever is editing it, so a write that is
 * interrupted leaves the file cut off where it stopped — which is exactly how it was found at
 * line 970, mid-template, in the sentence this block prints. The two ways that can end are not
 * equally loud.
 *
 * Cut inside an expression, nothing can load the script, and the breakage surfaces as a parse
 * error in whichever gate runs first — confusing, but at least named. Cut on a *statement*
 * boundary, the file still parses: the `if (onlyTokens)` arm closes, and the `else` carrying the
 * sentence a reader actually needs is simply gone. No gate notices that one, because every
 * assertion above reads the script's `--json` payload, and the report is the half of this script
 * that only a person ever sees.
 *
 * So the tail is pinned to its shape rather than to its bytes: both report sentences present, and
 * the block closed. A reformat inside them is free; losing the end is not.
 */
describe("the preflight's report tail", () => {
  it("closes the report block it opened, with both of its sentences still in it", () => {
    const source = readFileSync(preflight, "utf8");
    const at = source.lastIndexOf("if (onlyTokens)");
    const tail = at === -1 ? "" : source.slice(at);

    // Both halves of the report: the pass that was filtered, and the one that can actually be
    // registered. A cut on a statement boundary can take the second and leave nothing unparsable
    // behind, so the count is asserted rather than trusted.
    expect(
      tail.match(/console\.log\(/g) ?? [],
      "the report's two sentences — a shorter tail means the write stopped early",
    ).toHaveLength(2);
    expect(tail).toContain("ready to register");

    // …and the file still ends where it should: the closing brace of the block it opened, the
    // last byte an interrupted write loses, and the reason this is a pin rather than a comment.
    expect(
      source.trimEnd().endsWith("}"),
      `expected ${path.basename(preflight)} to end with the report block's closing brace, got "${source.trimEnd().slice(-40)}"`,
    ).toBe(true);
  });
});
