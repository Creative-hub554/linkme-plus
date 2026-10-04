import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CLIENT_BUILD_CONFIGS,
  clientBoundary,
  inlinedClientValues,
  isPublicEnvName,
  publicEnvNames,
  publicSecretNames,
  serverEnvReads,
} from "@/test/convention-guards";
import { modulePathFor, readModuleSources } from "@/test/module-index";
import { importSpecifiers, reExportSpecifiers } from "@/test/source-scan";

/**
 * Nothing server-only may reach a client bundle.
 *
 * `NEXT_PUBLIC_` is the whole contract: the bundler inlines exactly those names
 * into code that ships to a browser, and every other environment name belongs to
 * the server. So a module that reads one of the others is wrong twice over — the
 * client cannot have the value (the read is `undefined`, or throws outright,
 * because there is no `process` in a browser to read `env` off), and if the value
 * *were* inlined it would be published to every visitor. The two are refused
 * together because they are one mistake with two symptoms.
 *
 * The check is a walk rather than a scan, because "can reach" is a graph question
 * and the answer is not a filename. A module is in a client bundle when a client
 * boundary reaches it — through imports, through dynamic imports, through
 * re-exports — however many edges away it is, and `src/lib/r2.ts` reads
 * `R2_SECRET_ACCESS_KEY` today without publishing anything only because nothing a
 * client boundary reaches imports it. One `import { upload } from "@/lib/r2"` in a
 * component is the whole difference, and no test that lists files would see it.
 *
 * Four controls keep the check from passing because it looked at nothing, which is
 * the only failure mode a clean run cannot show:
 *
 *   - the tree really is read (`readModuleSources`), and the roots really are
 *     found — 86 modules carry the directive today, and the walk must reach modules
 *     *beyond* them, which is the edges being followed rather than the roots listed;
 *   - the server side of the same rule is non-vacuous: `src/lib/r2.ts` is read by
 *     the detector and reports the secret it holds, so the detector is known to fire
 *     on this repo's own code and would fire the moment that module entered the graph;
 *   - a read planted into a reachable module fails the sweep, in each of the
 *     spellings this repo writes (and in the alias spelling it writes *most*) —
 *     the proof that the walk follows an edge and that the path, not a fixture, is
 *     what answers;
 *   - the build configs are checked too, and a value planted into one fails there.
 *
 * The vocabulary half is a ratchet rather than a rule: the set of names declared
 * `NEXT_PUBLIC_` is written down here, so publishing a new value is an edit to this
 * file — a line in a diff a reviewer reads — instead of a prefix typed in a
 * component. And a public name carrying a credential word
 * (`NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY`) is refused in every file, the example
 * environment file and the generated `Env` interface included.
 */

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** A file at the project root, read once per call site that needs it. */
function readProjectFile(relativePath: string): string {
  return readFileSync(path.join(projectRoot, relativePath), "utf8");
}

/** A client component the walk must reach — the root the planted reads hang off. */
const CLIENT_ROOT = "components/landing/live-product-preview.tsx";

/** The module a planted read is put in, so the leak is never in a boundary itself. */
const PLANTED_MODULE = "lib/planned-leak.ts";

/** The files whose whole vocabulary is a claim about what is public. */
const VOCABULARY_FILES = [".env.example", "worker-configuration.d.ts"];

/**
 * Every name declared `NEXT_PUBLIC_` anywhere it can be declared: the app's own
 * modules, the example environment file, and the generated `Env` interface.
 *
 * `src/test` is absent from the module set for the same reason the walk does not
 * read it — a test file is not a bundle — so the vocabulary is taken from the code
 * that ships plus the two files that declare what ships.
 */
function declaredPublicNames(): string[] {
  const sources = readModuleSources();
  const names = new Set<string>();
  for (const source of Object.values(sources)) {
    for (const name of publicEnvNames(source)) names.add(name);
  }
  for (const file of VOCABULARY_FILES) {
    for (const name of publicEnvNames(readProjectFile(file))) names.add(name);
  }
  return [...names].sort();
}

/**
 * The module a specifier names, in the order a bundler would try.
 *
 * `modulePathFor` owns the path arithmetic — the `@/` alias, a relative specifier
 * folded against its importer — so this walk and the resolution the other guards
 * use cannot drift to two ideas of where a specifier points. The extension order is
 * the bundler's, and it is the same one `resolveModule` uses.
 */
function resolveImported(sources: Record<string, string>, importer: string, specifier: string) {
  const base = modulePathFor(importer, specifier);
  if (base === undefined) return undefined;
  return [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`].find(
    (candidate) => sources[candidate] !== undefined,
  );
}

/**
 * The modules a client bundle can pull in: every boundary, plus everything the
 * boundaries reach.
 *
 * Both directions of an edge are followed. An import is the obvious one; a
 * re-export is the one that hides (`export { upload } from "@/lib/r2"` in a client
 * module puts that module in the bundle with no local name to notice), and a
 * dynamic `import("…")` is the one written on purpose, late, where a bundle
 * boundary is least likely to be re-read.
 */
function clientGraph(sources: Record<string, string>): { roots: string[]; reached: Set<string> } {
  const roots = Object.keys(sources).filter((path) => clientBoundary(sources[path]));
  const reached = new Set(roots);
  const queue = [...roots];

  while (queue.length > 0) {
    const importer = queue.pop() as string;
    const specifiers = [
      ...importSpecifiers(sources[importer]),
      ...reExportSpecifiers(sources[importer]),
    ];
    for (const specifier of specifiers) {
      const target = resolveImported(sources, importer, specifier);
      if (target === undefined || reached.has(target)) continue;
      reached.add(target);
      queue.push(target);
    }
  }

  return { roots, reached };
}

/** Every environment read a client bundle would carry, as `module: NAME at line N`. */
function clientEnvLeaks(sources: Record<string, string>): string[] {
  const leaks: string[] = [];
  for (const path of [...clientGraph(sources).reached].sort()) {
    for (const read of serverEnvReads(sources[path])) leaks.push(`${path}: ${read}`);
  }
  return leaks;
}

/**
 * The real tree with one read planted in a module a client boundary reaches.
 *
 * The planted module is deliberately *not* a boundary: the boundary imports it, so
 * finding the read means following the edge rather than listing the files that
 * carry the directive. The import is a side-effect import, which is the shape a
 * leak is most likely to arrive in and the one no local name warns about.
 */
function withPlantedRead(read: string): Record<string, string> {
  const sources = { ...readModuleSources() };
  sources[PLANTED_MODULE] = `${read}\n`;
  sources[CLIENT_ROOT] = `${sources[CLIENT_ROOT]}\nimport "@/lib/planned-leak";\n`;
  return sources;
}

describe("the environment names a module reads", () => {
  it("reads `process.env.NAME` and names the line", () => {
    expect(serverEnvReads('const secret = process.env.AUTH_SECRET;\n')).toEqual([
      "AUTH_SECRET at line 1",
    ]);
    expect(serverEnvReads('// a mention of process.env.AUTH_SECRET is not a read\n')).toEqual([]);
  });

  it("reads the bracketed and optional-chained spellings the same way", () => {
    expect(serverEnvReads('const a = process.env["DATABASE_URL"];')).toEqual([
      "DATABASE_URL at line 1",
    ]);
    expect(serverEnvReads("const a = process.env?.DATABASE_URL;")).toEqual([
      "DATABASE_URL at line 1",
    ]);
    expect(serverEnvReads('const a = process.env?.["DATABASE_URL"];')).toEqual([
      "DATABASE_URL at line 1",
    ]);
  });

  it("reads an alias of the environment object, which is how this repo reads it", () => {
    const source = [
      "const runtimeEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};",
      "export const ACCOUNT_ID = runtimeEnv.R2_ACCOUNT_ID || \"\";",
    ].join("\n");
    expect(serverEnvReads(source)).toEqual(["R2_ACCOUNT_ID at line 2"]);
  });

  it("follows an alias of an alias rather than stopping at the first hop", () => {
    const source = [
      "const processEnv = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};",
      "const runtimeEnv = processEnv;",
      "export const key = runtimeEnv.R2_SECRET_ACCESS_KEY;",
    ].join("\n");
    expect(serverEnvReads(source)).toEqual(["R2_SECRET_ACCESS_KEY at line 3"]);
  });

  it("reads a name taken apart by destructuring, from the object or from an alias", () => {
    expect(serverEnvReads("const { DATABASE_URL } = process.env;")).toEqual([
      "DATABASE_URL at line 1",
    ]);
    expect(serverEnvReads("const { DATABASE_URL: url } = env;")).toEqual([]);
    const aliased = [
      "const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};",
      "const { AUTH_SECRET, R2_BUCKET_NAME } = env;",
    ].join("\n");
    expect(serverEnvReads(aliased)).toEqual([
      "AUTH_SECRET at line 2",
      "R2_BUCKET_NAME at line 2",
    ]);
  });

  it("reads the `import.meta.env` spelling", () => {
    expect(serverEnvReads("const a = import.meta.env.AUTH_SECRET;")).toEqual([
      "AUTH_SECRET at line 1",
    ]);
    // …and an import statement is not an environment object.
    expect(serverEnvReads('import { meta } from "./meta";')).toEqual([]);
  });

  it("leaves a public name alone, and the bundler's own `NODE_ENV`", () => {
    expect(serverEnvReads("const a = process.env.NEXT_PUBLIC_SUPABASE_URL;")).toEqual([]);
    expect(serverEnvReads('const a = import.meta.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;')).toEqual([]);
    // The bundler replaces `process.env.NODE_ENV` with a literal in every bundle:
    // it is neither a secret nor a value the server owns. The allowance is pinned
    // so it stays a decision rather than a hole.
    expect(isPublicEnvName("NODE_ENV")).toBe(true);
    expect(serverEnvReads('const dev = process.env.NODE_ENV === "development";')).toEqual([]);
  });

  it("names each read once, at the first line it appears on", () => {
    const source = [
      "const a = process.env.AUTH_SECRET;",
      "const b = process.env.AUTH_SECRET;",
      "const c = process.env.DATABASE_URL;",
    ].join("\n");
    expect(serverEnvReads(source)).toEqual(["AUTH_SECRET at line 1", "DATABASE_URL at line 3"]);
  });
});

describe("the vocabulary a `NEXT_PUBLIC_` name carries", () => {
  it("flags a credential published under the public prefix", () => {
    expect(publicSecretNames("const k = process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY;")).toEqual(
      ["NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY — SERVICE_ROLE cannot be published"],
    );
    expect(publicSecretNames('const k = process.env["NEXT_PUBLIC_R2_ACCESS_KEY_ID"];')).toEqual([
      "NEXT_PUBLIC_R2_ACCESS_KEY_ID — ACCESS_KEY cannot be published",
    ]);
  });

  it("reads the name out of a string and a template, not only a property", () => {
    expect(publicSecretNames('export const K = "NEXT_PUBLIC_STRIPE_SECRET_KEY";')).toEqual([
      "NEXT_PUBLIC_STRIPE_SECRET_KEY — SECRET cannot be published",
    ]);
    expect(publicSecretNames("const u = `https://x/${process.env.NEXT_PUBLIC_RESEND_API_KEY}`;")).toEqual(
      ["NEXT_PUBLIC_RESEND_API_KEY — API_KEY cannot be published"],
    );
  });

  it("leaves the browser-side key alone, which is public by design", () => {
    expect(publicSecretNames("const k = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;")).toEqual([]);
    expect(publicSecretNames('const k = "NEXT_PUBLIC_SUPABASE_URL";')).toEqual([]);
  });

  it("matches a credential word as a whole segment, not as letters inside one", () => {
    // The boundaries are what keep a name that merely *contains* a word quiet, so
    // the guard stays worth reading: `TOKENS_PER_PAGE` holds no token.
    expect(publicSecretNames("const k = process.env.NEXT_PUBLIC_TOKENS_PER_PAGE;")).toEqual([]);
    expect(publicSecretNames("const k = process.env.NEXT_PUBLIC_PRIVATEER_NAME;")).toEqual([]);
  });

  it("holds that boundary on both sides of the word, on names the first case never uses", () => {
    // Each half asked for separately, on fresh names: the credential word has to *begin* a
    // segment (`SUPABASE_AUTHTOKEN` carries `TOKEN` only inside one) and *end* one
    // (`PASSWORDLESS` begins with the word and runs straight past its boundary). Drop
    // either half and a name that merely carries the letters is refused as a credential,
    // which is what makes this worth a token walk rather than a grep over the prefix.
    expect(publicSecretNames("const k = process.env.NEXT_PUBLIC_SUPABASE_AUTHTOKEN;")).toEqual([]);
    expect(publicSecretNames("const k = process.env.NEXT_PUBLIC_PASSWORDLESS_URL;")).toEqual([]);

    // …and the silence is the boundary holding rather than the detector asleep: a real
    // segment is still refused, named for the word the boundary caught.
    expect(publicSecretNames("const k = process.env.NEXT_PUBLIC_AUTH_TOKEN;")).toEqual([
      "NEXT_PUBLIC_AUTH_TOKEN — TOKEN cannot be published",
    ]);
  });

  it("reads a declaration out of prose-free source, never out of a comment", () => {
    // This is the rule's own doc comment spelling a bad example. A regexp over the
    // file would flag it; a token walk cannot see it.
    expect(publicSecretNames("// never write NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY\n")).toEqual([]);
  });
});

describe("the build configs a client bundle is built from", () => {
  it("flags a `define` that replaces the environment object outright", () => {
    expect(inlinedClientValues('export default defineConfig({ define: { "process.env": env } });')).toEqual(
      ['define "process.env" replaces the environment in every bundle'],
    );
    expect(inlinedClientValues('export default defineConfig({ define: { "process?.env": env } });')).toEqual(
      ['define "process?.env" replaces the environment in every bundle'],
    );
  });

  it("flags the `globalThis.` spelling of the same wholesale replacement", () => {
    // Every spelling of the key is one decision — they all resolve to the same object —
    // so the third is asked for on its own here rather than only alongside the two above:
    // a config that reaches for the environment through `globalThis` publishes the lot
    // exactly as the bare spelling does.
    expect(
      inlinedClientValues(
        'export default defineConfig({ define: { "globalThis.process.env": env } });',
      ),
    ).toEqual(['define "globalThis.process.env" replaces the environment in every bundle']);
  });

  it("flags a value that reads a non-public name, and follows an alias to it", () => {
    expect(
      inlinedClientValues(
        "export default defineConfig({ define: { URL: JSON.stringify(process.env.DATABASE_URL) } });",
      ),
    ).toEqual(["define URL publishes DATABASE_URL at line 1"]);
    expect(
      inlinedClientValues(
        'export default { env: { SUPABASE_URL: process.env.SUPABASE_SERVICE_ROLE_KEY } };',
      ),
    ).toEqual(["env SUPABASE_URL publishes SUPABASE_SERVICE_ROLE_KEY at line 1"]);
    const aliased = [
      "const publicUrl = process.env.R2_PUBLIC_URL;",
      "export default { env: { PUBLIC_URL: publicUrl } };",
    ].join("\n");
    expect(inlinedClientValues(aliased)).toEqual(["env PUBLIC_URL publishes R2_PUBLIC_URL at line 2"]);
  });

  it("flags a value published under a credential name", () => {
    expect(
      inlinedClientValues('export default { env: { R2_SECRET_ACCESS_KEY: "an-inline-secret" } };'),
    ).toEqual(["env R2_SECRET_ACCESS_KEY publishes a value under a SECRET name"]);
    // A shorthand entry hands that name to the client with no value expression at all.
    expect(inlinedClientValues("export default { env: { DATABASE_URL } };")).toEqual([
      "env DATABASE_URL publishes DATABASE_URL at line 1",
    ]);
  });

  it("fails when a credential-named entry is planted into the real Vite config", () => {
    // The credential check asked again in the other key's spelling, on the real file: a
    // credential word in the *key* of a `define` entry publishes the value under that name,
    // and this is where such an entry would be written. The word branch reports no line —
    // the name is the whole finding — so the plant needs no arithmetic to state it.
    const planted = `${readProjectFile("vite.config.ts")}export const leaked = { define: { STRIPE_SECRET_KEY: "sk_live_x" } };\n`;
    expect(inlinedClientValues(planted)).toEqual([
      "define STRIPE_SECRET_KEY publishes a value under a SECRET name",
    ]);
  });

  it("leaves a substitution that names no environment value alone", () => {
    expect(
      inlinedClientValues('export default defineConfig({ define: { WeakRef: "globalThis.WeakRef" } });'),
    ).toEqual([]);
    // Inlining a public name is what the prefix asked for.
    expect(
      inlinedClientValues("export default { env: { URL: process.env.NEXT_PUBLIC_SUPABASE_URL } };"),
    ).toEqual([]);
  });

  it("finds nothing in the configs this app actually builds with", () => {
    for (const config of CLIENT_BUILD_CONFIGS) {
      expect(inlinedClientValues(readProjectFile(config)), config).toEqual([]);
    }
    // …and the check is not looking at nothing: the Vite config really does carry a
    // `define` block, which is the shape this detector reads.
    expect(readProjectFile("vite.config.ts")).toContain("define:");
  });

  it("fails when a server value is planted into the real Next config", () => {
    const planted = readProjectFile("next.config.mjs");
    const leaked = `${planted}export const leaked = { env: { DATABASE_URL: process.env.DATABASE_URL } };\n`;
    // The line is a line of the *real* file, so the number depends on the file's
    // length rather than on a number written here: the config plus one, counting the
    // config's own trailing newline as the end of its last line.
    const lines = planted.replace(/\n$/, "").split("\n").length;
    expect(inlinedClientValues(leaked)).toEqual([
      `env DATABASE_URL publishes DATABASE_URL at line ${lines + 1}`,
    ]);
  });
});

describe("the modules a client bundle reaches", () => {
  it("reads no server-only name, anywhere in the graph", () => {
    expect(clientEnvLeaks(readModuleSources())).toEqual([]);
  });

  it("reaches the whole tree's modules, and far more than the boundaries", () => {
    const sources = readModuleSources();
    const { roots, reached } = clientGraph(sources);

    expect(Object.keys(sources).length, "no modules were read").toBeGreaterThan(150);
    expect(sources["lib/r2.ts"], "the server-only modules are not in the set").toBeDefined();
    expect(roots.length, "no client boundary was found").toBeGreaterThan(50);
    expect(roots, "the walk's own root is not a boundary").toContain(CLIENT_ROOT);
    // More modules than roots is the edges being followed: a walk that listed the
    // boundaries and stopped would satisfy every other assertion here.
    expect(reached.size).toBeGreaterThan(roots.length);
    // A module no component names directly, reached through the chain.
    expect([...reached]).toContain("utils/supabase/client.ts");
  });

  it("would catch the server modules this rule exists for", () => {
    // The detector is known to fire on this repo's own code: `src/lib/r2.ts` reads
    // the R2 credentials through the alias idiom, and it is only *outside* the
    // graph that keeps the values off the client. Without this control a detector
    // that had stopped reading aliases would pass every case above by finding
    // nothing in a tree that reads its secrets the other way.
    const reads = serverEnvReads(readModuleSources()["lib/r2.ts"]);
    expect(reads.some((read) => read.startsWith("R2_SECRET_ACCESS_KEY "))).toBe(true);
    expect(reads.some((read) => read.startsWith("R2_ACCESS_KEY_ID "))).toBe(true);
  });

  it("fails on a read planted in a reached module, in every spelling", () => {
    const planted = {
      "a direct read": "export const key = process.env.R2_SECRET_ACCESS_KEY;",
      "a bracketed read": 'export const key = process.env["R2_SECRET_ACCESS_KEY"];',
      "a read through the alias":
        "const runtimeEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {}; export const key = runtimeEnv.R2_SECRET_ACCESS_KEY;",
      "a destructured read": "const { R2_SECRET_ACCESS_KEY } = process.env;",
      "an `import.meta.env` read": "export const key = import.meta.env.R2_SECRET_ACCESS_KEY;",
    };

    for (const [spelling, read] of Object.entries(planted)) {
      const leaks = clientEnvLeaks(withPlantedRead(read));
      expect(leaks, spelling).toContain(`${PLANTED_MODULE}: R2_SECRET_ACCESS_KEY at line 1`);
    }
  });

  it("does not flag the same read when nothing reaches it", () => {
    // The control for the control: the planted module is only a leak because a
    // boundary imports it. Unreachable, the identical read is noise, which is the
    // difference between this guard and a grep over the tree.
    const sources = { ...readModuleSources() };
    sources[PLANTED_MODULE] = "export const key = process.env.R2_SECRET_ACCESS_KEY;\n";
    expect(clientEnvLeaks(sources)).toEqual([]);
  });
});

describe("the public vocabulary", () => {
  it("is exactly the two names the app means to publish", () => {
    // A ratchet, not a rule: a third name here means a value this app now publishes
    // to every visitor, and adding one should be a deliberate edit to this list.
    expect(declaredPublicNames()).toEqual([
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      "NEXT_PUBLIC_SUPABASE_URL",
    ]);
  });

  it("holds no credential, wherever a public name is declared", () => {
    const sources = readModuleSources();
    for (const [path, source] of Object.entries(sources)) {
      expect(publicSecretNames(source), path).toEqual([]);
    }
    for (const file of VOCABULARY_FILES) {
      expect(publicSecretNames(readProjectFile(file)), file).toEqual([]);
    }
  });

  it("matches the names the client code reads", () => {
    // The declaration and the read are two halves of one claim: a name declared
    // public that nothing in a client bundle reads is a value published for
    // nothing, and a public name read from a module the graph reaches is the
    // declaration this ratchet is counting.
    const reads = readModuleSources();
    const declared = declaredPublicNames();
    for (const name of declared) {
      expect(publicEnvNames(reads["utils/supabase/client.ts"])).toContain(name);
    }
  });
});
