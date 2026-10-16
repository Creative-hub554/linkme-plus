-- Photos attached to a comment: one row per image, several per comment, in
-- the order they were picked. The shape mirrors post_media minus the
-- processing status — nothing processes a comment's photo; it is stored and
-- served as uploaded.
--
-- `url` is a public R2 URL, so it is a rewrite target of the media archive
-- (ARCHIVE_REWRITE_TARGETS): when the hourly pass moves the object to Drive
-- this row is rewritten to the Drive URL along with everything else, and a
-- row missed by the rewrite would keep pointing at a deleted object.
--
-- The cascade joins a hard comment delete to its photos. The comment itself
-- is soft-deleted by the app (the thread's replies still resolve their
-- parent), so this fires only when the row really goes — a post's delete
-- cascading into its comments.
--
-- The index on comment_id is the foreign-key index Postgres does not create
-- on its own: every thread load reads its comments' photos through this
-- column, and a cascade without it scans.
--
-- Applied to the project as the `0015_comment_media` migration. Every
-- statement is idempotent, so re-applying it is a no-op.

create table if not exists "comment_media" (
  "id" uuid primary key default gen_random_uuid(),
  "comment_id" uuid not null references "comments" ("id") on delete cascade,
  "url" text not null,
  "alt_text" varchar(255),
  "type" varchar(20) not null,
  "order" integer default 0
);

create index if not exists "comment_media_comment_id_idx" on "comment_media" ("comment_id");
