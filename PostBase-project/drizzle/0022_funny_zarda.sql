CREATE TYPE "public"."creator_collaboration_status" AS ENUM('pending', 'accepted', 'declined', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."creator_support_ticket_status" AS ENUM('open', 'in_progress', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."scheduled_creator_post_status" AS ENUM('scheduled', 'publishing', 'published', 'cancelled', 'failed');--> statement-breakpoint
CREATE TABLE "creator_collaborations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"creator_id" uuid NOT NULL,
	"collaborator_id" uuid NOT NULL,
	"status" "creator_collaboration_status" DEFAULT 'pending' NOT NULL,
	"responded_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "creator_communities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "creator_communities_group_id_unique" UNIQUE("group_id")
);
--> statement-breakpoint
CREATE TABLE "creator_support_tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"subject" varchar(160) NOT NULL,
	"message" text NOT NULL,
	"status" "creator_support_ticket_status" DEFAULT 'open' NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scheduled_creator_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"content" text NOT NULL,
	"visibility" "visibility" DEFAULT 'public' NOT NULL,
	"scheduled_for" timestamp NOT NULL,
	"status" "scheduled_creator_post_status" DEFAULT 'scheduled' NOT NULL,
	"published_post_id" uuid,
	"failure_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ad_campaigns" ADD COLUMN "priority_review" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "creator_spotlight_post_id" uuid;--> statement-breakpoint
ALTER TABLE "creator_collaborations" ADD CONSTRAINT "creator_collaborations_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_collaborations" ADD CONSTRAINT "creator_collaborations_creator_id_users_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_collaborations" ADD CONSTRAINT "creator_collaborations_collaborator_id_users_id_fk" FOREIGN KEY ("collaborator_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_communities" ADD CONSTRAINT "creator_communities_creator_id_users_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_communities" ADD CONSTRAINT "creator_communities_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_support_tickets" ADD CONSTRAINT "creator_support_tickets_creator_id_users_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_support_tickets" ADD CONSTRAINT "creator_support_tickets_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_creator_posts" ADD CONSTRAINT "scheduled_creator_posts_creator_id_users_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_creator_posts" ADD CONSTRAINT "scheduled_creator_posts_published_post_id_posts_id_fk" FOREIGN KEY ("published_post_id") REFERENCES "public"."posts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "creator_collaborations_one_invite_idx" ON "creator_collaborations" USING btree ("post_id","collaborator_id");--> statement-breakpoint
CREATE INDEX "creator_collaborations_collaborator_status_idx" ON "creator_collaborations" USING btree ("collaborator_id","status","created_at");--> statement-breakpoint
CREATE INDEX "creator_communities_creator_created_idx" ON "creator_communities" USING btree ("creator_id","created_at");--> statement-breakpoint
CREATE INDEX "creator_support_tickets_status_created_idx" ON "creator_support_tickets" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "creator_support_tickets_creator_created_idx" ON "creator_support_tickets" USING btree ("creator_id","created_at");--> statement-breakpoint
CREATE INDEX "scheduled_creator_posts_creator_status_time_idx" ON "scheduled_creator_posts" USING btree ("creator_id","status","scheduled_for");--> statement-breakpoint
CREATE INDEX "scheduled_creator_posts_due_idx" ON "scheduled_creator_posts" USING btree ("scheduled_for") WHERE "scheduled_creator_posts"."status" = 'scheduled';
--> statement-breakpoint
-- Creator Hub data travels only through LinkMe+'s server API. The global
-- server-only grants remain in force; RLS is kept as an explicit second gate.
ALTER TABLE "creator_collaborations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "creator_communities" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "creator_support_tickets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "scheduled_creator_posts" ENABLE ROW LEVEL SECURITY;
