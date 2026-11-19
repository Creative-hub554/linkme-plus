#!/usr/bin/env node
/**
 * The Freebuff Sites deploy pipeline, as one command: `npm run sites:prepare`.
 *
 * Sites uploads a prebuilt Worker bundle plus a static-asset tree; unlike
 * `wrangler deploy` it compiles nothing, and it caps one deployment at 100 code
 * modules. vinext's own build graph is exactly the wrong shape for that — the
 * app build emits a couple of hundred interlinked chunks — so this pipeline
 * re-bundles the built server graph into a single file with esbuild, the same
 * recipe the first Sites deploy ran by hand:
 *
 *   1. `vinext build` — dist/ holds the client asset tree and the server graph.
 *   2. esbuild bundles the built server entry `dist/server/index.js` into
 *      `sites-deploy/vinext-worker.js`: one module, every dependency inlined,
 *      `node:*` builtins left to the platform's `nodejs_compat`, and
 *      `cloudflare:*` runtime modules left to the Worker runtime. The built
 *      entry is the bundle source — not `worker/index.ts` — because only the
 *      vinext build resolves the `virtual:vinext-*` adapter imports into
 *      concrete code, and that entry is already the wrapped worker: the
 *      per-request database scope and the vinext handler, in one graph.
 *   3. `sites-deploy/entry.js` is written: asset-first GET/HEAD dispatch
 *      through the reserved ASSETS binding (native cache/redirect semantics),
 *      with everything unmatched falling through to the worker.
 *   4. dist/client is pruned into `sites-deploy/assets/`: everything visible is
 *      uploaded, every dot-entry (`.vite/`, `.assetsignore`) is dropped so no
 *      hidden build metadata reaches the public tree.
 *   5. `sites.manifest.json` is written in the exact shape the Sites deploy
 *      manifest consumes: two ESM modules, `nodejs_compat`, `spa: false` —
 *      this app serves HTML per route from the worker, it is not an SPA.
 *
 * Everything under `sites-deploy/` is generated — `sites-deploy/` is
 * gitignored and lint-ignored, and this file can rebuild it from nothing on a
 * fresh checkout. Rerun it for every deploy; it never reuses stale bytes.
 *
 * What it deliberately does NOT do: upload. Deploying means `sites_deploy`
 * (the Sites panel or the agent tool) pointed at this manifest — the deploy has
 * no local credentials to hand out — so the finished script's last line names
 * the manifest and the two environments it can land in (preview first).
 */

import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const DEPLOY_DIR = path.join(ROOT, "sites-deploy");
const ASSETS_DIR = path.join(DEPLOY_DIR, "assets");
const BUNDLE_PATH = path.join(DEPLOY_DIR, "vinext-worker.js");
const ENTRY_PATH = path.join(DEPLOY_DIR, "entry.js");
const MANIFEST_PATH = path.join(ROOT, "sites.manifest.json");

/** Sites' hard budget for one Worker's compressed code (OpenNext: 32 MiB total). */
const BUDGET_BYTES = 10 * 1024 * 1024;

function die(message) {
  console.error(`sites:prepare: ${message}`);
  process.exit(1);
}

function info(message) {
  console.log(`sites:prepare: ${message}`);
}

// ─── 0. .env.local into the environment ─────────────────────────
// `vinext build` prerenders, and the build's server imports read DATABASE_URL at
// module load (src/lib/db/index.ts throws without it). Plain `npm run build`
// only works in shells that already carry these values; loading .env.local here
// makes the script the one command on a fresh terminal too.

function loadLocalEnv() {
  const envFile = path.join(ROOT, ".env.local");
  if (!existsSync(envFile)) {
    info("no .env.local found — relying on the shell's own environment");
    return;
  }
  let loaded = 0;
  for (const rawLine of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith(`"`) && value.endsWith(`"`) && value.length >= 2) ||
      (value.startsWith(`'`) && value.endsWith(`'`) && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
      loaded += 1;
    }
  }
  info(`.env.local: ${loaded} variable(s) merged into the environment`);
}

// ─── 1. vinext build ────────────────────────────────────────────

function vinextBuild() {
  info("running npm run build (vinext build)…");
  const result = spawnSync("npm", ["run", "build"], { stdio: "inherit", shell: true, cwd: ROOT });
  if (result.status !== 0) {
    die(`npm run build exited ${result.status} — fix the build before preparing a deploy`);
  }
  const serverIndex = path.join(ROOT, "dist", "server", "index.js");
  if (!existsSync(serverIndex)) die("vinext build produced no dist/server/index.js");
}

// ─── 2. the single-file Worker bundle ───────────────────────────

async function bundleWorker() {
  info("bundling dist/server/index.js with esbuild → sites-deploy/vinext-worker.js…");
  try {
    await build({
      entryPoints: [path.join(ROOT, "dist", "server", "index.js")],
      outfile: BUNDLE_PATH,
      bundle: true,
      format: "esm",
      platform: "browser",
      target: "es2023",
      // The platform's nodejs_compat answers `node:*` and the Worker runtime
      // answers `cloudflare:*`; leaving those imports external is what keeps
      // this one file instead of a polyfill download. Bare builtins (still
      // imported un-prefixed by some packages) go with them.
      external: [
        "node:*", "cloudflare:*", "virtual:*", "crypto", "stream", "buffer", "events", "path", "util", "string_decoder",
        "net", "tls", "http", "https", "http2", "url", "zlib", "os", "dns", "fs", "assert",
        "querystring", "process", "worker_threads", "async_hooks", "inspector", "timers",
        "child_process", "cluster", "dgram", "readline", "perf_hooks", "v8", "vm", "sys",
      ],
      // Sites serves truth from the built dist/ tree; no sourcemaps leave here.
      sourcemap: false,
      logLevel: "warning",
    });
  } catch (error) {
    // esbuild throws with counts-and-messages on its own for failed builds.
    die(`esbuild failed: ${error instanceof Error ? error.message : error}`);
  }

  const bundled = readFileSync(BUNDLE_PATH, "utf8");
  // The wrapper's default export is the deployment's shape: a bundle without
  // one would upload a Worker that serves nothing.
  if (!/\bexport\s*\{[^}]*\bas\s+default\b|\bexport\s+default\b/.test(bundled)) {
    die("the bundle has no default export — inspect worker/index.ts before deploying");
  }
  const bytes = statSync(BUNDLE_PATH).size;
  info(`bundle: ${(bytes / 1024 / 1024).toFixed(2)} MiB, 1 file`);
  if (bytes > BUDGET_BYTES) {
    info("warning: the bundle is over the 10 MiB code budget — the upload may still pass, but watch the deploy receipt");
  }
}

// ─── 3. the asset-first entry ───────────────────────────────────

const ENTRY_SOURCE = `// Freebuff Sites serves the deployed asset tree through the reserved ASSETS
// binding, and asset-first routing is what keeps native asset semantics (cache
// headers, redirects) working. This entry mirrors the platform's own OpenNext
// entry shape: file-ish GET/HEAD requests try ASSETS first, and only an
// unmatched 404 falls through to the vinext worker — SSR routes, /api/* and
// scheduled jobs are untouched.
import worker from "./vinext-worker.js";

const FILE_PREFIXES = [\`/_next/\`, \`/_vinext/\`];
const FILE_EXACT = new Set([
  \`/vinext-client-entry-manifest.json\`,
  \`/favicon.ico\`,
  \`/robots.txt\`,
  \`/sitemap.xml\`,
]);

function looksLikeFile(pathname) {
  const last = pathname.slice(pathname.lastIndexOf(\`/\`) + 1);
  return last.includes(\`.\`) && last !== \`\`;
}

export default {
  async fetch(request, env, ctx) {
    if (env.ASSETS) {
      const method = request.method;
      const url = new URL(request.url);
      const pathname = url.pathname;
      if (
        (method === \`GET\` || method === \`HEAD\`) &&
        (FILE_PREFIXES.some((p) => pathname.startsWith(p)) || looksLikeFile(pathname) || FILE_EXACT.has(pathname))
      ) {
        const assetResponse = await env.ASSETS.fetch(new Request(request.url, request));
        if (assetResponse.status !== 404) return assetResponse;
      }
    }
    return worker.fetch(request, env, ctx);
  },
};
`;

function writeEntry() {
  mkdirSync(DEPLOY_DIR, { recursive: true });
  writeFileSync(ENTRY_PATH, ENTRY_SOURCE);
}

// ─── 4. the pruned asset tree ───────────────────────────────────

/**
 * Copies the visible part of `srcDir` into `destDir`, dropping dot-entries.
 * `recursive` handles nested directories; symlinks are refused rather than
 * followed, because an upload that dereferences a stray link is exactly the
 * accidental-wide-upload this pruning exists to prevent.
 */
function copyVisible(srcDir, destDir) {
  mkdirSync(destDir, { recursive: true });
  let files = 0;
  for (const name of readdirSync(srcDir)) {
    if (name.startsWith(".")) continue;
    const source = path.join(srcDir, name);
    const destination = path.join(destDir, name);
    const stats = statSync(source);
    if (stats.isSymbolicLink()) die(`refusing to copy symlink: ${source}`);
    if (stats.isDirectory()) {
      files += copyVisible(source, destination);
    } else {
      cpSync(source, destination);
      files += 1;
    }
  }
  return files;
}

function pruneAssets() {
  rmSync(ASSETS_DIR, { recursive: true, force: true });
  info("pruning dist/client → sites-deploy/assets (dot-entries dropped)…");
  const fileCount = copyVisible(path.join(ROOT, "dist", "client"), ASSETS_DIR);
  // The pruning test: no hidden file, directory or symlink survives anywhere in
  // the tree that will go public.
  const checkVisible = (dir) => {
    for (const name of readdirSync(dir)) {
      if (name.startsWith(".")) die(`hidden path survived pruning: ${path.relative(ROOT, path.join(dir, name))}`);
      const entry = path.join(dir, name);
      const stats = statSync(entry);
      if (stats.isSymbolicLink()) die(`symlink survived pruning: ${entry}`);
      if (stats.isDirectory()) checkVisible(entry);
    }
  };
  checkVisible(ASSETS_DIR);
  info(`assets: ${fileCount} file(s)`);
}

// ─── 5. the Sites deploy manifest ───────────────────────────────

function writeManifest() {
  const manifest = {
    entrypoint: "entry.js",
    compatibilityDate: "2025-05-01",
    compatibilityFlags: ["nodejs_compat"],
    modules: [
      { name: "entry.js", type: "esm", path: "sites-deploy/entry.js" },
      { name: "vinext-worker.js", type: "esm", path: "sites-deploy/vinext-worker.js" },
    ],
    assetsDirectory: "./sites-deploy/assets",
    spa: false,
  };
  writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  // Two modules is the whole point of the single-file bundle: vinext's own
  // graph was ~289 chunks, far past Sites' 100-module cap. If this count ever
  // grows, someone inlined less than the pipeline assumed.
  if (manifest.modules.length > 100) die("the manifest carries more than the 100-module Sites cap");
}

// ─── run ────────────────────────────────────────────────────────

loadLocalEnv();
vinextBuild();
writeEntry();
await bundleWorker();
pruneAssets();
writeManifest();

info("done. Next step: deploy with `sites_deploy` using manifestPath sites.manifest.json");
info("(preview first, then production with the user's say-so — the upload consumes no local credentials)");
