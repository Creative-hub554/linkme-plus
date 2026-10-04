/*
 * "Tailwind generates the whole family" is a claim about the build output, so it
 * is checked against the build output: every class in the token family that the
 * app's source writes, looked up in the production stylesheet.
 *
 * The previous state is stated the same way for contrast — the same list against
 * the pre-change sheet, where only the twenty bare names existed.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const FAMILY =
  /^(text|bg|border|ring)-(background|foreground|card|card-foreground|popover|popover-foreground|primary|primary-foreground|secondary|secondary-foreground|muted|muted-foreground|accent|accent-foreground|destructive|destructive-foreground|border|input|ring)(\/\d+)?$/;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(tsx|ts)$/.test(entry) && !/\.test\./.test(entry)) out.push(full);
  }
  return out;
}

/** Every variant-prefixed class the app writes whose final segment is a token utility. */
const used = new Set();
for (const file of walk(path.join(root, "src"))) {
  for (const match of readFileSync(file, "utf8").matchAll(/"[^"]*"|'[^']*'/g)) {
    for (const cls of match[0].slice(1, -1).split(/\s+/)) {
      if (!cls || /[{}[\]$`<>]/.test(cls)) continue;
      const segments = cls.split(":");
      if (FAMILY.test(segments[segments.length - 1])) used.add(cls);
    }
  }
}

const esc = (name) => name.replace(/[:/[\]=.%()#*,]/g, (ch) => `\\${ch}`);
const sheets = process.argv.slice(2);
const loaded = sheets.map((file) => ({ file, css: readFileSync(file, "utf8") }));

console.log(`token-family classes written by the app: ${used.size}\n`);
for (const { file, css } of loaded) {
  const missing = [...used].filter((cls) => !css.includes(`.${esc(cls)}`));
  console.log(`${path.basename(file)}: ${used.size - missing.length}/${used.size} present`);
  for (const cls of missing.sort()) console.log(`    MISSING ${cls}`);
}
