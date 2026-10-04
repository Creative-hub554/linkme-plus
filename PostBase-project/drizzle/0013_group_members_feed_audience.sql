-- Feed audience: tell the feed when a group membership changes, so a post that
-- was readable *because of* that membership leaves an open feed at once.
--
-- This is `0008_follows_feed_audience.sql` told for groups. A `group` post is
-- visible to the reader exactly while they are a member of the post's group (see
-- `canReadPost` and `visiblePostsCondition`). When the membership row goes the
-- post is out of reach, but the feed only re-reads a post when the post itself
-- changes; leaving a group writes to a different table, so without a signal the
-- card stays until the next load. Leaving is a DELETE, and Realtime's
-- `postgres_changes` carries only the primary key of a deleted row by default,
-- so the feed cannot tell whose membership changed from that stream. This
-- trigger states it, on the feed's own topic and event.
--
-- The two ids are the ones the reader can already see elsewhere: a `group_id` is
-- readable through `GET /api/groups`, and a `user_id` through `GET /api/users`.
-- No post row and no audience is included. The topic is the feed's, so its one
-- Realtime channel carries this event beside the others — a channel's name is
-- the topic, and two pages must not share one (see the note in the profile
-- page).
--
-- Applied to the project as the `group_members_feed_audience` migration. Every
-- statement is idempotent, so re-applying it is a no-op.
--
-- Note: `src/lib/db/schema.ts` declares neither the function nor the trigger, so
-- this file is their only home — do not regenerate it with `drizzle-kit`.

create or replace function public.group_members_feed_audience_broadcast()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid;
  target uuid;
begin
  -- Leaving a group is a DELETE, so the ids come from whichever row the trigger
  -- was handed. By the time an AFTER trigger runs the row is already gone.
  if tg_op = 'DELETE' then
    actor := old.user_id;
    target := old.group_id;
  else
    actor := new.user_id;
    target := new.group_id;
  end if;

  if actor is null or target is null then
    return null;
  end if;

  begin
    perform realtime.send(
      jsonb_build_object(
        'user_id', actor,
        'group_id', target,
        'added', tg_op = 'INSERT'
      ),
      'group_members',
      'feed:activity',
      false
    );
  exception when others then
    -- The membership already committed; failing to announce it must never fail
    -- the membership change itself. A missed announcement costs one stale card
    -- until the next reconnect, which reconciles against the API.
    null;
  end;

  return null;
end;
$$;

drop trigger if exists group_members_feed_audience on public.group_members;
create trigger group_members_feed_audience
  after insert or delete on public.group_members
  for each row execute function public.group_members_feed_audience_broadcast();
