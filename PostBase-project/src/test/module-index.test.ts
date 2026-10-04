/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import {
  componentModuleLoaders,
  joinModulePath,
  modulePathFor,
  pageComponentModules,
  readModuleSources,
  readPageSources,
  readRouteSources,
  readRouteTestFiles,
  resolveModule,
} from "@/test/module-index";
// The index as *source*, so the decision to read on demand rather than read the
// whole tree up front can be asserted without re-measuring collect time.
import moduleIndexSource from "./module-index.ts?raw";

/**
 * The shared module index's path arithmetic.
 *
 * Several guards read a module's *exports* to learn its role, and reading an
 * `export … from` means turning a specifier into the path it names — the same
 * join and the same `@/` alias for every one of them. Those rules are pinned here
 * so a change to how a dot-segment folds, or how the alias is spelled, fails once
 * rather than quietly pointing some guard at the wrong file.
 *
 * Resolution works in one space, `src`-relative (`app/feed/page.tsx`,
 * `test/source-scan.ts`), so the fixtures below are in it. An importer may also
 * arrive in Vite's glob space — `../app/…`, `./…` — and both are exercised, since
 * that is what the call sites actually hand over.
 */

describe("joinModulePath", () => {
  it("resolves a relative specifier against the importer's directory", () => {
    expect(joinModulePath("app/feed/page.tsx", "./impl")).toBe("app/feed/impl");
    expect(joinModulePath("app/feed/page.tsx", "../handlers")).toBe("app/handlers");
    expect(joinModulePath("app/page.tsx", "./impl")).toBe("app/impl");
  });

  it("folds dot-segments, and keeps a leading `..` it cannot fold", () => {
    expect(joinModulePath("app/feed/page.tsx", "./nested/../impl")).toBe("app/feed/impl");
    expect(joinModulePath("app/feed/page.tsx", "../../lib/x")).toBe("lib/x");
    // Nothing under `app` is left to cancel the extra `..`, so it survives.
    expect(joinModulePath("app/page.tsx", "../../../outside")).toBe("../../outside");
  });
});

describe("modulePathFor", () => {
  it("places a relative specifier next to its importer", () => {
    expect(modulePathFor("app/feed/page.tsx", "./impl")).toBe("app/feed/impl");
  });

  it("folds an importer given in Vite's glob space", () => {
    expect(modulePathFor("../app/feed/page.tsx", "./impl")).toBe("app/feed/impl");
    expect(modulePathFor("./module-index.test.ts", "./source-scan")).toBe("test/source-scan");
  });

  it("places the `@/` alias at the tree root", () => {
    expect(modulePathFor("app/feed/page.tsx", "@/lib/x")).toBe("lib/x");
    expect(modulePathFor("app/feed/page.tsx", "@/test/source-scan")).toBe("test/source-scan");
  });

  it("refuses a bare package specifier, which is not the project's to place", () => {
    expect(modulePathFor("app/page.tsx", "next/server")).toBeUndefined();
    expect(modulePathFor("app/page.tsx", "react")).toBeUndefined();
  });
});

describe("resolveModule", () => {
  it("finds a module by relative specifier, with the extension omitted", () => {
    expect(resolveModule("./source-scan", "./module-index.test.ts")?.path).toBe(
      "test/source-scan.ts",
    );
  });

  it("finds a module by `@/` alias", () => {
    expect(resolveModule("@/test/source-scan", "../app/page.tsx")?.path).toBe(
      "test/source-scan.ts",
    );
  });

  it("returns nothing for a specifier that names no module", () => {
    expect(resolveModule("./definitely-not-a-module", "app/page.tsx")).toBeUndefined();
    expect(resolveModule("@/no/such/module", "app/page.tsx")).toBeUndefined();
    // A bare package specifier is not ours to resolve.
    expect(resolveModule("next/server", "app/page.tsx")).toBeUndefined();
  });
});

describe("the source read", () => {
  it("reads a module on demand instead of eagerly globbing the whole tree", () => {
    // An eager whole-tree `?raw` glob cost ~1.8s of collect for *every* test file
    // that imported this module, and almost none of what it read was ever looked
    // up. Pinned here so an "index it all up front" change fails first, rather
    // than quietly taxing every run.
    expect(moduleIndexSource).not.toMatch(/\.\.\/\*\*\/\*\.ts/);
    expect(moduleIndexSource).toContain("readFileSync");
  });

  it("has left `import.meta.glob` behind, so no source is registered eagerly", () => {
    // The eager `?raw` globs over `../app/**` were the last users, and each one
    // made Vite read and register every page and route into *every* test file
    // that imported this module, whether or not it looked. Pinned so a glob
    // cannot quietly come back.
    expect(moduleIndexSource).not.toContain("import.meta.glob");
  });
});

describe("readModuleSources", () => {
  it("reads every module the app could bundle, keyed `src`-relative", () => {
    const sources = readModuleSources();
    const paths = Object.keys(sources);

    expect(paths.length).toBeGreaterThan(150);
    // The keys are the space a resolver's importer argument is written in, so a
    // guard can index one with the path it resolved an import to.
    expect(paths).toContain("lib/r2.ts");
    expect(paths).toContain("components/landing/live-product-preview.tsx");
    // The *text*, not just the key: a guard reads environment names out of it.
    expect(sources["lib/r2.ts"]).toContain("R2_SECRET_ACCESS_KEY");
  });

  it("leaves out the tests, which no bundler ever places in a bundle", () => {
    const paths = Object.keys(readModuleSources());
    expect(paths.some((path) => path.includes(".test."))).toBe(false);
    expect(paths.some((path) => path.startsWith("test/"))).toBe(false);
    expect(paths.some((path) => path.startsWith("app/") && path.endsWith("/route.test.ts"))).toBe(
      false,
    );
  });

  it("reads each module once, handing the same record back", () => {
    expect(readModuleSources()).toBe(readModuleSources());
  });
});

describe("the app leaf readers", () => {
  it("keys the pages the way the glob did, reading each one's text from disk", () => {
    const pages = readPageSources();
    const paths = Object.keys(pages);

    // The root page and a nested one, in the space the consumer's `routePath`
    // and its `covers("/…")` cases are written in.
    expect(paths).toContain("../app/page.tsx");
    expect(paths).toContain("../app/(main)/feed/page.tsx");
    // Only `page.tsx` leaves: a layout default-exports a component too.
    expect(paths.every((path) => path.endsWith("/page.tsx"))).toBe(true);
    // The *text*, not just the key — that is what discovery reads exports from.
    expect(pages["../app/page.tsx"]).toContain("export default");
  });

  it("keys the api routes the way the glob did", () => {
    const routes = readRouteSources();
    const paths = Object.keys(routes);
    expect(paths.length).toBeGreaterThan(0);
    expect(paths.every((path) => path.endsWith("/route.ts"))).toBe(true);
    expect(paths.some((path) => path.endsWith("/api/posts/route.ts"))).toBe(true);
  });

  it("lists the tests that sit beside a route", () => {
    const tests = readRouteTestFiles();
    expect(tests.length).toBeGreaterThan(0);
    expect(tests.every((path) => path.endsWith("/route.test.ts"))).toBe(true);
  });

  it("reads each leaf once, handing the same record back", () => {
    expect(readPageSources()).toBe(readPageSources());
    expect(readRouteSources()).toBe(readRouteSources());
  });
});

describe("the component enumeration", () => {
  it("walks the directory on demand instead of globbing every component", () => {
    // The old `import.meta.glob("../components/**/*.tsx")` resolved all ~100
    // component modules into the graph of whichever test file held it, before a
    // single case ran. Pinned so a return to the glob fails here rather than
    // quietly taxing collection again.
    expect(moduleIndexSource).not.toContain("components/**");
    expect(moduleIndexSource).toContain("readdirSync");
  });

  it("walks the pages the same way, instead of globbing the module leaves", () => {
    // The lazy `import.meta.glob<…>` page-module glob was the last parameterised
    // one; the leaf readers now walk the tree too. Pinned so pages cannot drift
    // back to a glob while the rest of the index reads on demand.
    expect(moduleIndexSource).not.toContain("import.meta.glob");
  });

  it("keys the pages the way the glob did, and loads each only when asked", async () => {
    const loaders = pageComponentModules();
    const paths = Object.keys(loaders);

    // The root page and a nested one, in Vite's glob space — the space the
    // consumer's `routePath` and its `covers("/…")` cases are written in.
    expect(paths).toContain("../app/page.tsx");
    expect(paths).toContain("../app/(main)/feed/page.tsx");
    // Only `page.tsx` leaves: a layout default-exports a component too, and the
    // filename is the whole distinction.
    expect(paths.every((path) => path.endsWith("/page.tsx"))).toBe(true);

    const mod = await loaders["../app/page.tsx"]();
    expect(typeof mod.default).toBe("function");
  });

  it("keys every component the way the glob did, and loads it only when asked", async () => {
    const loaders = componentModuleLoaders();
    const paths = Object.keys(loaders);

    // A handful more than the ~72 real components, so a walk that stopped early
    // or kept a test file fails here.
    expect(paths.length).toBeGreaterThan(70);
    expect(paths.every((path) => path.startsWith("../components/"))).toBe(true);
    expect(paths.some((path) => path.endsWith("/ui/button.tsx"))).toBe(true);
    // A component's own test is not a component to mount.
    expect(paths.some((path) => path.includes(".test."))).toBe(false);

    const mod = await loaders["../components/ui/button.tsx"]();
    expect(Object.keys(mod)).toContain("Button");
  });
});
