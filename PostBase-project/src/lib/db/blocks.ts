import { and, eq, or, sql, type SQL, type SQLWrapper } from "drizzle-orm";
import { blocks } from "@/lib/db/schema";

/**
 * Whether a block stands between two members — one rule, read the same in both
 * directions.
 *
 * A block is a prohibition on interaction, and it does not matter which side
 * drew it: if either member has blocked the other, the pair is closed. Written
 * once, here, because a route that checked only its own direction would let a
 * blocked member keep reaching the person who blocked them — the exact
 * behaviour a block exists to prevent — while a list that checked only one
 * direction would show the pair to each other anyway.
 *
 * Spelled as a condition on the `blocks` table so it composes two ways: a write
 * asks it directly (`select ... from blocks where blockedEitherWay(caller,
 * target)` — a row back means refuse), and a read negates it through
 * {@link notBlockedEitherWay} to drop a member from a list.
 *
 * `a` and `b` may each be a bound id or a column of the surrounding query,
 * which is what lets the same rule guard a single write and filter a whole
 * page.
 */
export function blockedEitherWay(
  a: string | SQLWrapper,
  b: string | SQLWrapper,
): SQL {
  return or(
    and(eq(blocks.blockerId, a), eq(blocks.blockedId, b)),
    and(eq(blocks.blockerId, b), eq(blocks.blockedId, a)),
  ) as SQL;
}

/**
 * {@link blockedEitherWay}, negated for a list query: `true` when no block
 * stands between the viewer and `candidate`.
 *
 * `candidate` is a column of the surrounding query — `users.id` — which is what
 * makes this a per-row filter rather than a single check. It is expressed as a
 * correlated `not exists` over `blocks` from the predicate itself, so the
 * direction rule is written once; the subquery's `blocks` mentions and the
 * outer `candidate` are both qualified, so the correlation points outward.
 */
export function notBlockedEitherWay(viewerId: string, candidate: SQLWrapper): SQL {
  return sql`not exists (
    select 1 from ${blocks}
    where ${blockedEitherWay(viewerId, candidate)}
  )`;
}
