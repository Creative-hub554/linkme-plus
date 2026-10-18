import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  MODELLED_TYPES,
  QUERIES,
  beyondRowFindings,
  danglingFindings,
  foundedFindings,
  impliedFindings,
  isJudgedRepeat,
} from "../../.freebuff/notifications-check.mjs";

/**
 * `.freebuff/notifications-check.mjs` turns the hand review of the seeded
 * notification inbox into a command: it asserts that every engagement the demo
 * seed's adoption writes has its notification, that nothing points at a row
 * that is gone, and that the stored wording is the database's own
 * `notification_message`. Its verdict is an exit status, so getting the reading
 * wrong is the failure mode — a check that passed over a broken inbox would be
 * worse than the hand queries it replaces.
 *
 * The reading is pinned here over fixtures rather than against a database: the
 * suite has none, and the candidates the script judges are plain rows. Two
 * contracts besides the readings matter. The statements must stay `select`s —
 * the check runs against live databases and none of them has an undo — and the
 * CLI must refuse to report anything at all when it cannot judge (no
 * `DATABASE_URL`), rather than pass by finding nothing.
 */

/** One row of the `IMPLIED` query, as the script's own judge reads it. */
interface ImpliedRow {
  type: string;
  user_id: string;
  source_user_id: string;
  target_id: string;
  notification_id: string | null;
  message: string | null;
  actor_name: string | null;
  expected_message: string | null;
  notification_count: number;
}

/** A well-formed implied row, so a fixture only states the field its case is about. */
function implied(overrides: Partial<ImpliedRow> = {}): ImpliedRow {
  return {
    type: "follow",
    user_id: "host-1",
    source_user_id: "member-1",
    target_id: "host-1",
    notification_id: "n-1",
    message: "Maya Chen started following you",
    actor_name: "Maya Chen",
    expected_message: "Maya Chen started following you",
    notification_count: 1,
    ...overrides,
  };
}

describe("the seeded-notification check's statements", () => {
  it("reads only selects, so it can never mutate the database it inspects", () => {
    // The whole point of a read-only probe is that a bug in the reading cannot
    // damage a live database. A statement that is not a `select` therefore has to
    // fail here, in the fast suite, rather than at the moment someone points the
    // check at production data.
    for (const [name, text] of Object.entries(QUERIES)) {
      const statement = text.trim().toLowerCase();
      expect({ name, reads: /^(select|with)\b/.test(statement) }).toEqual({ name, reads: true });
      expect({
        name,
        writes: /\b(insert\s+into|update\s+\S|delete\s+from|drop\s+|alter\s+table|truncate\s+)\b/.test(statement),
      }).toEqual({ name, writes: false });
    }
  });

  it("binds no parameters, so there is no interpolation to get wrong", () => {
    for (const [name, text] of Object.entries(QUERIES)) {
      expect({ name, interpolated: text.includes("${") }).toEqual({ name, interpolated: false });
    }
  });

  it("counts the rows behind every type the app can raise", () => {
    // A repeat is a count, so the statement has to say what it counts for each
    // kind of bell. A type added to `MODELLED_TYPES` without a branch here would
    // read every key of it as holding zero rows behind it — the count silently
    // zero, which is the one shape this check must never report as a pass.
    for (const type of MODELLED_TYPES) {
      expect({ type, branched: QUERIES.beyondRows.includes(`when '${type}' then`) }).toEqual({
        type,
        branched: true,
      });
    }
    for (const table of ["public.follows", "public.reactions", "public.comments"]) {
      expect({ table, read: QUERIES.beyondRows.includes(table) }).toEqual({ table, read: true });
    }
  });

  it("reads the whole table, so a repeat is caught without the adoption's rows", () => {
    // The reason this invariant is not scoped like the other four: a repeat left
    // by a killed seed run the adoption never wrote a row for. Scoping the count
    // by the seed's id prefixes would put that state back outside the check, so
    // the statement may name no prefix at all.
    expect(QUERIES.beyondRows).not.toMatch(/id::text\s+like\s+'c/);
    // While the four statements that are about the adoption still are scoped by
    // one — the difference is the point of the assertion above, not an accident.
    expect(QUERIES.implied).toMatch(/id::text\s+like\s+'c/);
  });
});

describe("the keys held above their rows", () => {
  /** One row of the `BELLS_BEYOND_ROWS` query, as the script's own judge reads it. */
  const held = (overrides: Record<string, unknown> = {}) => ({
    type: "comment",
    user_id: "member-1",
    source_user_id: "member-2",
    target_id: "post-1",
    held: 2,
    behind: 1,
    seed_owned: true,
    ...overrides,
  });

  it("calls a repeat the seed's own, with rows behind it, a defect", () => {
    // The state a restore re-firing the trigger leaves: the recursion the seed's
    // reconciliation exists for, so the check has to name it.
    expect(isJudgedRepeat(held())).toBe(true);
    expect(beyondRowFindings([held({ held: 3 })])).toEqual([
      expect.objectContaining({
        invariant: "inbox-repeats",
        key: "comment member-1 member-2 post-1",
      }),
    ]);
  });

  it("names both counts in the finding, because which bell goes is the seed's to decide", () => {
    const [finding] = beyondRowFindings([held({ held: 2, behind: 1 })]);
    expect(finding.detail).toContain("2 bells for 1 row(s) behind the key");
  });

  it("leaves a key with no rows behind it alone, whatever its actor", () => {
    // An engagement that was undone: the app never deletes a notification, so the
    // bell is history the seed keeps — and the check must not call it a defect, or
    // its advice (`npm run db:seed`) would not converge.
    expect(isJudgedRepeat(held({ behind: 0 }))).toBe(false);
    expect(beyondRowFindings([held({ behind: 0 })])).toEqual([]);
  });

  it("leaves a real account's second event alone", () => {
    // A viewer can follow, unfollow and follow again and mean both — two bells for
    // one row is then honest, and only a demo member's activity makes the count
    // exact, since a member has no credentials to act a second time with.
    expect(isJudgedRepeat(held({ seed_owned: false, user_id: "host-1" }))).toBe(false);
    expect(beyondRowFindings([held({ seed_owned: false })])).toEqual([]);
  });

  it("reads one key as one finding, because the statement groups by key", () => {
    // The statement answers *which* keys are over, one row per key, so the reading
    // is a mapping rather than a dedupe. Without the grouping a key with three
    // bells would arrive as three rows and the report would name one repeat twice
    // — the reading is only as clean as that `group by`.
    expect(QUERIES.beyondRows).toContain("group by n.type, n.user_id, n.source_user_id, n.target_id");
    expect(beyondRowFindings([held()])).toHaveLength(1);
  });
});

describe("the implied set", () => {
  it("passes a key whose notification is present and worded by the database", () => {
    expect(impliedFindings([implied()])).toEqual([]);
  });

  it("names a key the adoption implies but the inbox does not hold", () => {
    // The bug the seed's notification pass was written for: a cleared inbox that
    // a re-seed could not put back. The finding must name the key, because that
    // is the row `npm run db:seed` would restore.
    const findings = impliedFindings([
      implied({ notification_id: null, message: null, expected_message: "Maya Chen started following you", notification_count: 0 }),
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toEqual(
      expect.objectContaining({
        invariant: "implied-present",
        key: "follow host-1 member-1 host-1",
      }),
    );
  });

  it("reports a key written twice once, not once per row", () => {
    // A follow pair is one row and only a reaction dedupes, so an implied key
    // holding two notifications is a real defect — and a pair of rows must read
    // as one finding rather than two.
    const findings = impliedFindings([
      implied({ notification_id: "n-1", notification_count: 2 }),
      implied({ notification_id: "n-2", notification_count: 2 }),
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toEqual(expect.objectContaining({ invariant: "implied-unique" }));
  });

  it("names the notification whose message is not what the database renders", () => {
    const findings = impliedFindings([
      implied({ notification_id: "n-9", message: "You have a new follower" }),
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toEqual(
      expect.objectContaining({ invariant: "implied-wording", id: "n-9" }),
    );
  });

  it("holds a clear wording finding apart from a missing one", () => {
    // `notification_count` is 0 exactly when there is no row to word, so the two
    // readings cannot both fire for one key.
    const findings = impliedFindings([
      implied({ notification_id: null, message: null, notification_count: 0 }),
    ]);
    expect(findings.map((finding: { invariant: string }) => finding.invariant)).toEqual([
      "implied-present",
    ]);
  });
});

describe("the adopted inboxes", () => {
  it("passes a notification whose engagement is still there", () => {
    expect(
      foundedFindings([
        {
          id: "n-1",
          type: "follow",
          user_id: "host-1",
          source_user_id: "member-1",
          target_id: "host-1",
          founded: true,
        },
      ]),
    ).toEqual([]);
  });

  it("names the notification whose engagement is gone", () => {
    const findings = foundedFindings([
      {
        id: "n-2",
        type: "reaction",
        user_id: "host-1",
        source_user_id: "member-1",
        target_id: "post-1",
        founded: false,
      },
    ]);
    expect(findings).toEqual([
      expect.objectContaining({ invariant: "inbox-founded", id: "n-2" }),
    ]);
  });
});

describe("the table's references", () => {
  const dangling = (overrides: Record<string, unknown> = {}) => ({
    id: "n-1",
    type: "follow",
    user_id: "host-1",
    source_user_id: "member-1",
    target_type: "user",
    target_id: "host-1",
    recipient_missing: false,
    actor_missing: false,
    target_user_missing: false,
    target_post_missing: false,
    ...overrides,
  });

  it("passes a notification every reference of which resolves", () => {
    expect(danglingFindings([dangling()])).toEqual([]);
  });

  it("names each reference that is gone, in one finding per notification", () => {
    const findings = danglingFindings([
      dangling({ id: "n-1", actor_missing: true }),
      dangling({ id: "n-2", target_post_missing: true }),
      dangling({ id: "n-3", recipient_missing: true, target_user_missing: true }),
    ]);
    expect(findings.map((finding: { id: string }) => finding.id)).toEqual(["n-1", "n-2", "n-3"]);
    expect(findings[2].detail).toContain("recipient host-1");
    expect(findings[2].detail).toContain("target user host-1");
    expect(findings[2]).toEqual(expect.objectContaining({ invariant: "targets-resolve" }));
  });

  it("treats an absent actor or target as absent, not as dangling", () => {
    // The bell's own mark-read rows carry neither, so a null reference is a
    // shape, not a broken link.
    expect(
      danglingFindings([
        dangling({ source_user_id: null, target_type: null, target_id: null }),
      ]),
    ).toEqual([]);
  });
});

describe("the check as a command", () => {
  const script = fileURLToPath(new URL("../../.freebuff/notifications-check.mjs", import.meta.url));

  /**
   * The environment with `DATABASE_URL` blanked, so the CLI sees no endpoint at all.
   *
   * Blanked rather than deleted on purpose: `src/test/setup.ts` installs a placeholder
   * `postgresql://test:test@localhost:5432/test`, and an empty value is the one shape the
   * script's own guard reads as absent whatever the host `process.env` does with a
   * `delete`. Deleting it would leave the case passing for the wrong reason on a machine
   * where the placeholder survived — it fails to connect rather than refusing to start.
   */
  function withoutDatabaseUrl(): NodeJS.ProcessEnv {
    return { ...process.env, DATABASE_URL: "" };
  }

  it("refuses to report a pass when it cannot reach a database", () => {
    const result = spawnSync(process.execPath, [script, "--json"], {
      encoding: "utf8",
      env: withoutDatabaseUrl(),
    });
    expect(result.status).toBe(2);
    expect(JSON.parse(result.stdout)).toEqual(
      expect.objectContaining({ gate: "cannot-run", exitCode: 2, findings: [] }),
    );
  });

  it("explains itself on --help without touching a database", () => {
    const result = spawnSync(process.execPath, [script, "--help"], {
      encoding: "utf8",
      env: withoutDatabaseUrl(),
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("--json");
    expect(result.stdout).toContain("Exit 0");
  });
});
