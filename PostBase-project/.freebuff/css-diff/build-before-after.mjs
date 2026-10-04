/*
 * Compiles two stylesheets through the *same* Tailwind pipeline the app uses,
 * so a diff between them isolates this change:
 *
 *   after.css  — src/app/globals.css as it is now (tokens in `@theme inline`)
 *   before.css — the same file with that block removed and the twenty
 *                hand-written token rules put back
 *
 * Both are processed with `from` set to the real stylesheet path so Tailwind's
 * automatic content detection runs over exactly the same sources in both runs.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";

const root = process.cwd().replace(/\\/g, "/");
const realPath = `${root}/src/app/globals.css`;
const after = readFileSync(realPath, "utf8");

// Strip the `@theme inline` block (and its comment) ...
const before = after
  .replace(/\/\*\n \* The semantic tokens[\s\S]*?\*\/\n/, "")
  .replace(/@theme inline \{[\s\S]*?\n\}\n\n/, "");

if (before === after) {
  throw new Error("the @theme inline block was not found — refusing to write a bogus before.css");
}

// ... and put the twenty hand-written rules back where they were.
const HAND_WRITTEN = `/*
 * The design tokens, as classes, in \`@layer utilities\` deliberately.
 */
@layer utilities {
  .text-foreground { color: hsl(var(--foreground)); }
  .text-muted-foreground { color: hsl(var(--muted-foreground)); }
  .text-primary { color: hsl(var(--primary)); }
  .bg-background { background-color: hsl(var(--background)); }
  .bg-card { background-color: hsl(var(--card)); }
  .bg-muted { background-color: hsl(var(--muted)); }
  .bg-accent { background-color: hsl(var(--accent)); }
  .bg-primary { background-color: hsl(var(--primary)); }
  .border-border { border-color: hsl(var(--border)); }
  .border-input { border-color: hsl(var(--input)); }
  .ring-ring { --tw-ring-color: hsl(var(--ring)); }
  .focus-visible\\:ring-ring:focus-visible { --tw-ring-color: hsl(var(--ring)); }

  .text-accent-foreground { color: hsl(var(--accent-foreground)); }
  .bg-secondary { background-color: hsl(var(--secondary)); }
  .text-secondary-foreground { color: hsl(var(--secondary-foreground)); }
  .text-destructive { color: hsl(var(--destructive)); }
  .bg-destructive { background-color: hsl(var(--destructive)); }
  .text-destructive-foreground { color: hsl(var(--destructive-foreground)); }
  .bg-popover { background-color: hsl(var(--popover)); }
  .text-popover-foreground { color: hsl(var(--popover-foreground)); }
}

`;

const beforeFull = before.replace("\n.animate-pulse {", `\n${HAND_WRITTEN}.animate-pulse {`);
if (beforeFull === before) {
  throw new Error("could not find the insertion point for the hand-written rules");
}

// Kept on disk so the live before/after can swap the real stylesheet for it.
// The `.txt` suffix keeps these out of Tailwind's content scan: a `.css` file
// here is scanned like any other source and its class names become candidates.
writeFileSync(path.join(root, ".freebuff/css-diff/before-globals.css.txt"), beforeFull);
writeFileSync(path.join(root, ".freebuff/css-diff/after-globals.css.txt"), after);

/*
 * Pinned to `src` rather than left to automatic detection.
 *
 * Tailwind scans every file that is not ignored, regardless of extension — and
 * this folder is not ignored, so a compiled sheet written here becomes a source
 * of class-name candidates for the next run (`.flex-shrink` and `.border-collapse`
 * turned up as "removed" rules, extracted from the previous build's own output).
 * Naming them `.css.txt` did not help: extension is not consulted. `source(none)`
 * plus one explicit directory removes both the feedback loop and the run-to-run
 * drift. The real build scans the whole repo; the difference is unused utilities,
 * not the token family, which was checked against the production sheet separately.
 */
const pinned = (source) =>
  source.replace('@import "tailwindcss";', '@import "tailwindcss" source(none);\n@source "../../src";');

for (const [name, source] of [
  ["after", pinned(after)],
  ["before", pinned(beforeFull)],
]) {
  const result = await postcss([tailwind()]).process(source, { from: realPath });
  // `.css.txt`, not `.css`: a stylesheet in this folder is itself scanned for
  // candidates, so a generated sheet here would feed its own selectors back into
  // the next run (`.bg-accent\/50` appearing in a build nothing uses).
  const out = path.join(root, `.freebuff/css-diff/${name}.css.txt`);
  writeFileSync(out, result.css);
  console.log(`${name}.css.txt  ${result.css.length} bytes`);
}
