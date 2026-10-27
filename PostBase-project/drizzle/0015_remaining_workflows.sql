CREATE TABLE "account_restrictions" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"kind" varchar(20) NOT NULL,
	"until" timestamp,
	"reason" text NOT NULL,
	"actor_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account_restrictions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ad_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"viewer_id" uuid NOT NULL,
	"day" varchar(10) NOT NULL,
	"event" varchar(20) NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ad_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ad_payment_settings" (
	"id" varchar(20) PRIMARY KEY NOT NULL,
	"merchant_name" varchar(100) NOT NULL,
	"qr_image_url" text NOT NULL,
	"currency" varchar(3) NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ad_payment_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ad_payments" (
	"campaign_id" uuid PRIMARY KEY NOT NULL,
	"status" varchar(20) DEFAULT 'awaiting' NOT NULL,
	"merchant_name" varchar(100) NOT NULL,
	"qr_image_url" text NOT NULL,
	"reference" varchar(100),
	"payer_name" varchar(100),
	"note" text,
	"verified_by" uuid,
	"verified_at" timestamp,
	CONSTRAINT "ad_payments_reference_unique" UNIQUE("reference")
);
--> statement-breakpoint
ALTER TABLE "ad_payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ad_campaigns" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ad_creatives" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ad_metrics" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ad_placements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "boosted_post_campaigns" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "companies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inventory_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inventory_movements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "job_applications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "jobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "marketplace_listings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "promoted_listing_campaigns" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ad_campaigns" ADD COLUMN "currency" varchar(3) DEFAULT 'KHR' NOT NULL;--> statement-breakpoint
ALTER TABLE "ad_campaigns" ADD COLUMN "reviewed_at" timestamp;--> statement-breakpoint
ALTER TABLE "ad_placements" ADD COLUMN "daily_rate" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ad_placements" ADD COLUMN "currency" varchar(3) DEFAULT 'KHR' NOT NULL;--> statement-breakpoint
ALTER TABLE "account_restrictions" ADD CONSTRAINT "account_restrictions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_restrictions" ADD CONSTRAINT "account_restrictions_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_events" ADD CONSTRAINT "ad_events_campaign_id_ad_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."ad_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_events" ADD CONSTRAINT "ad_events_viewer_id_users_id_fk" FOREIGN KEY ("viewer_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_payments" ADD CONSTRAINT "ad_payments_campaign_id_ad_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."ad_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_payments" ADD CONSTRAINT "ad_payments_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ad_events_viewer_day_unique" ON "ad_events" USING btree ("campaign_id","viewer_id","day","event");--> statement-breakpoint
CREATE UNIQUE INDEX "ad_metrics_campaign_date_unique" ON "ad_metrics" USING btree ("campaign_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "companies_page_unique" ON "companies" USING btree ("page_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_items_listing_unique" ON "inventory_items" USING btree ("listing_id");--> statement-breakpoint
CREATE UNIQUE INDEX "job_applications_job_user_unique" ON "job_applications" USING btree ("job_id","user_id");
--> statement-breakpoint
-- Restriction status can be read by its subject; no client may write it.
GRANT SELECT ON public.account_restrictions TO authenticated;
CREATE POLICY account_restrictions_self_read ON public.account_restrictions
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
--> statement-breakpoint
-- Existing owner policies still apply. A stale JWT cannot keep reading private notifications after a restriction.
CREATE POLICY notifications_account_access ON public.notifications AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (NOT EXISTS (SELECT 1 FROM public.account_restrictions r WHERE r.user_id = (SELECT auth.uid()) AND (r.kind = 'ban' OR r."until" > now())))
  WITH CHECK (NOT EXISTS (SELECT 1 FROM public.account_restrictions r WHERE r.user_id = (SELECT auth.uid()) AND (r.kind = 'ban' OR r."until" > now())));
