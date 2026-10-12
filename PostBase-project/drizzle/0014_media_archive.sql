-- The media archive's mapping table: one row per R2 object the hourly pass
-- moved to Google Drive.
--
-- The row is not telemetry, it is load-bearing in two directions. A pass that
-- dies between recording an object and deleting it comes back to the row and
-- finishes the rewrite and delete without re-uploading (which is why r2_key
-- is the primary key: an object is archived exactly once). And deleting a
-- post, Page, or avatar that now points at Drive consults new_url before
-- removing anything, so this table is also the allow-list that keeps a
-- Drive delete inside this app's own files — a URL a client handed us could
-- belong to a stranger's Drive, and only recorded ones are ever deleted.
--
-- Rows are written once and kept: old_url and new_url are the provenance of
-- every Drive-hosted URL the app serves, which is why the rewrite pass
-- exempts them from its own URL rewriting.
--
-- size_bytes is a plain integer rather than the bigint string form used
-- elsewhere: the upload caps put every object under 100 MB, far inside
-- integer range, and the pass's size verification compares against it as
-- plain arithmetic.

create table if not exists "archived_objects" (
  "r2_key" text primary key,
  "drive_file_id" text not null,
  "old_url" text not null,
  "new_url" text not null,
  "content_type" varchar(100),
  "size_bytes" integer not null,
  "md5_hex" varchar(32),
  "archived_at" timestamp not null default now()
);
