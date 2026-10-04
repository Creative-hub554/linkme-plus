-- Live feed activity: publish comment and reaction totals to Realtime.
--
-- The feed does not subscribe to the `comments` and `reactions` tables. Doing so
-- would broadcast every row of both tables to every connected client, including
-- `reactions.user_id` (who reacted to what) and comments on posts the viewer
-- cannot see. Instead a trigger publishes a minimal payload — the post id, the
-- absolute counts, and the id of a comment that was added or removed — to a
-- public Realtime topic, and the client patches the card from that.
--
-- Absolute counts are deliberate: they are idempotent, so they cannot
-- double-count against the optimistic +1 the UI already applies locally.
--
-- Applied to the project as the `feed_activity_broadcast` migration. Every
-- statement is idempotent, so re-applying it is a no-op.
--
-- Note: the two indexes below are not declared in `src/lib/db/schema.ts` (no
-- table there declares indexes), so this file is their only home.

-- Supports the per-post counts the feed computes for every post on a page.
create index if not exists comments_post_id_idx on public.comments (post_id);
create index if not exists reactions_target_idx on public.reactions (target_type, target_id);

create or replace function public.feed_activity_broadcast()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_post uuid;
  comment_total integer;
  reaction_total integer;
  added_comment uuid;
  removed_comment uuid;
begin
  if tg_table_name = 'comments' then
    target_post := coalesce(new.post_id, old.post_id);
  else
    -- Reactions are generic; only post reactions are feed activity.
    if coalesce(new.target_type, old.target_type) <> 'post' then
      return null;
    end if;
    target_post := coalesce(new.target_id, old.target_id);
  end if;

  if target_post is null then
    return null;
  end if;

  select count(*)::int into comment_total
  from public.comments c
  where c.post_id = target_post and c.deleted_at is null;

  select count(*)::int into reaction_total
  from public.reactions r
  where r.target_type = 'post' and r.target_id = target_post;

  if tg_table_name = 'comments' then
    if tg_op = 'INSERT' and new.deleted_at is null then
      added_comment := new.id;
    elsif tg_op = 'UPDATE' and new.deleted_at is not null and old.deleted_at is null then
      removed_comment := new.id;
    elsif tg_op = 'DELETE' then
      removed_comment := old.id;
    end if;
  end if;

  begin
    perform realtime.send(
      jsonb_build_object(
        'post_id', target_post,
        'comment_count', comment_total,
        'reaction_count', reaction_total,
        'comment_added_id', added_comment,
        'comment_removed_id', removed_comment
      ),
      'counts',
      'feed:activity',
      false
    );
  exception when others then
    -- The event describes a write that already happened; publishing it must
    -- never turn a successful comment or reaction into a failed one.
    null;
  end;

  return null;
end;
$$;

drop trigger if exists comments_feed_activity on public.comments;
create trigger comments_feed_activity
  after insert or update or delete on public.comments
  for each row execute function public.feed_activity_broadcast();

drop trigger if exists reactions_feed_activity on public.reactions;
create trigger reactions_feed_activity
  after insert or update or delete on public.reactions
  for each row execute function public.feed_activity_broadcast();
