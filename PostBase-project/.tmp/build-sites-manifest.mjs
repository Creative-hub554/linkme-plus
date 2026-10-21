import fs from "node:fs";
import path from "node:path";

const root = path.resolve(".");
// The bundle is a single consolidated module (3.6MB): the Sites manifest caps
// modules at 100, and vinext's chunked worker output is 277 files, so the
// deployment ships the inlined single-file worker instead.
// Outside any dot-directory: the uploader refuses module paths that pass
// through a hidden directory.
const dir = path.join(root, "sites-deploy");

function walk(d) {
  // The pruned asset tree lives beside the worker module in sites-deploy; it is
  // uploaded as assets, never as modules.
  let out = [];
  for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, f.name);
    if (f.isDirectory()) {
      if (f.name === "assets") continue;
      out = out.concat(walk(p));
    } else out.push(p);
  }
  return out;
}

// Wrangler writes a README.md into a dry-run outdir; it is a doc, not a module.
const files = walk(dir).filter((p) => path.basename(p) !== "README.md");
// Paths resolve relative to the working directory, which is the project root:
// every path below is unambiguous from project-root-relative spelling.
const toRootRelative = (p) => path.relative(root, p).split(path.sep).join("/");
const modules = files.map((p) => ({
  name: path.relative(dir, p).split(path.sep).join("/"),
  type: "esm",
  path: toRootRelative(p),
}));

const manifest = {
  entrypoint: "entry.js",
  compatibilityDate: "2025-05-01",
  // node:* built-ins are served by the runtime under nodejs_compat; without
  // this flag the uploaded Worker fails Cloudflare's startup validation (10021).
  compatibilityFlags: ["nodejs_compat"],
  modules,
  // A pruned copy of dist/client: vinext leaves hidden build metadata there
  // (.assetsignore, .vite/) that the Sites asset uploader refuses.
  assetsDirectory: "./sites-deploy/assets",
  spa: false,
};

fs.writeFileSync(path.join(root, "sites.manifest.json"), JSON.stringify(manifest, null, 1));

fs.writeFileSync(path.join(root, "sites.manifest.json"), JSON.stringify(manifest, null, 1));
console.log("modules:", modules.length, "| entry:", modules.find((m) => m.name === "index.js")?.path);
