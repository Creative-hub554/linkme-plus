import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { db, withDbRetry } from "./index";

/**
 * `withDbRetry` wraps almost every route's database work, and the one decision
 * it makes is which failures to retry. Retrying a SQL or constraint error would
 * just fire the same doomed query again, so only network-level codes qualify —
 * and those can arrive wrapped, in a `cause` or an aggregate `errors` array,
 * which is the shape `postgres-js` uses when a socket dies mid-flight.
 *
 * Importing the module here is itself part of the contract: it throws at load
 * when `DATABASE_URL` is absent, and `src/test/setup.ts` supplies one, so this
 * import proves the module wires up from the environment it is given.
 */
describe("withDbRetry", () => {
  it("resolves without retrying when the operation succeeds", async () => {
    const operation = vi.fn(async () => "ok");
    await expect(withDbRetry(operation)).resolves.toBe("ok");
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("retries a transient code and returns the later success", async () => {
    // `attempts: 2` keeps the test's one backoff to 500ms rather than the
    // default six-attempt ladder.
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(Object.assign(new Error("socket closed"), { code: "ECONNREFUSED" }))
      .mockResolvedValueOnce("recovered");

    await expect(withDbRetry(operation, 2)).resolves.toBe("recovered");
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("does not retry a SQL or constraint error", async () => {
    const operation = vi.fn(async () => {
      throw Object.assign(new Error("duplicate key"), { code: "23505" });
    });

    await expect(withDbRetry(operation)).rejects.toThrow("duplicate key");
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("follows a transient code nested in `cause` or in an `errors` array", async () => {
    const wrapped = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(
        Object.assign(new Error("query failed"), {
          cause: Object.assign(new Error("read ETIMEDOUT"), { code: "ETIMEDOUT" }),
        }),
      )
      .mockResolvedValueOnce("ok");
    await expect(withDbRetry(wrapped, 2)).resolves.toBe("ok");
    expect(wrapped).toHaveBeenCalledTimes(2);

    const aggregate = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce({
        errors: [Object.assign(new Error("write EPIPE"), { code: "EPIPE" })],
      })
      .mockResolvedValueOnce("ok");
    await expect(withDbRetry(aggregate, 2)).resolves.toBe("ok");
    expect(aggregate).toHaveBeenCalledTimes(2);
  });

  it("gives up once the retry budget is spent", async () => {
    const operation = vi.fn(async () => {
      throw Object.assign(new Error("still down"), { code: "ECONNRESET" });
    });

    await expect(withDbRetry(operation, 1)).rejects.toThrow("still down");
    // `attempts: 1` means a single try and no second chance.
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("leaves a non-object rejection alone", async () => {
    const operation = vi.fn(async () => {
      throw "a bare string";
    });
    await expect(withDbRetry(operation)).rejects.toBe("a bare string");
  });
});

/**
 * The `db` proxy binds every function it hands out, so a drizzle method pulled off it
 * without a receiver still reaches its own instance. `$client` is the exception, and the
 * one that mattered: it is drizzle's escape hatch to the driver, postgres.js's client is
 * itself a function whose own properties (`end`, `unsafe`) *are* how it is used, and
 * `bind` does not carry those properties across. Bound, `db.$client.end(...)` threw
 * `undefined is not a function` — a script failing after all of its work had landed, which
 * is how `npm run db:seed` came to exit 1 on a seed that had succeeded. So the contract is
 * two-sided and both halves are asserted here: the driver's client arrives intact, and a
 * method still arrives bound.
 */
describe("the db proxy", () => {
  it("hands out the driver's client with its own methods intact", () => {
    expect(typeof db.$client).toBe("function");
    // The properties `bind` would have stripped — `end` is the one a script closes its
    // pool with, and the one this test exists for.
    expect(typeof db.$client.end).toBe("function");
    expect(typeof db.$client.unsafe).toBe("function");
  });

  it("still binds a drizzle method to the instance behind the proxy", () => {
    // Pulled off with no receiver: bound, so the builder is built on the real instance and
    // a lost `this` would throw here instead of returning one.
    const { select } = db;
    const builder = select({ one: sql`1` });
    expect(typeof builder.from).toBe("function");
  });
});
