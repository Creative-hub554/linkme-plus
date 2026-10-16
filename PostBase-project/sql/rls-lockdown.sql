-- LinkMe+ — row level security lockdown for the Supabase project.
--
-- Why this file exists: every table in `public` was reachable through the Data
-- API with the anon key that ships in the browser bundle — readable *and*
-- writable. Anyone who opened devtools on the site could read every direct
-- message or delete a row. This turns that around: row level security on every
-- table, the API roles' blanket grants revoked, and the only two reads the
-- client actually makes handed back.
--
-- The two reads are not arbitrary. `posts` is what the feed's realtime
-- subscription listens to — Supabase Realtime authorizes every `postgres_changes`
-- event by running the table's SELECT policy as the subscriber, so without this
-- grant and policy the live feed would go silent. `notifications` is what the
-- notification bell listens to, and it already carried its own policy.
--
-- Everything else — the feed REST query, messages, follows, moderation — is
-- served by the app itself, which connects through drizzle as the `postgres`
-- role that owns the tables. Table owners bypass row level security, so this
-- file does not change a single behaviour of the application's own queries.
--
-- The `posts` policy below is a rendering of `visiblePostsCondition` in
-- src/lib/db/post-visibility.ts: the author always; `public` to every signed-in
-- reader; `followers` to a reader following the post's subject (the member who
-- published it, or the Page it was published as); `group` to a member of the
-- group it was published into. `private` has no arm on purpose — an author-only
-- post is admitted by authorship alone. If that rule ever changes, it has to
-- change here too, or the two will disagree: the API will filter a post out of
-- the feed while realtime still pushes it, or the reverse.
--
-- Safe to re-run: every statement is idempotent.

begin;

-- 1. Row level security on every table that does not have it yet.
do $$
declare
  relation_name text;
begin
  for relation_name in
    select tablename from pg_tables
    where schemaname = 'public' and rowsecurity = false
  loop
    execute format('alter table public.%I enable row level security', relation_name);
  end loop;
end $$;

-- 2. The index the policy's group arm looks up. Every other arm is covered by
--    an existing index — follows by (follower_id, following_id), page_follows by
--    (page_id, user_id) — and this policy runs once per row per realtime event,
--    so an unindexed membership check would be a seq scan on every one.
create index if not exists group_members_group_user_idx
  on public.group_members (group_id, user_id);

-- 3. The feed's audience, as the database sees it.
drop policy if exists "posts are readable per their audience" on public.posts;

create policy "posts are readable per their audience" on public.posts
  for select to authenticated
  using (
    posts.author_id = (select auth.uid())
    or posts.visibility = 'public'
    or (
      posts.visibility = 'followers'
      and (
        -- A post published as a Page is gated on following the Page. The
        -- `page_id is null` guard is what keeps following the Page's *admin*
        -- from admitting its followers-only posts.
        (
          posts.page_id is null
          and exists (
            select 1 from public.follows f
            where f.follower_id = (select auth.uid())
              and f.following_id = posts.author_id
          )
        )
        or exists (
          select 1 from public.page_follows pf
          where pf.user_id = (select auth.uid())
            and pf.page_id = posts.page_id
        )
      )
    )
    or (
      posts.visibility = 'group'
      and exists (
        select 1 from public.group_members gm
        where gm.group_id = posts.group_id
          and gm.user_id = (select auth.uid())
      )
    )
  );

-- 4. Take the blanket grants away from the two Data API roles, on what exists
--    and on whatever the app creates next.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;

-- 5. Hand back exactly the two reads, and nothing else. `anon` gets nothing:
--    the feed is behind a login, so there is no signed-out reader to serve.
grant select on public.posts to authenticated;
grant select on public.notifications to authenticated;

-- 6. The policy above reads three edge tables to decide an audience, and a
--    policy runs as the reader: without a privilege here the `followers` and
--    `group` arms fail outright with `permission denied for table follows`
--    instead of admitting nobody. Each edge is therefore readable — but only
--    the rows the reader is actually part of. The follow graph for other
--    members, and other people's group memberships, stay unreadable, and the
--    app still serves its own member lists and follower counts through drizzle
--    as `postgres`.
grant select on public.follows to authenticated;
grant select on public.page_follows to authenticated;
grant select on public.group_members to authenticated;

drop policy if exists "the people you follow are readable" on public.follows;
create policy "the people you follow are readable" on public.follows
  for select to authenticated
  using ( follows.follower_id = (select auth.uid()) );

drop policy if exists "your page follows are readable" on public.page_follows;
create policy "your page follows are readable" on public.page_follows
  for select to authenticated
  using ( page_follows.user_id = (select auth.uid()) );

drop policy if exists "your group memberships are readable" on public.group_members;
create policy "your group memberships are readable" on public.group_members
  for select to authenticated
  using ( group_members.user_id = (select auth.uid()) );

-- 7. The broadcast and notification functions are SECURITY DEFINER and live in
--    `public`, which makes them callable RPCs for anyone holding the anon key —
--    a way to inject events into other members' feeds without touching a row.
--    Triggers check EXECUTE when they are created, not when they fire, and the
--    app writes as the owning `postgres` role, so this closes the door on the
--    API without stopping a single notification or broadcast.
revoke execute on function public.feed_activity_broadcast() from public, anon, authenticated;
revoke execute on function public.notify_engagement() from public, anon, authenticated;
revoke execute on function public.follower_counts_broadcast() from public, anon, authenticated;
revoke execute on function public.follows_feed_audience_broadcast() from public, anon, authenticated;
revoke execute on function public.group_members_feed_audience_broadcast() from public, anon, authenticated;

commit;
