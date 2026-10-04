import { getTableName } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

/**
 * A scripted stand-in for `@/lib/db`, so a route handler can be driven in a
 * test the way a request drives it in production — without a database.
 *
 * The routes under test do very little with drizzle whose *result* matters: they
 * read a role, read a row, write a row, delete rows. What they decide from those
 * results — which stored object a write has orphaned — is the wiring these tests
 * exist to pin. So this seam does not try to answer SQL; it is handed the rows a
 * real database would return, keyed by table and consumed in the order the route
 * asks, and it records what the route tried to write and delete.
 *
 * Keying by table rather than by a single global queue is the whole ergonomics:
 * a route reads `page_roles` then `pages` then `post_media`, and a test can say
 * what each of those reads returns without counting positions. A table read
 * twice is answered in order, which is the one case a queue is needed.
 *
 * The tables are identified with drizzle's own `getTableName`, so a test scripts
 * answers against the real exported schema objects and there is no second,
 * hand-written table list to drift.
 */
type Row = Record<string, unknown>;
type TableLike = Parameters<typeof getTableName>[0];
type Kind = "select" | "update" | "insert" | "delete";
type Condition = Parameters<PgDialect["sqlToQuery"]>[0];

/**
 * Renders a `where` the way the dialect would embed it, without a database.
 * The condition is not *evaluated* — the fake still returns what a test
 * scripted — but its SQL and its bound parameters are kept so a test can pin
 * that a read is gated on a predicate (an audience rule, a block) rather than
 * merely that the table was touched, and can read the *values* the predicate was
 * given where the SQL renders them as placeholders. An absent or unrenderable
 * condition is recorded as `""` with no parameters.
 */
function renderCondition(condition: unknown): { sql: string; params: unknown[] } {
  if (condition === undefined || condition === null) return { sql: "", params: [] };
  try {
    const query = new PgDialect().sqlToQuery(condition as Condition);
    return { sql: query.sql, params: query.params };
  } catch {
    return { sql: "", params: [] };
  }
}

function enqueue(queue: Map<string, Row[][]>, key: string, rows: Row[]) {
  const list = queue.get(key) ?? [];
  list.push(rows);
  queue.set(key, list);
}

function enqueueError(queue: Map<string, unknown[]>, key: string, error: unknown) {
  const list = queue.get(key) ?? [];
  list.push(error);
  queue.set(key, list);
}

/** One `select`/`update`/`insert`/`delete` chain, resolved when it is awaited. */
class FakeQuery implements PromiseLike<Row[]> {
  private table: string | null = null;
  private payload: Row | null = null;
  private condition: unknown = undefined;

  constructor(
    private readonly db: FakeDb,
    private readonly kind: Kind,
  ) {}

  from(table: TableLike) {
    this.table = getTableName(table);
    return this;
  }

  // Present so the chains the routes build resolve here rather than throwing on
  // a method that does not exist. The conditions themselves are not interpreted:
  // a test scripts the answer, it does not evaluate the query.
  leftJoin(_table: TableLike, _on: unknown) {
    return this;
  }

  innerJoin(_table: TableLike, _on: unknown) {
    return this;
  }

  where(condition: unknown) {
    this.condition = condition;
    return this;
  }

  orderBy(..._columns: unknown[]) {
    return this;
  }

  limit(_count: number) {
    return this;
  }

  offset(_count: number) {
    return this;
  }

  groupBy(..._columns: unknown[]) {
    return this;
  }

  returning(_fields?: unknown) {
    return this;
  }

  // Present so a route that writes with `onConflict...` (the idempotent follow
  // and profile-provisioning inserts) resolves here rather than throwing on a
  // method that does not exist. The conflict handling itself is not simulated:
  // a test scripts the rows an insert hands back.
  onConflictDoNothing(_config?: unknown) {
    return this;
  }

  set(values: Row) {
    this.payload = values;
    return this;
  }

  values(values: Row) {
    this.payload = values;
    return this;
  }

  private async run(): Promise<Row[]> {
    if (this.kind === "select") return this.db.takeSelect(this.table, this.condition);
    if (this.kind === "update") return this.db.takeUpdate(this.table, this.payload ?? {}, this.condition);
    if (this.kind === "insert") return this.db.takeInsert(this.table, this.payload ?? {});
    return this.db.takeDelete(this.table, this.condition);
  }

  then<TResult1 = Row[], TResult2 = never>(
    onfulfilled?: ((value: Row[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.run().then(onfulfilled, onrejected);
  }
}

export class FakeDb {
  private readonly selects = new Map<string, Row[][]>();
  private readonly updates = new Map<string, Row[][]>();
  private readonly inserts = new Map<string, Row[][]>();
  /** A queued error makes the next `select` of a table reject instead of resolve. */
  private readonly selectErrors = new Map<string, unknown[]>();
  /** A queued error makes the next `update` of a table reject instead of resolve. */
  private readonly updateErrors = new Map<string, unknown[]>();
  /** The same, for `insert` — the write a route may swallow as best-effort. */
  private readonly insertErrors = new Map<string, unknown[]>();
  /** The same, for `delete` — a write with a failure path of its own. */
  private readonly deleteErrors = new Map<string, unknown[]>();

  /** Every read, by table name, in the order the route made them. */
  readonly reads: string[] = [];
  /**
   * The rendered `where` of each read, aligned with {@link reads} (`""` when a
   * read was unfiltered). This is how a test pins that a list is gated on a
   * predicate the fake cannot evaluate.
   */
  readonly selectWheres: string[] = [];
  /**
   * The bound parameters of each read, aligned with {@link reads} (`[]` when a
   * read was unfiltered). Where `selectWheres` shows the shape of the predicate
   * (`"status" = $1`), this shows what filled the placeholder, so a test can pin
   * that a filter narrowed to a particular value and not merely that it filtered.
   */
  readonly selectParams: unknown[][] = [];
  /** Every `set`/`values` payload, in order — what a write would have stored. */
  readonly writes: { table: string; values: Row }[] = [];
  /**
   * The rendered `where` of each write, aligned with {@link writes}. An insert
   * has no `where`, so its slots are `""`; an update's predicate — the ownership
   * rule a soft delete carries ("my comment or nobody's") — is what a test reads
   * here. The fake still does not *evaluate* it: an `update` matching nothing is
   * scripted with `updateReturns(table, [])`.
   */
  readonly updateWheres: string[] = [];
  /**
   * The bound parameters of each write, aligned with {@link writes} (`[]` for an
   * insert, or an unfiltered update). This is how a test pins that an update's
   * ownership narrowed to the session's id and not merely that it filtered.
   */
  readonly updateParams: unknown[][] = [];
  /** Every delete, by table name, in order — how "posts before the Page" is read. */
  readonly deletes: string[] = [];
  /**
   * The rendered `where` of each delete, aligned with {@link deletes} (`""` when
   * unfiltered). A delete's predicate is what keeps one account from clearing
   * another's rows, and the fake would otherwise record only the table.
   */
  readonly deleteWheres: string[] = [];
  /** The bound parameters of each delete, aligned with {@link deletes}. */
  readonly deleteParams: unknown[][] = [];

  select(_fields?: unknown) {
    return new FakeQuery(this, "select");
  }

  update(table: TableLike) {
    return new FakeQuery(this, "update").from(table);
  }

  delete(table: TableLike) {
    return new FakeQuery(this, "delete").from(table);
  }

  insert(table: TableLike) {
    return new FakeQuery(this, "insert").from(table);
  }

  /** The rows the next `select` of this table is answered with. */
  selectReturns(table: TableLike, rows: Row[]) {
    enqueue(this.selects, getTableName(table), rows);
    return this;
  }

  /** The rows the next `update` of this table hands back (its `returning()`, usually). */
  updateReturns(table: TableLike, rows: Row[]) {
    enqueue(this.updates, getTableName(table), rows);
    return this;
  }

  /** The rows the next `insert` of this table hands back. */
  insertReturns(table: TableLike, rows: Row[]) {
    enqueue(this.inserts, getTableName(table), rows);
    return this;
  }

  /**
   * Makes the next `select` of this table reject — the seam for a route's
   * read-failure branch (the `503` a preferences read answers, or the fallback a
   * profile read falls back to). A rejected read is **not** recorded in `reads`:
   * the route asked, but got no answer, which is the same line the write seams
   * draw.
   */
  failNextSelect(table: TableLike, error: unknown = new Error("database unavailable")) {
    enqueueError(this.selectErrors, getTableName(table), error);
    return this;
  }

  /**
   * Makes the next `update` of this table reject — the seam for a route that has
   * a failure path around a write (a timeout, a deferral). A rejected write is
   * not recorded: it did not happen.
   */
  failNextUpdate(table: TableLike, error: unknown = new Error("database unavailable")) {
    enqueueError(this.updateErrors, getTableName(table), error);
    return this;
  }

  /**
   * Makes the next `insert` of this table reject. The seam for a write a route
   * treats as best-effort — the history row it must not let take down a request
   * whose real work already succeeded.
   */
  failNextInsert(table: TableLike, error: unknown = new Error("database unavailable")) {
    enqueueError(this.insertErrors, getTableName(table), error);
    return this;
  }

  /**
   * Makes the next `delete` of this table reject — the seam for a route that
   * has a failure path around a delete (the `500` an un-save answers when the
   * write is refused). A rejected delete is not recorded: it did not happen.
   */
  failNextDelete(table: TableLike, error: unknown = new Error("database unavailable")) {
    enqueueError(this.deleteErrors, getTableName(table), error);
    return this;
  }

  reset() {
    this.selects.clear();
    this.updates.clear();
    this.inserts.clear();
    this.selectErrors.clear();
    this.updateErrors.clear();
    this.insertErrors.clear();
    this.deleteErrors.clear();
    this.reads.length = 0;
    this.writes.length = 0;
    this.deletes.length = 0;
    this.selectWheres.length = 0;
    this.selectParams.length = 0;
    this.updateWheres.length = 0;
    this.updateParams.length = 0;
    this.deleteWheres.length = 0;
    this.deleteParams.length = 0;
  }

  private take(queue: Map<string, Row[][]>, table: string | null): Row[] {
    if (!table) return [];
    return queue.get(table)?.shift() ?? [];
  }

  takeSelect(table: string | null, condition?: unknown) {
    const error = table ? this.selectErrors.get(table)?.shift() : undefined;
    if (error) throw error;
    if (table) {
      const rendered = renderCondition(condition);
      this.reads.push(table);
      this.selectWheres.push(rendered.sql);
      this.selectParams.push(rendered.params);
    }
    return this.take(this.selects, table);
  }

  takeUpdate(table: string | null, values: Row, condition?: unknown) {
    const error = table ? this.updateErrors.get(table)?.shift() : undefined;
    if (error) throw error;
    if (table) {
      const rendered = renderCondition(condition);
      this.writes.push({ table, values });
      this.updateWheres.push(rendered.sql);
      this.updateParams.push(rendered.params);
    }
    return this.take(this.updates, table);
  }

  takeInsert(table: string | null, values: Row) {
    const error = table ? this.insertErrors.get(table)?.shift() : undefined;
    if (error) throw error;
    if (table) {
      this.writes.push({ table, values });
      // An insert carries no `where`; the slot is kept so `updateWheres` stays
      // index-aligned with `writes`.
      this.updateWheres.push("");
      this.updateParams.push([]);
    }
    return this.take(this.inserts, table);
  }

  takeDelete(table: string | null, condition?: unknown) {
    const error = table ? this.deleteErrors.get(table)?.shift() : undefined;
    if (error) throw error;
    if (table) {
      const rendered = renderCondition(condition);
      this.deletes.push(table);
      this.deleteWheres.push(rendered.sql);
      this.deleteParams.push(rendered.params);
    }
    return [];
  }
}

/**
 * The one the mock factory hands the routes. A singleton because `vi.mock`'s
 * factory cannot hold a fresh instance where a test can reach it; each test file
 * runs in its own module registry, so the sharing never crosses files.
 */
export const fakeDb = new FakeDb();

export function resetFakeDb() {
  fakeDb.reset();
}
