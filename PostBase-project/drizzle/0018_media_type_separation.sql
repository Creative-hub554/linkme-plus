-- Separate short videos between social (posts) and marketplace (listings).
-- `post_media.type` becomes the shared media_type enum (image | video | short_video);
-- `listing_media` gains the same column so a marketplace short is attached to a
-- listing, a social short stays attached to a post, and neither can leak into
-- the other's feed.
--
-- The DO block needs the doubled dollar quote ($$ ... $$). A single $ is a
-- syntax error, and drizzle-kit records the migration's hash even when a
-- statement fails, so the file would look applied while none of its work landed.
DO $$ BEGIN CREATE TYPE "public"."media_type" AS ENUM('image', 'video', 'short_video'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
-- Existing post media are images or videos; anything unknown maps to image, the
-- historical default rendering.
ALTER TABLE "post_media" ALTER COLUMN "type" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "post_media" ALTER COLUMN "type" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "post_media" ALTER COLUMN "type" TYPE "public"."media_type" USING (
  CASE "post_media"."type" WHEN 'video' THEN 'video'::media_type ELSE 'image'::media_type END
);--> statement-breakpoint
ALTER TABLE "post_media" ALTER COLUMN "type" SET DEFAULT 'image';--> statement-breakpoint
ALTER TABLE "post_media" ALTER COLUMN "type" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "listing_media" ADD COLUMN "type" "public"."media_type" DEFAULT 'image' NOT NULL;