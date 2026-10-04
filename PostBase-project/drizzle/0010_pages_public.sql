-- Following a Page, which `follows` cannot express.
--
-- `follows.following_id` is a foreign key to `users.id`, so there is no value a
-- Page could put there. The dormant `/api/pages` route counted "followers" with
-- `follows.following_id = page.id`, which is always zero — a Page is not a
-- member, and this is the table that says so.
--
-- Every statement is `IF NOT EXISTS`, for the reason 0009 records: migrations
-- here are applied by `.freebuff/apply-migration.mjs` directly rather than
-- through `drizzle-kit migrate` (the tracking table is empty while the schema is
-- already pushed), so each statement must be harmless to re-run. The foreign
-- keys are written inline in the `CREATE TABLE` rather than as separate
-- `ALTER TABLE ... ADD CONSTRAINT` statements precisely so they inherit that:
-- Postgres has no `ADD CONSTRAINT IF NOT EXISTS`, but a skipped `CREATE TABLE`
-- takes its inline constraints with it.
--
-- Applied to the project as the `pages_public` migration.
CREATE TABLE IF NOT EXISTS "page_follows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "page_follows_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "page_follows_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
-- One follow per person per Page. The route inserts with `onConflictDoNothing`
-- and reports a COUNT, so a duplicate row would both inflate the number and
-- survive an unfollow — the same failure `0005_follows_unique.sql` closed for
-- members.
CREATE UNIQUE INDEX IF NOT EXISTS "page_follows_page_user_unique" ON "page_follows" USING btree ("page_id","user_id");
--> statement-breakpoint
-- "which Pages does this person follow", the direction the unique index (which
-- leads with `page_id`) cannot serve.
CREATE INDEX IF NOT EXISTS "page_follows_user_index" ON "page_follows" USING btree ("user_id");
