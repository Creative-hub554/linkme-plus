import fs from "node:fs";
import { build } from "esbuild";

await build({
  entryPoints: ["dist/server/index.js"],
  bundle: true,
  splitting: false, // inline dynamic imports -> one module, under the Sites 100-module cap
  format: "esm",
  target: "es2023",
  platform: "neutral",
  conditions: ["workerd", "worker", "browser"],
  define: {
    "process.env.NODE_ENV": '"production"',
    "global.process.env.NODE_ENV": '"production"',
    "globalThis.process.env.NODE_ENV": '"production"',
    "navigator.userAgent": '"Cloudflare-Workers"',
  },
  outfile: ".freebuff/sites-single/index.js",
  metafile: true,
  minify: false,
  sourcemap: false,
  // workerd provides every node:* builtin at runtime under nodejs_compat.
  external: ["node:*", "__STATIC_CONTENT_MANIFEST"],
  // neutral ignores package "main" unless told; supabase packages depend on it.
  mainFields: ["module", "main"],
  // dist/server/index.js is vinext's own worker output — the app router entry
  // plus the deployment wrapper worker/index.ts compiles into — with every
  // vinext virtual module already resolved by its Vite build, so no alias
  // plugins are needed here.
  plugins: [],
  logLevel: "info",
});
const meta = JSON.parse(fs.readFileSync(".freebuff/sites-single/meta.json", "utf8"));
console.log("outputs:", Object.keys(meta.outputs).length);
for (const [file, info] of Object.entries(meta.outputs)) {
  if (!file.endsWith(".map")) console.log(file, Math.round(info.bytes / 1024) + " KiB");
}
