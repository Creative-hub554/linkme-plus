import { describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as scopesModule from "../../.freebuff/coverage-scopes.mjs";

/**
 * The scope algebra, pinned directly.
 *
 * `.freebuff/coverage-scopes.mjs` is imported by all three coverage scripts, and
 * the one function in it that decides *which files a threshold covers* is
 * `globToRegExp`. Everything the gates do downstream is built on that match: a
 * glob that is too greedy holds files it should not, one that is too narrow
 * flakes and floors nothing. The other coverage tests only ever exercise it with
 * the exact keys the config uses (`src/lib/**` and the rest), so a change to the
 * escaping or the anchoring could pass them all while quietly mis-scoping a
 * directory. This pins the edges the config relies on instead: `**` spans
 * directories, `*` stays inside one, both ends are anchored, the match is
 * case-sensitive, and regex metacharacters in the glob stay literal.
 *
 * `relativePath` and `aggregate` are pinned here too, because they carry the
 * contract the matching depends on — a report key normalized to a project-relative
 * forward-slashed path, and an aggregate computed from raw counts rather than
 * averaged percentages (with the empty-scope 100% display convention that makes
 * the proposer skip a glob that matched nothing).
 */

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));

const { globToRegExp, relativePath, aggregate } = scopesModule as unknown as {
  globToRegExp: (glob: string) => RegExp;
  relativePath: (file: string) => string;
  aggregate: (
    entries: { [metric: string]: { covered: number; total: number } | undefined }[],
  ) => Record<string, { covered: number; total: number; pct: number }>;
};

/** Whether a project-relative path is inside a glob's scope. */
function matches(glob: string, file: string): boolean {
  return globToRegExp(glob).test(file);
}

describe("globToRegExp", () => {
  it("spans directories with `**`", () => {
    expect(matches("src/lib/**", "src/lib/a.ts")).toBe(true);
    expect(matches("src/lib/**", "src/lib/db/schema.ts")).toBe(true);
  });

  it("anchors both ends, so a partial path does not match", () => {
    // A leading prefix or a longer first segment must not slip inside.
    expect(matches("src/lib/**", "xsrc/lib/a.ts")).toBe(false);
    expect(matches("src/lib/**", "src/libx/a.ts")).toBe(false);
    // The trailing slash is part of the glob: `src/lib/**` is `src/lib/` + anything.
    expect(matches("src/lib/**", "src/lib")).toBe(false);
    expect(matches("src/lib/**", "src/lib/")).toBe(true);
  });

  it("is case-sensitive", () => {
    expect(matches("src/lib/**", "SRC/lib/a.ts")).toBe(false);
  });

  it("keeps a single `*` inside one path segment", () => {
    expect(matches("src/*.ts", "src/a.ts")).toBe(true);
    expect(matches("src/*.ts", "src/lib/a.ts")).toBe(false);
  });

  it("lets `*` and `**` combine, `**` crossing directories", () => {
    expect(matches("src/**/*.ts", "src/lib/a.ts")).toBe(true);
    expect(matches("src/**/*.ts", "src/lib/db/a.ts")).toBe(true);
    // `**` here is `.*` between two slashes, so it needs at least one directory:
    // the zero-directory `src/a.ts` is not matched. That is why the config states
    // its scopes as a trailing `/**` rather than a leading `**/`.
    expect(matches("src/**/*.ts", "src/a.ts")).toBe(false);
  });

  it("treats regex metacharacters in a glob as literal text", () => {
    // `+` must not become a quantifier...
    expect(matches("src/a+b/**", "src/a+b/x.ts")).toBe(true);
    expect(matches("src/a+b/**", "src/ab/x.ts")).toBe(false);
    expect(matches("src/a+b/**", "src/aab/x.ts")).toBe(false);
    // ...and `.` must not match any character.
    expect(matches("src/a.ts", "src/a.ts")).toBe(true);
    expect(matches("src/a.ts", "src/aXts")).toBe(false);
  });
});

describe("relativePath", () => {
  it("makes an absolute path project-relative and forward-slashed", () => {
    expect(relativePath(path.join(projectRoot, "src", "lib", "a.ts"))).toBe("src/lib/a.ts");
  });

  it("resolves a relative key to itself, separators normalized", () => {
    // What the report fixtures rely on: a relative key survives the round trip
    // whatever the checkout's casing or separator.
    expect(relativePath("src/lib/a.ts")).toBe("src/lib/a.ts");
    expect(relativePath("src\\lib\\a.ts")).toBe("src/lib/a.ts");
  });
});

describe("aggregate", () => {
  const metric = (covered: number, total: number) => ({ covered, total });

  it("sums raw counts rather than averaging percentages", () => {
    const result = aggregate([{ lines: metric(75, 200) }, { lines: metric(100, 100) }]);
    expect(result.lines.covered).toBe(175);
    expect(result.lines.total).toBe(300);
    expect(result.lines.pct).toBeCloseTo((175 / 300) * 100, 6);
    // The plain mean of 75% and 100% would be 87.5%, which this is not.
    expect(result.lines.pct).not.toBeCloseTo(87.5, 2);
  });

  it("reads 100% for a scope with no measured files", () => {
    // A display convention, not evidence — the proposer skips a zero-file glob so
    // it never proposes a raise from this number.
    const result = aggregate([]);
    for (const name of ["lines", "statements", "branches", "functions"]) {
      expect(result[name]).toEqual({ covered: 0, total: 0, pct: 100 });
    }
  });
});
