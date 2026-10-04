-- The account's display preferences — the accent today.
--
-- `profiles.appearance` is JSONB rather than a column per preference, so a
-- second preference is a code change and not a migration; that is the same
-- reason `contact_preferences` is one. It is deliberately *not* where the
-- light/dark choice goes: that belongs to the light you are reading in, so it
-- stays in the browser, while the accent is identity and should follow the
-- person to another machine.
--
-- Every statement is `IF NOT EXISTS`, and the reason is worth recording. This
-- migration was generated against a schema whose snapshot had drifted from the
-- database: `profiles.work`, `profiles.education`, `profiles.website` and
-- `notifications.message` are all read and written by the running application,
-- so they already exist in the deployed database, but the snapshot did not
-- know about them, so `drizzle-kit generate` proposed adding them alongside
-- `appearance`. Applied as written on that database, the first statement would
-- fail with `column "message" of relation "notifications" already exists` and
-- — because drizzle runs a migration inside one transaction — `appearance`
-- would not be created either. `IF NOT EXISTS` makes each statement a no-op
-- wherever the column is already present, so this file is correct against both
-- the current database and a fresh one. It also brings the snapshot back in
-- line with the schema, so the same drift does not reappear on the next
-- `drizzle-kit generate`.
--
-- Applied to the project as the `profile_appearance` migration.
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "message" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "work" varchar(120);--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "education" varchar(120);--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "website" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "appearance" jsonb;
