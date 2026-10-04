-- Feed audience: tell the feed when a follow edge changes, so a card the reader
-- may no longer see leaves the screen at once.
--
-- A `followers` post is visible to the reader *because* of an edge in `follows`.
-- When that edge is removed the post is out of reach, but the feed only re-reads
-- a post when the post itself changes; removing a follow writes to a different
-- table, so without a signal the card stays until the next load. Unfollowing is
-- a DELETE, and Realtime's `postgres_changes` carries only the primary key of a
-- deleted row by default, so the feed cannot tell whose relationship changed
-- from that stream. This trigger states it, on the feed's own topic and event.
--
-- The two ids are the same ones `profile:counts` already publishes (see `0006`
-- for why that is acceptable): they are readable for any profile through
-- `GET /api/users`. No post row and no audience is included. The topic is the
-- feed's, so its one Realtime channel carries both events — a channel's name is
-- the topic, and two pages must not share one (see the note in the profile
-- page).
--
-- Applied to the project as the `follows_feed_audience` migration. Every
-- statement is idempotent, so re-applying it is a no-op.
--
-- Note: `src/lib/db/schema.ts` declares neither the function nor the trigger, so
-- this file is their only home — do not regenerate it with `drizzle-kit`.

create or replace function public.follows_feed_audience_broadcast()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid;
  target uuid;
begin
  -- An unfollow is a DELETE, so the ids come from whichever row the trigger was
  -- handed. By the time an AFTER trigger runs the row is already gone.
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

  begin
    perform realtime.send(
      jsonb_build_object(
        'follower_id', actor,
        'following_id', target,
        'added', tg_op = 'INSERT'
      ),
      'follows',
      'feed:activity',
      false
    );
  exception when others then
    -- The follow already committed; failing to announce it must never fail the
    -- follow itself. A missed announcement costs one stale card until the next
    -- reconnect, which reconciles against the API.
    null;
  end;

  return null;
end;
$$;

drop trigger if exists follows_feed_audience on public.follows;
create trigger follows_feed_audience
  after insert or delete on public.follows
  for each row execute function public.follows_feed_audience_broadcast();
