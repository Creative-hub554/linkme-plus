CREATE TABLE "saved_listings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"listing_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "short_video_covers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"template_id" varchar(30) NOT NULL,
	"speed" varchar(10) NOT NULL,
	"duration" integer NOT NULL,
	"aspect_ratio" varchar(10) NOT NULL,
	"subtitle" text,
	"product_label" varchar(60),
	"product_url" text,
	"profile_photo_url" text NOT NULL,
	"background_video_url" text,
	"background_photo_url" text,
	"status" varchar(20) DEFAULT 'ready' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "cover_config" jsonb;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "short_video_cover_url" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "short_video_cover_config" jsonb;--> statement-breakpoint
ALTER TABLE "saved_listings" ADD CONSTRAINT "saved_listings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_listings" ADD CONSTRAINT "saved_listings_listing_id_marketplace_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."marketplace_listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "short_video_covers" ADD CONSTRAINT "short_video_covers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;