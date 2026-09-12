CREATE TYPE "public"."entitlement_source" AS ENUM('NONE', 'PAYMENT', 'ADMIN');--> statement-breakpoint
ALTER TABLE "ai_prompt_versions" ADD COLUMN "guidance" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "entitlement_source" "entitlement_source" DEFAULT 'NONE' NOT NULL;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "entitlement_granted_by" uuid;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "entitlement_note" varchar(500);--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_entitlement_granted_by_users_id_fk" FOREIGN KEY ("entitlement_granted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;