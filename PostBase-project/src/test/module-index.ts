import type { ComponentType } from "react";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ModuleResolver } from "@/test/source-scan";

/**
 * The project's own source as an *index*: every file's text keyed by path, the
 * framework's route leaves, and the path arithmetic that turns a specifier into
 * one.
 *
 * Reading a module's *exports* to learn its role means being able to follow an
 * `export … from` to the module it names, so a scanner needs a path→source map
 * and a way to resolve a specifier onto it. Both are here once, so no two guards
 * drift to a different tree or to a different idea of what `.` and `@/` mean.
 *
 * The path→source map is filled *on demand*, from disk, and cached: a scan only
 * follows an import into the handful of modules a route or page actually names,
 * so reading the whole tree up front was almost entirely wasted work. An eager
 * raw glob over the whole `src` tree — a `?raw` query with `eager: true` — made
 * Vite read and register *every* source file for each test file that imported
 * this module — measured at ~1.8s of collect for `module-index.test.ts` alone,
 * spent on sources no assertion ever reads.
 * `readFileSync` is synchronous, so resolution stays a plain function that
 * callers can use in a filter or a map. The route *leaves* (`page.tsx`,
 * `route.ts`) and the route-test paths are read the same way: a walk over
 * `src/app` and a `readFileSync` per match, keyed in Vite's glob space so every
 * call site reads exactly what it did before — but only when it asks.
 *
 * The component and page *modules* are the same story one level up: rather than
 * a lazy glob that resolves every module into whichever test file enumerates
 * them, `moduleLoaders` walks the tree and lets `import()` pull a module in only
 * when a case actually mounts it.
 */

// `fileURLToPath(import.meta.url)` — a string, not `new URL(…)`. This module is
// imported by a jsdom test file, and jsdom replaces the global `URL`, so a URL
// built here is jsdom's own class and Node's `fileURLToPath` rejects it with
// "The URL must be of scheme file". Handing over the string sidesteps that, and
// the path arithmetic stays identical.
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * A module's source text, read on demand and remembered afterwards.
 *
 * `null` records a path that was looked up and found not to exist, so a specifier
 * that misses is only paid for once. The lookup is `src`-relative like every path
 * in this module; the file it names is `<projectRoot>/src/<relativePath>`.
 */
const sourceCache = new Map<string, string | null>();

function moduleSource(relativePath: string): string | undefined {
  if (sourceCache.has(relativePath)) return sourceCache.get(relativePath) ?? undefined;

  let source: string | null;
  try {
    source = readFileSync(path.join(projectRoot, "src", relativePath), "utf8");
  } catch {
    source = null;
  }
  sourceCache.set(relativePath, source);
  return source ?? undefined;
}

/**
 * Every module under `src` the app could bundle, its source keyed src-relative.
 *
 * The index is otherwise filled a module at a time, because following an
 * `export … from` reaches only the handful of modules a route or page names. A
 * guard that asks a question about *every* module — which client bundle can pull
 * this in, which environment name is read where — needs the whole set at once,
 * and reads it from disk for the same reason the readers in
 * `src/test/source-scan` do: no eager `?raw` glob, so importing this module does
 * not register the tree into the graph of every test file that uses it.
 *
 * Two kinds of file are left out, both deliberately:
 *
 *   - **a test**, which no bundler ever places in a bundle (`*.test.ts`,
 *     `*.test.tsx`, and anything under `test/` — the shared harness, the fake
 *     seams, the fixtures). Reading environment names out of `setup.ts` would
 *     report the suite's own scaffolding as if it shipped.
 *   - **anything not readable**, which is simply absent rather than an error, the
 *     same rule every reader here follows.
 *
 * The cache is the one `moduleSource` fills, so a path read here is not read
 * again by `resolveModule`, and a resolution that follows an import into a module
 * this walk already read costs nothing. Keys are in this module's canonical
 * space (`lib/r2.ts`, `app/feed/page.tsx`), which is what a resolver's importer
 * argument is written in.
 */
let moduleSourceCache: Record<string, string> | undefined;

export function readModuleSources(): Record<string, string> {
  if (moduleSourceCache !== undefined) return moduleSourceCache;

  const srcRoot = path.join(projectRoot, "src");
  const sources: Record<string, string> = {};
  for (const file of walkFiles(srcRoot)) {
    const relativePath = path.relative(srcRoot, file).split(path.sep).join("/");
    if (!/\.tsx?$/.test(relativePath)) continue;
    if (relativePath.includes(".test.") || relativePath.startsWith("test/")) continue;
    const source = moduleSource(relativePath);
    if (source !== undefined) sources[relativePath] = source;
  }
  moduleSourceCache = sources;
  return moduleSourceCache;
}

/**
 * A path as an `src`-relative one: an importer written as `../app/foo.ts` is
 * `app/foo.ts`, and one beside this module (`./foo.ts`) is `test/foo.ts`.
 * Idempotent, so a path already in this space is left alone.
 */
function canonicalPath(globKey: string): string {
  if (globKey.startsWith("./")) return `test/${globKey.slice(2)}`;
  return globKey.startsWith("../") ? globKey.slice(3) : globKey;
}

/** Every file under `dir`, recursively, skipping `node_modules`. */
function walkFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      walkFiles(full, out);
    } else {
      out.push(full);
    }
  }
  return out;
}

/**
 * Every file under `src/app`, walked once and remembered for the run.
 *
 * The three leaf readers below share this walk, so a test file that asks for
 * both the pages and the routes reads the tree once rather than once per leaf.
 */
let appFiles: string[] | undefined;
function appTree(): string[] {
  appFiles ??= walkFiles(path.join(projectRoot, "src", "app"));
  return appFiles;
}

/** A `src/app` leaf: the key it is known by, and the file it names. */
interface AppLeaf {
  key: string;
  file: string;
}

/**
 * The `src/app` leaves named `leaf`, keyed in Vite's glob space (`../app/…`).
 *
 * Walking for the leaf's *filename* is the glob's own rule: `page.tsx` is how the
 * router finds a page, and a `layout.tsx` default-exports a component just as a
 * page does, so the name is the only thing telling the two apart. Only the paths
 * are computed here — reading text is the step that is worth caching separately.
 */
const leafCache = new Map<string, AppLeaf[]>();
function appLeaves(leaf: string): AppLeaf[] {
  const cached = leafCache.get(leaf);
  if (cached !== undefined) return cached;
  const srcRoot = path.join(projectRoot, "src");
  const leaves: AppLeaf[] = [];
  for (const file of appTree()) {
    if (path.basename(file) !== leaf) continue;
    leaves.push({ key: `../${path.relative(srcRoot, file).split(path.sep).join("/")}`, file });
  }
  leafCache.set(leaf, leaves);
  return leaves;
}

/** The `src/app` leaves named `leaf`, their text keyed by path and remembered. */
const leafSourceCache = new Map<string, Record<string, string>>();
function readLeafSources(leaf: string): Record<string, string> {
  const cached = leafSourceCache.get(leaf);
  if (cached !== undefined) return cached;
  const sources: Record<string, string> = {};
  for (const { key, file } of appLeaves(leaf)) {
    try {
      sources[key] = readFileSync(file, "utf8");
    } catch {
      // A file that vanished between the walk and the read is simply not read.
    }
  }
  leafSourceCache.set(leaf, sources);
  return sources;
}

/**
 * The framework's page leaves, keyed by path, so discovery reads what each one
 * exports rather than trusting its filename.
 *
 * An eager `?raw` glob here made Vite register every page into the graph of
 * *each* test file that imported this module, whether or not it looked at one;
 * reading from disk on demand holds that to the pages discovery actually names,
 * once.
 */
export function readPageSources(): Record<string, string> {
  return readLeafSources("page.tsx");
}

/** The framework's api-route leaves, keyed by path. */
export function readRouteSources(): Record<string, string> {
  return readLeafSources("route.ts");
}

/** The paths of the tests that sit beside a route, `route.test.ts`. */
export function readRouteTestFiles(): string[] {
  return appLeaves("route.test.ts").map(({ key }) => key);
}

/**
 * The modules under `src/<root>` that `keep` accepts, each as a loader keyed by
 * its path in Vite's glob space and loaded on demand.
 *
 * A lazy raw glob is cheap per module but still resolves every match
 * into the module graph of the test file that names it: collecting
 * `rendered-a11y.test.tsx` walked all ~100 components and pages before a single
 * case ran. Walking the tree with `readdirSync` and importing a file only when
 * its case asks for it — as `moduleSource` reads text on demand — keeps that
 * cost to the handful a run actually mounts. The keys are relative to *this*
 * directory (`../components/…`, `../app/…`), the space the consuming tests and
 * the leaf readers above are written in; this module and those tests all sit in
 * `src/test`.
 */
function moduleLoaders<T>(
  root: string,
  keep: (file: string) => boolean,
): Record<string, () => Promise<T>> {
  const srcRoot = path.join(projectRoot, "src");
  const loaders: Record<string, () => Promise<T>> = {};
  for (const file of walkFiles(path.join(srcRoot, root))) {
    if (!keep(file)) continue;
    const key = `../${path.relative(srcRoot, file).split(path.sep).join("/")}`;
    loaders[key] = () => import(file) as Promise<T>;
  }
  return loaders;
}

/**
 * The app's page modules, loaded on demand, so a page that fails to load is one
 * case's problem rather than the whole suite's.
 *
 * The same leaf pattern as `readPageSources` — the root `page.tsx` and any nested
 * one — and a `layout.tsx` default-exports a component just as a page does, so
 * the filename is what tells the two apart.
 */
export function pageComponentModules(): Record<string, () => Promise<{ default: ComponentType }>> {
  return moduleLoaders<{ default: ComponentType }>(
    "app",
    (file) => path.basename(file) === "page.tsx",
  );
}

/**
 * Every component module, keyed the way the glob keyed them and loaded on
 * demand.
 *
 * A component's own test file is not a component to mount, so it is left out —
 * the same set the glob filtered afterwards, decided as the tree is walked.
 */
export function componentModuleLoaders(): Record<
  string,
  () => Promise<Record<string, unknown>>
> {
  return moduleLoaders<Record<string, unknown>>(
    "components",
    (file) => file.endsWith(".tsx") && !path.basename(file).includes(".test."),
  );
}

/** `specifier` resolved against the directory of the file at `importer`, dot-segments folded. */
export function joinModulePath(importer: string, specifier: string): string {
  const segments = importer.split("/").slice(0, -1).concat(specifier.split("/"));
  const out: string[] = [];
  for (const segment of segments) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (out.length > 0 && out[out.length - 1] !== "..") out.pop();
      else out.push("..");
      continue;
    }
    out.push(segment);
  }
  return out.join("/");
}

/**
 * The `src`-relative path a specifier names, resolved against the file that wrote
 * it, or `undefined` when the specifier is not one this project owns.
 *
 * A relative specifier is joined against the importer's directory; the `@/` alias
 * (`@/* → src/*`) is already `src`-relative, so it is the rest of the specifier
 * verbatim. Anything else — `next/server`, any package — is not ours to place. An
 * importer may be given in Vite's glob space or already canonical; both fold.
 */
export function modulePathFor(importer: string, specifier: string): string | undefined {
  if (specifier.startsWith("@/")) return specifier.slice(2);
  if (specifier.startsWith(".")) return joinModulePath(canonicalPath(importer), specifier);
  return undefined;
}

/**
 * Resolves a specifier written inside the project's source to the module it
 * names, or `undefined` when it names no module the index holds.
 *
 * The extension may be omitted, so the candidates are tried in the order a
 * bundler would; a specifier that matches nothing yields `undefined`, which
 * leaves a re-export trusted as written rather than dropping a real handler.
 */
export const resolveModule: ModuleResolver = (specifier, importer) => {
  const base = modulePathFor(importer, specifier);
  if (base === undefined) return undefined;
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
  ]) {
    const source = moduleSource(candidate);
    if (source !== undefined) return { path: candidate, source };
  }
  return undefined;
};
