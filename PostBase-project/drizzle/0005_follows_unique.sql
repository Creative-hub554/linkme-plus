-- One follows row per (follower, following).
--
-- The follow API reads the relationship and then writes it, which is not atomic:
-- two requests that interleave — two tabs, a retried request, or two server
-- isolates on Cloudflare — can both see "not following" and both insert. Without
-- a unique index the second insert succeeds, and then unfollow deletes only one
-- of the rows: the button reads "Follow" while the next load reads "Following",
-- and the follower count is inflated by the extra rows.
--
-- Applied to the project as the `follows_unique` migration. Every statement is
-- idempotent, so re-applying it is a no-op.
--
-- Existing duplicates are collapsed onto the earliest row rather than deleted by
-- pair, so a follow that predates this index is never re-dated.
delete from public.follows
where id in (
  select id
  from (
    select
      id,
      row_number() over (
        partition by follower_id, following_id
        order by created_at, id
      ) as row_number
    from public.follows
  ) ranked
  where ranked.row_number > 1
);

create unique index if not exists follows_follower_following_key
  on public.follows (follower_id, following_id);

-- The follower/following counts and the unfollow path both filter on a single
-- column of that pair, so they get their own prefix indexes.
create index if not exists follows_following_idx on public.follows (following_id);
create index if not exists follows_follower_idx on public.follows (follower_id);
