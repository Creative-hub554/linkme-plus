import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  DECLARED_EXPOSURES,
  databaseRelations,
  findingsFor,
  mergedRelations,
  probeSurface,
  probeVerdict,
  repositoryRelations,
  unknownsFor,
} from "../../.freebuff/anon-exposure.mjs";

/**
 * `.freebuff/anon-exposure.mjs` asks the Data API whether the anon key can read anything,
 * and fails when it can. The anon key is `NEXT_PUBLIC_SUPABASE_ANON_KEY` — it ships in the
 * browser bundle, so "reachable by the anon key" means "readable by anyone with devtools",
 * and the lockdown in `sql/rls-lockdown.sql` is what closed it.
 *
 * The readings are pinned here over fixtures rather than against a live project: the suite
 * has no network, and a check whose verdict is an exit status is exactly the kind whose
 * misreading is the failure mode — a pass issued for a state it never asked about. Three
 * contracts matter as much as the readings. The probes must stay `GET`s (this runs against
 * the production Data API and none of it has an undo), an answer in a state the check does
 * not model must refuse rather than pass (a bad key makes every probe fail the same way,
 * and counting that as a closed door is how a gate becomes a formality), and the CLI must
 * refuse when it has no key at all.
 */

const script = fileURLToPath(new URL("../../.freebuff/anon-exposure.mjs", import.meta.url));

/** A response body the Data API really returns when privilege refuses the relation. */
const DENIED = { code: "42501", details: null, hint: null, message: "permission denied for table users" };

/** The response PostgREST gives a relation it does not carry at all. */
const NOT_IN_SCHEMA = {
  code: "PGRST205",
  details: null,
  hint: null,
  message: "Could not find the table 'public.users' in the schema cache",
};

describe("the anon-exposure check's readings", () => {
  it("calls a 200 reachable — the one answer that is a finding", () => {
    // An empty body is still this. A reachable table that answers `[]` is a surface:
    // the rows are RLS's business, the reachability is the gate's.
    expect(probeVerdict(200, "[]")).toEqual({
      verdict: "reachable",
      detail: "HTTP 200 — the anon key can read this relation",
    });
    expect(probeVerdict(200, [{ id: "a-row" }]).verdict).toBe("reachable");
  });

  it("calls a privilege refusal closed — the lockdown's own answer", () => {
    const reading = probeVerdict(401, DENIED);
    expect(reading.verdict).toBe("closed");
    expect(reading.detail).toContain("permission denied for table users");
  });

  it("calls a schema-cache miss absent, and keeps it distinct from closed", () => {
    // Distinct because it proved something else: a relation the Data API does not carry
    // has said nothing about its privileges, and will start answering the moment the
    // schema cache reloads. A report that merged the two would overstate a green run.
    expect(probeVerdict(404, NOT_IN_SCHEMA).verdict).toBe("absent");
    expect(probeVerdict(404, NOT_IN_SCHEMA).verdict).not.toBe(probeVerdict(401, DENIED).verdict);
  });

  it("refuses an answer it does not model instead of reading it as closed", () => {
    // "Invalid API key" is the one that matters: a mistyped or rotated key fails every
    // probe the same way, and a check that counted those as closed would pass on an
    // answer it never got. The body has no `code`, which is how it is told apart.
    const badKey = probeVerdict(401, {
      message: "Invalid API key",
      hint: "Double check your Supabase `anon` or `service_role` API key.",
    });
    expect(badKey.verdict).toBe("unknown");
    expect(probeVerdict(500, { message: "unable to connect" }).verdict).toBe("unknown");
    expect(probeVerdict(200, "<html>gateway</html>").verdict).toBe("unknown");
    expect(probeVerdict(403, DENIED).verdict).toBe("unknown");
  });
});

describe("the relations the check probes", () => {
  it("names every table the schema declares and every table a migration creates", () => {
    const schemaSource = readFileSync(
      fileURLToPath(new URL("../../src/lib/db/schema.ts", import.meta.url)),
      "utf8",
    );
    const migrations = readdirSync(fileURLToPath(new URL("../../drizzle/", import.meta.url)))
      .filter((file) => file.endsWith(".sql"))
      .map((file) =>
        readFileSync(fileURLToPath(new URL(`../../drizzle/${file}`, import.meta.url)), "utf8"),
      );

    const relations = repositoryRelations({ schemaSource, migrationSources: migrations });
    for (const table of ["users", "posts", "messages", "comment_media"]) {
      expect({ table, named: relations.includes(table) }).toEqual({ table, named: true });
    }
    // The schema is the app's own list; a count that collapsed to a handful would mean the
    // scan stopped matching and the check silently stopped asking about most of the tree.
    expect(relations.length).toBeGreaterThan(40);
    expect(new Set(relations).size).toBe(relations.length);
  });

  it("takes the live schema's relations as they are named, whatever the source", () => {
    expect(databaseRelations([{ name: "users" }, { name: "posts" }, { name: "users" }])).toEqual([
      "posts",
      "users",
    ]);
    expect(databaseRelations([])).toEqual([]);
    expect(databaseRelations(null)).toEqual([]);
  });

  it("probes a relation named by more than one basis exactly once", () => {
    // Twice would be two verdicts for one door, and a report that could disagree with
    // itself about whether it is open.
    const merged = mergedRelations(["users", "posts"], ["users", "comments"]);
    expect(merged).toEqual(["comments", "posts", "users"]);
  });
});

describe("the verdicts", () => {
  const probe = (relation: string, verdict: string) => ({ relation, status: 200, verdict, detail: "" });

  it("fails on a relation the anon key can read and nothing declares", () => {
    const findings = findingsFor(
      [probe("users", "reachable"), probe("posts", "closed"), probe("messages", "absent")],
      [],
    );
    expect(findings).toEqual([
      {
        relation: "users",
        invariant: "anon-closed",
        detail: "users is reachable by the anon key — ",
      },
    ]);
  });

  it("does not fail an exposure the list declares on purpose, and still reports it", () => {
    // The declared list is the record that makes an exposure reviewable. Empty today —
    // and an addition to it is a line with a sentence on it, in the same diff as the code
    // that needs it, rather than a quieter edit to this gate.
    expect(DECLARED_EXPOSURES).toEqual([]);
    const declared = [{ relation: "public_pages", reason: "the signed-out landing page reads it" }];
    expect(findingsFor([probe("public_pages", "reachable")], declared)).toEqual([]);
  });

  it("names every probe it could not answer, so the run refuses rather than passing", () => {
    const probes = [probe("users", "closed"), probe("posts", "unknown"), probe("comments", "unknown")];
    expect(unknownsFor(probes).map((entry: { relation: string }) => entry.relation)).toEqual([
      "posts",
      "comments",
    ]);
    expect(unknownsFor([probe("users", "closed")])).toEqual([]);
  });
});

describe("the probes", () => {
  it("sends only GETs with no body — it cannot write to the API it inspects", () => {
    // The production Data API, reached with the key every visitor holds. A probe that
    // could write would be a worse bug than the exposure it looks for.
    const calls: { url: string; method?: string; body?: unknown }[] = [];
    const request = async (url: string, init: { method?: string; body?: unknown }) => {
      calls.push({ url, method: init.method, body: init.body });
      return { status: 401, body: DENIED, text: JSON.stringify(DENIED) };
    };

    return probeSurface({
      request,
      url: "https://example.supabase.co",
      key: "the-public-anon-key",
      relations: ["users", "posts"],
    }).then(() => {
      expect(calls).toHaveLength(2);
      for (const call of calls) {
        expect({ url: call.url.split("?")[0], method: call.method }).toEqual({
          url: `https://example.supabase.co/rest/v1/${call.url.split("?")[0].split("/").pop()}`,
          method: "GET",
        });
        expect({ url: call.url, hasBody: call.body !== undefined }).toEqual({
          url: expect.stringContaining("select=*&limit=1"),
          hasBody: false,
        });
      }
    });
  });

  it("asks about every relation it was given, one probe each", async () => {
    const asked: string[] = [];
    const request = async (url: string) => {
      asked.push(url.split("/rest/v1/")[1].split("?")[0]);
      return { status: 404, body: NOT_IN_SCHEMA, text: JSON.stringify(NOT_IN_SCHEMA) };
    };
    const probes = await probeSurface({
      request,
      url: "https://example.supabase.co",
      key: "the-public-anon-key",
      relations: ["users", "posts", "messages"],
    });
    expect(asked).toEqual(["users", "posts", "messages"]);
    expect(probes.every((entry: { verdict: string }) => entry.verdict === "absent")).toBe(true);
  });
});

describe("the CLI", () => {
  /**
   * The environment with both public values blanked, so the CLI sees no project at all.
   *
   * Blanked rather than deleted on purpose, the same reason the notifications check does
   * it: an empty value is the one shape the script's own guard reads as absent whatever
   * the host `process.env` does with a `delete`.
   */
  function withoutKey(): NodeJS.ProcessEnv {
    return { ...process.env, NEXT_PUBLIC_SUPABASE_URL: "", NEXT_PUBLIC_SUPABASE_ANON_KEY: "" };
  }

  it("refuses to report a pass when it has no key to ask with", () => {
    const result = spawnSync(process.execPath, [script, "--json"], {
      encoding: "utf8",
      env: withoutKey(),
    });
    expect(result.status).toBe(2);
    expect(JSON.parse(result.stdout)).toEqual(
      expect.objectContaining({ gate: "cannot-run", exitCode: 2, findings: [] }),
    );
  });

  it("explains itself on --help without touching the network", () => {
    const result = spawnSync(process.execPath, [script, "--help"], {
      encoding: "utf8",
      env: withoutKey(),
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("--json");
    expect(result.stdout).toContain("Exit 0");
  });
});
