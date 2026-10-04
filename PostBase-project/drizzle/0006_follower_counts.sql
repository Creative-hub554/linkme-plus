-- Live follower counts: publish a member's follower and following totals to
-- Realtime whenever the follow graph changes.
--
-- A profile showing "4 followers" should tick to 5 the moment somebody follows
-- them, without the reader refreshing. The profile page cannot get that from
-- `postgres_changes` on `follows`: a follower row carries only the two ids, not
-- the totals, and scoping those rows by policy would deliver each viewer only
-- their own relationships — exactly the case that does not need updating.
--
-- So the totals are computed here, in the transaction that changed them, and
-- published to a public Realtime topic that the profile page subscribes to.
-- Absolute totals are deliberate (as in `0003_feed_activity.sql`): every event
-- states the new value rather than a delta, so a missed or duplicated event
-- cannot make the number drift, and applying one twice is harmless.
--
-- The payload contains ids and two integers, all of which any authenticated
-- member can already read for any profile through `GET /api/users`. No row of
-- `follows` — i.e. who follows whom — is broadcast.
--
-- Applied to the project as the `follower_counts_broadcast` migration. Every
-- statement is idempotent, so re-applying it is a no-op.
--
-- Note: like the indexes in `0003`, this file is the only home for the trigger
-- and the per-column indexes it relies on; `src/lib/db/schema.ts` declares
-- neither, so do not regenerate it with `drizzle-kit`.

create index if not exists follows_following_idx on public.follows (following_id);
create index if not exists follows_follower_idx on public.follows (follower_id);

create or replace function public.follower_counts_broadcast()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid;
  target uuid;
  target_followers integer;
  actor_following integer;
begin
  -- An unfollow is a DELETE, so the ids come from whichever row the trigger was
  -- handed. By the time an AFTER trigger runs the row is already gone, which is
  -- what makes the counts below reflect the change that just committed.
  if tg_op = 'DELETE' then
    actor := old.follower_id;
    target := old.following_id;
  else
    actor := new.follower_id;
    target := new.following_id;
  end if;

  if actor is null or target is null then
    return null;
  end if;

  select count(*)::int into target_followers
  from public.follows f
  where f.following_id = target;

  select count(*)::int into actor_following
  from public.follows f
  where f.follower_id = actor;

  begin
    perform realtime.send(
      jsonb_build_object(
        'follower_id', actor,
        'following_id', target,
        'followers', target_followers,
        'following', actor_following
      ),
      'follower_counts',
      'profile:counts',
      false
    );
  exception when others then
    -- The follow already committed; failing to announce it must never fail the
    -- follow itself. A missed broadcast costs one stale count until the next
    -- reconnect, which reconciles against the API.
    null;
  end;

  return null;
end;
$$;

drop trigger if exists follows_follower_counts on public.follows;
create trigger follows_follower_counts
  after insert or delete on public.follows
  for each row execute function public.follower_counts_broadcast();
