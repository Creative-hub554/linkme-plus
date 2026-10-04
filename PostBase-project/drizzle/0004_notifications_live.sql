-- Notifications: created by engagement, delivered live, readable only by their
-- owner.
--
-- Applied to the project as the `notifications_live` migration. Every statement
-- is idempotent, so re-applying it is a no-op.
--
-- Delivery uses `postgres_changes` on this table rather than a Realtime
-- broadcast topic. The broadcast alternative (a private topic per user) needs a
-- policy on `realtime.messages`, which is owned by `supabase_realtime_admin` and
-- therefore cannot be modified by the migration role. Row-level security gives
-- the same guarantee here: Realtime evaluates the subscriber's own read policy,
-- so a client is only ever handed its own rows.
--
-- `message` is stored rather than composed in the client so the API and the
-- pushed row can never disagree about the wording.
alter table public.notifications add column if not exists message text;

create index if not exists notifications_user_created_idx
  on public.notifications (user_id, created_at desc);

create or replace function public.notification_message(kind text, actor text)
returns text
language sql
immutable
as $$
  select case kind
    when 'comment' then coalesce(actor, 'Someone') || ' commented on your post'
    when 'reaction' then coalesce(actor, 'Someone') || ' reacted to your post'
    when 'follow' then coalesce(actor, 'Someone') || ' started following you'
    else coalesce(actor, 'Someone') || ' interacted with you'
  end;
$$;

create or replace function public.notify_engagement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid;
  recipient uuid;
  kind text;
  scope text;
  target uuid;
  actor_name text;
begin
  if tg_table_name = 'comments' then
    if new.deleted_at is not null then return null; end if;
    actor := new.author_id;
    scope := 'post';
    target := new.post_id;
    kind := 'comment';
    select p.author_id into recipient from public.posts p where p.id = target;
  elsif tg_table_name = 'reactions' then
    -- Reactions are generic; only post reactions are engagement to notify.
    if new.target_type <> 'post' then return null; end if;
    actor := new.user_id;
    scope := 'post';
    target := new.target_id;
    kind := 'reaction';
    select p.author_id into recipient from public.posts p where p.id = target;
  else
    actor := new.follower_id;
    recipient := new.following_id;
    scope := 'user';
    target := new.following_id;
    kind := 'follow';
  end if;

  -- Nobody is notified about their own activity, and a missing recipient (a
  -- post whose author is gone) is not an error.
  if actor is null or recipient is null or actor = recipient then
    return null;
  end if;

  -- A reaction is one row per person per post, but the API toggles by deleting
  -- and re-inserting, so re-reacting must not notify twice.
  if kind = 'reaction' and exists (
    select 1 from public.notifications n
    where n.user_id = recipient and n.source_user_id = actor
      and n.type = kind and n.target_id = target
  ) then
    return null;
  end if;

  select coalesce(pr.display_name, u.username) into actor_name
  from public.users u
  left join public.profiles pr on pr.user_id = u.id
  where u.id = actor;

  begin
    insert into public.notifications (user_id, type, source_user_id, target_type, target_id, message)
    values (recipient, kind, actor, scope, target, public.notification_message(kind, actor_name));
  exception when others then
    -- The engagement itself already committed; failing to record a notification
    -- must never fail the comment, reaction or follow it describes.
    return null;
  end;

  return null;
end;
$$;

drop trigger if exists comments_notify on public.comments;
create trigger comments_notify
  after insert on public.comments
  for each row execute function public.notify_engagement();

drop trigger if exists reactions_notify on public.reactions;
create trigger reactions_notify
  after insert on public.reactions
  for each row execute function public.notify_engagement();

drop trigger if exists follows_notify on public.follows;
create trigger follows_notify
  after insert on public.follows
  for each row execute function public.notify_engagement();

-- A per-user inbox that any holder of the anon key can read is not an inbox.
-- This is also what scopes Realtime delivery. The app reads and writes through
-- Drizzle as the table owner, which bypasses RLS, so no application code
-- depends on this policy.
alter table public.notifications enable row level security;

drop policy if exists "own notifications are readable" on public.notifications;
create policy "own notifications are readable" on public.notifications
  for select to authenticated
  using (user_id = (select auth.uid()));

do $$
begin
  if not exists (
    select 1
    from pg_publication_rel pr
    join pg_publication p on p.oid = pr.prpubid
    where p.pubname = 'supabase_realtime'
      and pr.prrelid = 'public.notifications'::regclass
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;
