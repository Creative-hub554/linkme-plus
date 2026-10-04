import { expect } from "vitest";
import { getTableName } from "drizzle-orm";
import { fakeDb } from "./fake-db";

/**
 * One-call assertions for the predicate the fake `@/lib/db` recorded.
 *
 * Reading a gated operation by hand means indexing the parallel arrays
 * (`selectWheres[1]`, `selectParams[1]`) and keeping that index in step with the
 * route's read order — an index that is invisible in the test and silently
 * wrong when a read is inserted ahead of it. These helpers take the table
 * instead: they find the operation on that table and assert its `where` and
 * parameters, so the test says *which predicate* it pins rather than *which
 * position* it happens to sit in.
 */
type TableLike = Parameters<typeof getTableName>[0];
type Sql = string | RegExp;

export interface Gate {
  /**
   * Which occurrence of the table, when a route touches it more than once (the
   * list and its total are two reads of `reports`). Zero-based, default `0`.
   */
  nth?: number;
  /**
   * Asserts the operation is the *first* recorded one of its kind — the route's
   * opening read, or its first write before any other. Where a test read
   * `reads[0]` (or `writes[0]`) to say "before anything else", this says it
   * without the index.
   */
  first?: boolean;
  /**
   * The predicate's SQL, or several matchers that must all hold (an audience
   * gate is `"visibility" = 'public'` *and* an `exists`, and naming both in one
   * array keeps it a single assertion). A string asserts a substring
   * (`toContain`); `""` asserts that the operation was unfiltered, exactly; a
   * RegExp asserts a match (`toMatch`). Omit to assert nothing about the
   * predicate.
   */
  where?: Sql | Sql[];
  /** The bound parameters, compared with `toEqual`. Omit to skip the check. */
  params?: unknown[];
  /**
   * The write's `set`/`values` payload, compared with `toEqual`, so a test can
   * pin what a write stored (`values: expect.objectContaining({ status: "draft" })`)
   * without indexing `writes`. Meaningful only for updates and inserts.
   */
  values?: unknown;
}

/** The gate for an insert, which has a payload but no predicate. */
export interface InsertGate {
  /** Which insert of the table, zero-based, when it is inserted more than once. */
  nth?: number;
  /** Asserts this is the first write the route made. */
  first?: boolean;
  /** The `values` payload, compared with `toEqual`. */
  values?: unknown;
}

function locate(tables: string[], name: string, nth: number): number {
  let seen = 0;
  for (let index = 0; index < tables.length; index += 1) {
    if (tables[index] !== name) continue;
    if (seen === nth) return index;
    seen += 1;
  }
  throw new Error(
    `expected operation #${nth + 1} on "${name}", but the route made ${seen} ` +
      `(${tables.join(", ") || "none"})`,
  );
}

function assertWhere(actual: string, expected: Sql | Sql[], table: string) {
  if (Array.isArray(expected)) {
    for (const matcher of expected) assertWhere(actual, matcher, table);
    return;
  }
  if (typeof expected !== "string") {
    expect(actual, `the \`where\` of ${table}`).toMatch(expected);
    return;
  }
  // An empty expected string means "no filter"; `toContain("")` would pass for
  // every predicate, so it is the one case compared exactly.
  if (expected === "") {
    expect(actual, `the \`where\` of ${table}`).toBe("");
    return;
  }
  expect(actual, `the \`where\` of ${table}`).toContain(expected);
}

function assertFirst(index: number, name: string, kind: string) {
  expect(index, `expected ${name} to be the first ${kind}`).toBe(0);
}

/** Pins the `where`/parameters of the `nth` read of `table`. */
export function expectGatedRead(table: TableLike, gate: Gate = {}) {
  const name = getTableName(table);
  const index = locate(fakeDb.reads, name, gate.nth ?? 0);
  if (gate.first) assertFirst(index, name, "read");
  if (gate.where !== undefined) assertWhere(fakeDb.selectWheres[index], gate.where, name);
  if (gate.params !== undefined) {
    expect(fakeDb.selectParams[index], `the parameters of ${name}`).toEqual(gate.params);
  }
}

/**
 * Pins the `where`/parameters/payload of the `nth` update of `table`. `nth`
 * counts the table's entries in `writes`, which also holds inserts — safe here
 * because no route both inserts and updates one table in a single request.
 */
export function expectGatedUpdate(table: TableLike, gate: Gate = {}) {
  const name = getTableName(table);
  const tables = fakeDb.writes.map((write) => write.table);
  const index = locate(tables, name, gate.nth ?? 0);
  if (gate.first) assertFirst(index, name, "write");
  if (gate.where !== undefined) assertWhere(fakeDb.updateWheres[index], gate.where, name);
  if (gate.params !== undefined) {
    expect(fakeDb.updateParams[index], `the parameters of ${name}`).toEqual(gate.params);
  }
  if (gate.values !== undefined) {
    expect(fakeDb.writes[index].values, `the values written to ${name}`).toEqual(gate.values);
  }
}

/** Pins the payload of the `nth` insert of `table`. */
export function expectGatedInsert(table: TableLike, gate: InsertGate = {}) {
  const name = getTableName(table);
  const tables = fakeDb.writes.map((write) => write.table);
  const index = locate(tables, name, gate.nth ?? 0);
  if (gate.first) assertFirst(index, name, "write");
  if (gate.values !== undefined) {
    expect(fakeDb.writes[index].values, `the values written to ${name}`).toEqual(gate.values);
  }
}

/**
 * An entry in a `writes` sequence: a table name, or the `{ table, values }` a
 * whole-array assertion used.
 */
export type WriteExpectation = string | Record<string, unknown>;

/**
 * Asserts that no operation of the given kind was recorded — the route wrote
 * nothing (or read nothing, or deleted nothing).
 *
 * This is the claim `expectGatedSequence(kind, [])` already makes, spelled as
 * a positive assertion instead of an empty expected list: reading
 * `expectGatedNone("writes")` says *nothing was written*, where
 * `expectGatedSequence("writes", [])` reads like a sequence that happens to be
 * empty. Both compare the record to `[]`; the sequence form stays for callers
 * that build the expected list dynamically.
 */
export function expectGatedNone(kind: "reads" | "writes" | "deletes") {
  if (kind === "reads") {
    expect(fakeDb.reads, "no reads").toEqual([]);
    return;
  }
  if (kind === "deletes") {
    expect(fakeDb.deletes, "no deletes").toEqual([]);
    return;
  }
  expect(fakeDb.writes, "no writes").toEqual([]);
}

/**
 * Asserts the exact ordered list a record holds — every element, in order, and
 * nothing else. This is the claim a whole-array `expect(fakeDb.writes).toEqual(
 * [...])` makes, and the one a per-table helper cannot: it is the test saying
 * "these operations, in this order, and no others".
 *
 * For `writes`, a list of table names is compared against the tables
 * (`writes.map((write) => write.table)`), and a list of `{ table, values }`
 * objects is compared against `writes` itself, exactly as the raw assertion was
 * — so a payload matcher (`expect.any(Date)`) still works. For `reads` and
 * `deletes` the expected list is the recorded table names. An empty expected
 * list is a "nothing happened" claim; `expectGatedNone` spells that directly.
 */
export function expectGatedSequence(kind: "reads" | "deletes", expected: string[]): void;
export function expectGatedSequence(kind: "writes", expected: WriteExpectation[]): void;
export function expectGatedSequence(
  kind: "reads" | "deletes" | "writes",
  expected: WriteExpectation[],
) {
  const label = `the ${kind}, in order`;
  if (kind === "reads") {
    expect(fakeDb.reads, label).toEqual(expected);
    return;
  }
  if (kind === "deletes") {
    expect(fakeDb.deletes, label).toEqual(expected);
    return;
  }
  // Table names only? Compare the tables, so the caller does not have to build
  // `{ table }` wrappers just to say which operations happened and in what order.
  if (expected.every((entry) => typeof entry === "string")) {
    expect(fakeDb.writes.map((write) => write.table), label).toEqual(expected);
    return;
  }
  expect(fakeDb.writes, label).toEqual(expected);
}

/** Pins the `where`/parameters of the `nth` delete of `table`. */
export function expectGatedDelete(table: TableLike, gate: Gate = {}) {
  const name = getTableName(table);
  const index = locate(fakeDb.deletes, name, gate.nth ?? 0);
  if (gate.first) assertFirst(index, name, "delete");
  if (gate.where !== undefined) assertWhere(fakeDb.deleteWheres[index], gate.where, name);
  if (gate.params !== undefined) {
    expect(fakeDb.deleteParams[index], `the parameters of ${name}`).toEqual(gate.params);
  }
}
