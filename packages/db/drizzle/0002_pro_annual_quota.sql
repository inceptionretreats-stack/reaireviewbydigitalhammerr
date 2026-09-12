ALTER TABLE "subscriptions" ADD COLUMN "pro_generation_limit" integer DEFAULT 2000 NOT NULL;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "pro_generations_used" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE "subscriptions" AS "subscription"
SET "pro_generations_used" = LEAST(
	"subscription"."pro_generation_limit",
	(
		SELECT COUNT(*)::integer
		FROM "ai_generations" AS "generation"
		WHERE "generation"."business_id" = "subscription"."business_id"
			AND "generation"."created_at" >= "subscription"."starts_at"
			AND "generation"."created_at" < "subscription"."expires_at"
	)
)
WHERE "subscription"."status" IN ('PRO_ACTIVE', 'PAST_DUE')
	AND "subscription"."starts_at" IS NOT NULL
	AND "subscription"."expires_at" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "ck_pro_limit_positive" CHECK (pro_generation_limit > 0);--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "ck_pro_used_non_negative" CHECK (pro_generations_used >= 0);--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "ck_pro_used_within_limit" CHECK (pro_generations_used <= pro_generation_limit);--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "ck_subscription_period_pair" CHECK ((starts_at IS NULL AND expires_at IS NULL) OR (starts_at IS NOT NULL AND expires_at IS NOT NULL));--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "ck_subscription_period_order" CHECK (starts_at IS NULL OR expires_at IS NULL OR starts_at < expires_at);--> statement-breakpoint
-- Older hand-created Pro rows were allowed to omit dates. Keep the migration deployable, but make
-- every new or subsequently updated paid row supply the annual period; the application also fails
-- closed for an unbounded legacy row. Validate after an operator has repaired any legacy records.
ALTER TABLE "subscriptions" ADD CONSTRAINT "ck_paid_status_has_period" CHECK (status NOT IN ('PRO_ACTIVE', 'PAST_DUE') OR (starts_at IS NOT NULL AND expires_at IS NOT NULL)) NOT VALID;
