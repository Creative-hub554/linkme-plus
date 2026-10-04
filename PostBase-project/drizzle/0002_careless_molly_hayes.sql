ALTER TABLE "short_video_covers" ADD COLUMN "profile_offset_x" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "short_video_covers" ADD COLUMN "profile_offset_y" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "short_video_covers" ADD COLUMN "profile_radius" integer DEFAULT 180 NOT NULL;