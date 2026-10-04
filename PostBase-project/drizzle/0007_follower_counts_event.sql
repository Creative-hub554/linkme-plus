-- Follower counts: say which direction the change went.
--
-- `0006_follower_counts.sql` publishes absolute totals, which is what makes a
-- count safe to apply blind. A list of members, though, needs to know whether a
-- row joined or left: totals alone leave the client to infer the direction by
-- comparing against the last number it saw, and an inference is wrong exactly
-- when it matters (two events between renders, or a count corrected by anything
-- else).
--
-- So the payload gains `added`, and the client can be exact: an insert is a row
-- to fetch and prepend, a delete is a row to drop. The totals are unchanged, so
-- a client that ignores the new key behaves exactly as before.
--
-- `create or replace` on the same function, applied to the project as the
-- `follower_counts_event` migration. Idempotent; the trigger itself is unchanged
-- and is not re-created here.

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
        'following', actor_following,
        'added', tg_op = 'INSERT'
      ),
      'follower_counts',
      'profile:counts',
      false
    );
  exception when others then
    null;
  end;

  return null;
end;
$$;
