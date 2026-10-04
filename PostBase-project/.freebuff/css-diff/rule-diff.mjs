/*
 * Rule-level diff of two compiled stylesheets.
 *
 * A rule is keyed by its at-rule chain plus selector, so the same class under
 * `@supports` is not confused with the bare one. Prints what appeared, what
 * disappeared, and — the case that actually matters — which selectors exist in
 * both but declare something different.
 */
import { readFileSync } from "node:fs";
import postcss from "postcss";

function rulesOf(file) {
  const root = postcss.parse(readFileSync(file, "utf8"));
  const map = new Map();
  root.walkRules((rule) => {
    const chain = [];
    let parent = rule.parent;
    while (parent && parent.type !== "root") {
      chain.unshift(parent.type === "atrule" ? `@${parent.name} ${parent.params}` : parent.selector);
      parent = parent.parent;
    }
    const body = rule.nodes
      .filter((node) => node.type === "decl")
      .map((decl) => `${decl.prop}: ${decl.value.replace(/\s+/g, " ").trim()}`)
      .sort()
      .join("; ");
    const key = `${chain.join(" | ")} :: ${rule.selector}`;
    // A selector can legitimately repeat; keep the first, note the rest.
    if (map.has(key) && map.get(key) !== body) {
      map.set(key, `${map.get(key)} ;; ${body}`);
    } else if (!map.has(key)) {
      map.set(key, body);
    }
  });
  return map;
}

const [beforeFile, afterFile] = process.argv.slice(2);
const before = rulesOf(beforeFile);
const after = rulesOf(afterFile);

const added = [...after.keys()].filter((key) => !before.has(key));
const removed = [...before.keys()].filter((key) => !after.has(key));
const changed = [...after.keys()].filter((key) => before.has(key) && before.get(key) !== after.get(key));

console.log(`rules: before ${before.size}, after ${after.size}`);
console.log(`added ${added.length}, removed ${removed.length}, changed ${changed.length}\n`);

console.log("=== ADDED ===");
for (const key of added) console.log(`+ ${key}  { ${after.get(key)} }`);

console.log("\n=== REMOVED ===");
for (const key of removed) console.log(`- ${key}  { ${before.get(key)} }`);

console.log("\n=== CHANGED ===");
for (const key of changed) console.log(`~ ${key}\n    before: ${before.get(key)}\n    after:  ${after.get(key)}`);
