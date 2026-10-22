CREATE TYPE "public"."creator_boost_status" AS ENUM('pending', 'approved', 'rejected', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."creator_boost_tier" AS ENUM('rising', 'established', 'star', 'icon');--> statement-breakpoint
CREATE TABLE "creator_boost_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"status" "creator_boost_status" DEFAULT 'pending' NOT NULL,
	"tier" "creator_boost_tier",
	"eligibility_snapshot" jsonb NOT NULL,
	"review_note" text,
	"reviewed_by" uuid,
	"reviewed_at" timestamp,
	"approved_at" timestamp,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "creator_boost_memberships_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "ad_campaigns" ADD COLUMN "charge_amount" integer;--> statement-breakpoint
ALTER TABLE "ad_campaigns" ADD COLUMN "creator_discount_percent" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ad_campaigns" ADD COLUMN "creator_discount_amount" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "creator_boost_memberships" ADD CONSTRAINT "creator_boost_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_boost_memberships" ADD CONSTRAINT "creator_boost_memberships_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "creator_boost_memberships_status_created_idx" ON "creator_boost_memberships" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "creator_boost_memberships_active_expiry_idx" ON "creator_boost_memberships" USING btree ("status","expires_at");
--> statement-breakpoint
-- Creator Boost applications are server-only. The Data API browser roles were
-- already revoked globally in 0018; RLS makes the intended boundary explicit
-- for this benefit and protects it if a future grant is introduced.
ALTER TABLE "creator_boost_memberships" ENABLE ROW LEVEL SECURITY;
