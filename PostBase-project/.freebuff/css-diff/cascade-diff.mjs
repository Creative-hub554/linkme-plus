// Cascade diff for the globals.css layer move.
//
//   node .freebuff/css-diff/cascade-diff.mjs <before.css> <after.css>
//
// Both inputs may be the raw CSS *or* the JS module the dev server actually
// serves (`const __vite__css = "<escaped css>"`) — that wrapper is unwrapped.
//
// Why this exists: moving the hand-written token rules from bare CSS into
// `@layer utilities` can only change a rendered result where a moved rule and
// some other rule can BOTH match one element while setting the SAME property.
// Two rules can co-match when one's class set contains the other's. So the whole
// question is answerable from the two stylesheets alone — no per-page sampling,
// and it covers pseudo-class states (`:hover`, `:focus`) that headless driving
// cannot reach.
//
// Precedence modelled after CSS Cascade 5: unlayered > layer order
// (properties < theme < base < components < utilities), then specificity, then
// source order. Specificity is approximate (classes+pseudo-classes vs elements)
// which is all that matters here: every rival of interest is a single class.

import { readFileSync } from "node:fs";

const LAYER_RANK = { properties: 0, theme: 1, base: 2, components: 3, utilities: 4 };
const UNLAYERED = 9;

const MOVED = [
  "text-foreground", "text-muted-foreground", "text-primary", "bg-background",
  "bg-card", "bg-muted", "bg-accent", "bg-primary", "border-border", "border-input",
  "ring-ring", "focus-visible:ring-ring", "text-accent-foreground", "bg-secondary",
  "text-secondary-foreground", "text-destructive", "bg-destructive",
  "text-destructive-foreground", "bg-popover", "text-popover-foreground",
];

const COLOR_PROPS = ["color", "background-color", "border-color", "border-top-color",
  "border-right-color", "border-bottom-color", "border-left-color", "--tw-ring-color"];

function readCss(path) {
  const raw = readFileSync(path, "utf8");
  const marker = "const __vite__css = ";
  const at = raw.indexOf(marker);
  if (at === -1) return raw;
  const start = raw.indexOf('"', at + marker.length);
  let end = start + 1;
  while (end < raw.length) {
    if (raw[end] === "\\") { end += 2; continue; }
    if (raw[end] === '"') break;
    end++;
  }
  return JSON.parse(raw.slice(start, end + 1));
}

// ---------- parsing ----------

function parse(css) {
  const rules = [];
  const stack = [];
  let order = 0;
  let prelude = "";
  let i = 0;
  const layerOf = () => {
    for (let k = stack.length - 1; k >= 0; k--) if (stack[k].kind === "layer") return stack[k].name;
    return null;
  };
  while (i < css.length) {
    const ch = css[i];
    if (ch === "/" && css[i + 1] === "*") {
      const close = css.indexOf("*/", i);
      if (close === -1) break;
      i = close + 2;
      continue;
    }
    if (ch === "{") {
      const pre = prelude.trim();
      prelude = "";
      if (pre.startsWith("@")) {
        const m = /^@(layer|media|supports|property|keyframes|font-face)\b\s*([\s\S]*)$/.exec(pre);
        const kind = m && m[1] === "layer" ? "layer" : "at";
        stack.push({ kind, name: kind === "layer" ? (m[2].trim() || "anon") : pre });
        i++;
        continue;
      }
      let depth = 1, j = i + 1;
      while (j < css.length && depth > 0) {
        if (css[j] === "{") depth++;
        else if (css[j] === "}") depth--;
        j++;
      }
      if (pre) rules.push({ order: order++, prelude: pre, body: css.slice(i + 1, j - 1), layer: layerOf(), inMedia: stack.some((s) => s.kind === "at") });
      i = j;
      continue;
    }
    if (ch === "}") { stack.pop(); prelude = ""; i++; continue; }
    if (ch === ";") { prelude = ""; i++; continue; }
    prelude += ch;
    i++;
  }
  return rules;
}

function declarations(body) {
  const out = [];
  let depth = 0, cur = "";
  for (const ch of body) {
    if (ch === "{" || ch === "(") depth++;
    if (ch === "}" || ch === ")") depth--;
    if (ch === ";" && depth === 0) { push(cur); cur = ""; continue; }
    cur += ch;
  }
  push(cur);
  function push(piece) {
    if (piece.includes("{") || piece.includes("@")) return;
    const idx = piece.indexOf(":");
    if (idx === -1) return;
    const prop = piece.slice(0, idx).trim();
    const value = piece.slice(idx + 1).trim().replace(/\s+/g, " ");
    if (prop && value) out.push([prop, value]);
  }
  return out;
}

const unescapeClass = (s) => s.replace(/\\(.)/g, "$1");
function classTokens(sel) {
  const set = new Set();
  const re = /\.((?:\\.|[\w-])+)/g;
  let m;
  while ((m = re.exec(sel))) set.add(unescapeClass(m[1]));
  return set;
}
const PSEUDO = ["hover", "focus-visible", "focus", "active", "disabled"];
function states(sel) {
  const set = new Set();
  for (const p of PSEUDO) if (new RegExp(`:${p}\\b`).test(sel)) set.add(p);
  if (/:is\(:where\(\.group\):hover/.test(sel)) set.add("group-hover");
  return set;
}
function specificity(sel) {
  const s = sel.replace(/:where\([^)]*\)/g, "");
  const classes = (s.match(/\.[\w-]|\[[^\]]*\]|:(?!:)[\w-]+/g) || []).length;
  const elements = (s.match(/(^|[\s>+~,(])([a-z][\w-]*)/g) || []).length + (s.match(/::[\w-]+/g) || []).length;
  return classes * 1000 + elements;
}
function splitSelectors(prelude) {
  const out = [];
  let depth = 0, cur = "";
  for (const ch of prelude) {
    if (ch === "(" || ch === "[") depth++;
    if (ch === ")" || ch === "]") depth--;
    if (ch === "," && depth === 0) { out.push(cur.trim()); cur = ""; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function compile(text) {
  const compiled = [];
  for (const r of parse(text)) {
    const decls = new Map(declarations(r.body));
    const layerRank = r.layer && r.layer in LAYER_RANK ? LAYER_RANK[r.layer] : UNLAYERED;
    for (const sel of splitSelectors(r.prelude)) {
      compiled.push({ sel, layer: r.layer, layerRank, order: r.order, classes: classTokens(sel), states: states(sel), specific: specificity(sel), decls });
    }
  }
  return compiled;
}

const subset = (a, b) => [...a].every((x) => b.has(x));
const label = (r) => `${r.layer ?? "UNLAYERED"} | ${r.sel}`;
function winner(a, b) {
  if (a.layerRank !== b.layerRank) return a.layerRank > b.layerRank ? a : b;
  if (a.specific !== b.specific) return a.specific > b.specific ? a : b;
  return a.order > b.order ? a : b;
}

// ---------- run ----------

const [beforePath, afterPath] = process.argv.slice(2);
const beforeCss = readCss(beforePath);
const afterCss = readCss(afterPath);
const before = compile(beforeCss);
const after = compile(afterCss);

console.log(`== sheets ==  before: ${before.length} selector-rules   after: ${after.length}`);
const ranks = {};
for (const r of before) ranks[r.layer ?? "UNLAYERED"] = (ranks[r.layer ?? "UNLAYERED"] || 0) + 1;
console.log("   before by layer:", JSON.stringify(ranks));
const ranksA = {};
for (const r of after) ranksA[r.layer ?? "UNLAYERED"] = (ranksA[r.layer ?? "UNLAYERED"] || 0) + 1;
console.log("   after  by layer:", JSON.stringify(ranksA));

const utilOrders = after.filter((r) => r.layer === "utilities").map((r) => r.order);
const movedOrders = after.filter((r) => MOVED.some((m) => r.sel === `.${m}` || r.sel === `.${m}:focus-visible`)).map((r) => r.order);
console.log(`   generated utilities: source orders ${Math.min(...utilOrders)}..${Math.max(...utilOrders)}; moved block: ${Math.min(...movedOrders)}..${Math.max(...movedOrders)}  (later wins a tie)`);

// Find the rule for a token name. The selector text is escaped in the sheet
// (`.focus-visible\:ring-ring`), so match on the decoded class set instead.
const findRule = (sheet, name) =>
  sheet.find((r) => r.classes.has(name) && (!name.includes(":") || r.sel.includes(":")) && r.sel.startsWith("."));

console.log("\n== the moved rules ==");
for (const m of MOVED) {
  const b = findRule(before, m);
  const a = findRule(after, m);
  console.log(`   ${(b ? b.sel : m).padEnd(30)} ${(b ? b.layer ?? "UNLAYERED" : "absent").padEnd(12)} -> ${a ? a.layer ?? "UNLAYERED" : "ABSENT"}`);
}

console.log("\n== competition ==  (rival can match the same element AND sets the same property)");
let pairs = 0;
const changes = [];
const unchanged = [];
for (const m of MOVED) {
  const aMoved = findRule(after, m);
  const bMoved = findRule(before, m);
  if (!aMoved) continue;
  for (const prop of aMoved.decls.keys()) {
    if (!COLOR_PROPS.includes(prop)) continue;
    for (const rival of after) {
      if (rival === aMoved || !rival.decls.has(prop)) continue;
      if (rival.sel.includes("::")) continue;
      if (!subset(rival.classes, aMoved.classes) && !subset(aMoved.classes, rival.classes)) continue;
      pairs++;
      const bRival = before.find((r) => r.sel === rival.sel && r.layer === rival.layer) ?? rival;
      const wb = winner(bMoved ?? { ...aMoved, layer: null, layerRank: UNLAYERED }, bRival);
      const wa = winner(aMoved, rival);
      const row = {
        moved: m, prop, rival: label(rival),
        winBefore: label(wb), winAfter: label(wa),
        valueBefore: wb.decls.get(prop), valueAfter: wa.decls.get(prop),
      };
      // A different *rule* winning is what matters. The same rule sitting in a
      // different layer (the whole point of the move) is not a change.
      (wb.sel === wa.sel ? unchanged : changes).push(row);
    }
  }
}
console.log(`   co-matching rival pairs: ${pairs}`);
console.log(`   same rule still wins: ${unchanged.length}`);
const rivalsSeen = new Set(unchanged.map((r) => r.rival.split(" | ")[1]));
console.log(`   rivals that lose either way: ${[...rivalsSeen].join(", ")}`);
console.log(`   WINNER CHANGES: ${changes.length}`);
for (const r of changes) {
  console.log(`      ${r.moved} {${r.prop}} vs ${r.rival}`);
  console.log(`        before: ${r.winBefore}  = ${r.valueBefore}`);
  console.log(`        after:  ${r.winAfter}  = ${r.valueAfter}   ${r.valueBefore === r.valueAfter ? "(SAME VALUE -> no visual change)" : "(DIFFERENT VALUE)"}`);
}
if (!changes.length) console.log("      (none)");
