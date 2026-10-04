import { describe, expect, it } from "vitest";

import { DECLARED_TABLES, holdDeclaredTable } from "./declared-strikes";
import type { DeclaredTable } from "./declared-strikes";

/**
 * The one ratchet every mutation table answers to.
 *
 * Each sweep in the chain — the convention detectors, the runner, the shared lock, the test
 * helpers, the coverage gates, the preflight sweep, and the declared-table ratchet itself — pairs
 * its table with a hand-written declaration in `./declared-strikes`, and this file turns that
 * pairing into a case. There is one
 * case per registered table, generated from the registry, so a family added to the chain needs a
 * declaration and no new case: the shape a table is held by is stated once, next to the tables
 * themselves, rather than re-derived for every sweep.
 *
 * The registry case is the other half: a table with an empty declaration or no message would make
 * the generated case pass vacuously — a `toEqual` of two empty lists is still a pass — so the
 * declarations are held to be non-empty and the sweeps to be named apart before any table is
 * compared to its table.
 *
 * The control case is the third: a `holdDeclaredTable` that has stopped holding would make every
 * generated case below pass *vacuously* — the loop would still run and assert nothing — so the
 * ratchet is handed a table it must reject at each layer it holds and asked to throw. Without it
 * the ratchet can be neutered to a bare `return` with the whole file still green, which is the
 * hole the guard sweep's `holdDeclaredTable` strike exists to close.
 */
describe("the declared mutation tables", () => {
  it("registers every table with a distinct name, a declaration and a message", () => {
    expect(DECLARED_TABLES.length, "no table is registered, so nothing is held").toBeGreaterThan(0);

    const sweeps = DECLARED_TABLES.map((table) => table.sweep);
    expect(new Set(sweeps).size, "two tables share a name").toBe(sweeps.length);

    for (const table of DECLARED_TABLES) {
      expect(table.declared.length, `${table.sweep} declares no strike`).toBeGreaterThan(0);
      expect(table.message.trim(), `${table.sweep} states no message`).not.toBe("");
      expect(typeof table.read, `${table.sweep} has no reader`).toBe("function");
    }
  });

  it("rejects a table that disagrees with its declaration, so a quieted ratchet is a failing case", () => {
    // A table that is only ever compared to a matching declaration cannot tell a working ratchet
    // from a `return` on its first line: both leave every case above green. So the ratchet is given
    // a disagreement the way each layer of it holds — the names it compares and the anchor it reads
    // out of the file — and required to throw. One break, one case: a ratchet quieted end to end
    // fails all three, one whose name comparison was removed fails the first two, and one that
    // stopped reading anchors fails the third.
    const base: DeclaredTable = {
      sweep: "a control table",
      declared: [{ name: "a" }],
      read: () => [{ name: "a" }],
      message: "a control table, held against no real sweep",
    };

    // A strike the sweep gained that the declaration does not name.
    expect(() =>
      holdDeclaredTable({ ...base, read: () => [{ name: "a" }, { name: "b" }] }),
    ).toThrow();

    // A declaration naming a strike the table no longer carries.
    expect(() =>
      holdDeclaredTable({ ...base, declared: [{ name: "a" }, { name: "b" }] }),
    ).toThrow();

    // An anchor the file it splices into no longer holds.
    expect(() =>
      holdDeclaredTable({
        ...base,
        declared: [
          {
            name: "a",
            anchor: "an anchor this repository never writes",
            source: "src/test/declared-strikes.ts",
          },
        ],
      }),
    ).toThrow();
  });

  for (const table of DECLARED_TABLES) {
    it(`holds ${table.sweep} both ways against its declaration`, () => {
      holdDeclaredTable(table);
    });
  }
});
