CREATE TABLE "account_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" varchar(20) NOT NULL,
	"tier" varchar(20) NOT NULL,
	"starts_at" timestamp NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "account_subscriptions_period_valid" CHECK ("account_subscriptions"."expires_at" > "account_subscriptions"."starts_at"),
	CONSTRAINT "account_subscriptions_plan_valid" CHECK (("account_subscriptions"."kind" = 'seller' and "account_subscriptions"."tier" in ('pro','plus','ultra')) or ("account_subscriptions"."kind" = 'employer' and "account_subscriptions"."tier" = 'employer'))
);
--> statement-breakpoint
ALTER TABLE "account_subscriptions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "topic_id" varchar(32);--> statement-breakpoint
ALTER TABLE "account_subscriptions" ADD CONSTRAINT "account_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_subscriptions_user_kind_unique" ON "account_subscriptions" USING btree ("user_id","kind");--> statement-breakpoint
CREATE INDEX "posts_topic_created_id_idx" ON "posts" USING btree ("topic_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "posts"."deleted_at" IS NULL;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_topic_id_valid" CHECK ("posts"."topic_id" IS NULL OR "posts"."topic_id" IN ('comedy','news','education','food','lifestyle','technology','business','shopping','entertainment','community'));