-- Preserve the existing production verification table and enum; legacy requests do not establish National ID verification.
DO $$ BEGIN CREATE TYPE "public"."verification_request_status" AS ENUM('pending', 'approved', 'rejected'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE TABLE "job_publications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid,
	"publisher_id" uuid NOT NULL,
	"allowance" varchar(10) NOT NULL,
	"approved_at" timestamp DEFAULT now() NOT NULL,
	"period_start" timestamp,
	CONSTRAINT "job_publications_allowance_valid" CHECK ("job_publications"."allowance" in ('free','paid'))
);
--> statement-breakpoint
ALTER TABLE "job_publications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "private_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"purpose" varchar(20) NOT NULL,
	"object_key" text NOT NULL,
	"content_type" varchar(40) NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"delete_after" timestamp,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "private_evidence_purpose_valid" CHECK ("private_evidence"."purpose" in ('national_id','office'))
);
--> statement-breakpoint
ALTER TABLE "private_evidence" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "verification_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"evidence_urls" text[] DEFAULT '{}' NOT NULL,
	"status" "verification_request_status" DEFAULT 'pending' NOT NULL,
	"review_note" text,
	"reviewed_by" uuid,
	"reviewed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"verification_kind" varchar(30),
	"private_evidence_ids" uuid[] DEFAULT '{}' NOT NULL,
	"revoked_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "verification_requests" ADD COLUMN IF NOT EXISTS "verification_kind" varchar(30);
ALTER TABLE "verification_requests" ADD COLUMN IF NOT EXISTS "private_evidence_ids" uuid[] DEFAULT '{}' NOT NULL;
ALTER TABLE "verification_requests" ADD COLUMN IF NOT EXISTS "revoked_at" timestamp;
ALTER TABLE "verification_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "publisher_id" uuid;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "review_status" varchar(30) DEFAULT 'pending_review' NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "review_note" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "reviewed_by" uuid;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "reviewed_at" timestamp;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "office_evidence_ids" uuid[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "pending_revision" jsonb;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "first_published_at" timestamp;--> statement-breakpoint
ALTER TABLE "job_publications" ADD CONSTRAINT "job_publications_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_publications" ADD CONSTRAINT "job_publications_publisher_id_users_id_fk" FOREIGN KEY ("publisher_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private_evidence" ADD CONSTRAINT "private_evidence_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'verification_requests_user_id_users_id_fk' AND conrelid = 'public.verification_requests'::regclass) THEN ALTER TABLE "verification_requests" ADD CONSTRAINT "verification_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action; END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'verification_requests_reviewed_by_users_id_fk' AND conrelid = 'public.verification_requests'::regclass) THEN ALTER TABLE "verification_requests" ADD CONSTRAINT "verification_requests_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; END IF; END $$;--> statement-breakpoint
CREATE UNIQUE INDEX "job_publications_job_unique" ON "job_publications" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "job_publications_publisher_idx" ON "job_publications" USING btree ("publisher_id","approved_at");--> statement-breakpoint
CREATE UNIQUE INDEX "private_evidence_object_key_unique" ON "private_evidence" USING btree ("object_key");--> statement-breakpoint
CREATE INDEX "private_evidence_owner_idx" ON "private_evidence" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "verification_requests_user_kind_idx" ON "verification_requests" USING btree ("user_id","verification_kind","status");--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_publisher_id_users_id_fk" FOREIGN KEY ("publisher_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;