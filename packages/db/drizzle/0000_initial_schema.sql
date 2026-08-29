CREATE EXTENSION IF NOT EXISTS "pgcrypto";
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS "citext";
--> statement-breakpoint
CREATE TYPE "public"."ai_prompt_status" AS ENUM('DRAFT', 'ACTIVE', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."business_status" AS ENUM('DRAFT', 'ACTIVE', 'SUSPENDED', 'CLOSED');--> statement-breakpoint
CREATE TYPE "public"."customer_request_status" AS ENUM('NOT_CONTACTED', 'MESSAGE_PREPARED', 'MESSAGE_SENT_MANUAL', 'LINK_CLICKED', 'AI_GENERATED', 'REVIEW_COPIED', 'GOOGLE_OPENED', 'PRIVATE_FEEDBACK');--> statement-breakpoint
CREATE TYPE "public"."domain_status" AS ENUM('PENDING_DNS', 'PENDING_SSL', 'ACTIVE', 'ERROR', 'REMOVED');--> statement-breakpoint
CREATE TYPE "public"."feedback_status" AS ENUM('NEW', 'READ', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."link_type" AS ENUM('GOOGLE_REVIEW', 'WHATSAPP', 'CALL', 'INSTAGRAM', 'FACEBOOK', 'WEBSITE', 'DIRECTIONS', 'CUSTOM');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('CREATED', 'AUTHORIZED', 'CAPTURED', 'REFUNDED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."qr_status" AS ENUM('ACTIVE', 'DISABLED');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('FREE', 'CHECKOUT_PENDING', 'PRO_ACTIVE', 'PAST_DUE', 'EXPIRED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('BUSINESS_OWNER', 'BUSINESS_SUPPORT_VIEWER', 'SUPER_ADMIN');--> statement-breakpoint
CREATE TABLE "password_reset_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" char(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"ip_hash" char(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "password_reset_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" char(64) NOT NULL,
	"user_agent" varchar(400),
	"ip_hash" char(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_reason" varchar(80),
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "user_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" "citext" NOT NULL,
	"mobile" varchar(20),
	"invited_by_user_id" uuid NOT NULL,
	"business_id" uuid,
	"token_hash" char(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_invites_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" "citext" NOT NULL,
	"mobile" varchar(20),
	"full_name" varchar(120) NOT NULL,
	"password_hash" text NOT NULL,
	"role" "user_role" DEFAULT 'BUSINESS_OWNER' NOT NULL,
	"mfa_secret" text,
	"mfa_enabled_at" timestamp with time zone,
	"email_verified_at" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"failed_login_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid,
	"storage_key" text NOT NULL,
	"mime_type" varchar(100) NOT NULL,
	"bytes" bigint NOT NULL,
	"width" integer,
	"height" integer,
	"checksum_sha256" char(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "assets_storage_key_unique" UNIQUE("storage_key")
);
--> statement-breakpoint
CREATE TABLE "business_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"link_type" "link_type" NOT NULL,
	"label" varchar(80) NOT NULL,
	"url" text,
	"phone" varchar(20),
	"is_enabled" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_google_review_has_no_url" CHECK (link_type <> 'GOOGLE_REVIEW' OR url IS NULL),
	CONSTRAINT "ck_enabled_link_has_target" CHECK (NOT is_enabled OR link_type = 'GOOGLE_REVIEW' OR url IS NOT NULL OR phone IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "business_slugs" (
	"slug" "citext" PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"redirect_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_alias_has_expiry" CHECK (is_primary OR redirect_until IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "businesses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"name" varchar(160) NOT NULL,
	"category" varchar(100) NOT NULL,
	"description" varchar(500),
	"city" varchar(100),
	"state" varchar(100),
	"country_code" char(2) DEFAULT 'IN' NOT NULL,
	"timezone" varchar(64) DEFAULT 'Asia/Kolkata' NOT NULL,
	"status" "business_status" DEFAULT 'DRAFT' NOT NULL,
	"logo_asset_id" uuid,
	"cover_asset_id" uuid,
	"brand_accent" varchar(7),
	"config_version" bigint DEFAULT 1 NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "review_destinations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"platform" varchar(40) NOT NULL,
	"label" varchar(80) NOT NULL,
	"url" text NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "anonymous_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"public_token_hash" char(64) NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_agent_hash" char(64),
	"ip_prefix_hash" char(64),
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "anonymous_sessions_public_token_hash_unique" UNIQUE("public_token_hash")
);
--> statement-breakpoint
CREATE TABLE "qr_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"code" varchar(32) NOT NULL,
	"source_label" varchar(120) NOT NULL,
	"internal_note" varchar(500),
	"status" "qr_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "qr_codes_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "ai_business_contexts" (
	"business_id" uuid PRIMARY KEY NOT NULL,
	"summary" text,
	"services" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"context_terms" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "ai_generations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"anonymous_session_id" uuid,
	"qr_code_id" uuid,
	"review_mode_id" uuid,
	"parent_generation_id" uuid,
	"prompt_version_id" uuid NOT NULL,
	"model" varchar(80) NOT NULL,
	"generation_number" integer DEFAULT 1 NOT NULL,
	"review_text" text NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"provider_request_id" varchar(160),
	"similarity_score" numeric(5, 4),
	"moderation_flags" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"counted_toward_quota" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_prompt_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" varchar(40) NOT NULL,
	"status" "ai_prompt_status" DEFAULT 'DRAFT' NOT NULL,
	"model" varchar(80) NOT NULL,
	"reasoning_effort" varchar(20) DEFAULT 'none' NOT NULL,
	"system_prompt" text NOT NULL,
	"output_schema" jsonb NOT NULL,
	"max_output_tokens" integer DEFAULT 220 NOT NULL,
	"rollout_percent" integer DEFAULT 100 NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"activated_at" timestamp with time zone,
	CONSTRAINT "ai_prompt_versions_version_unique" UNIQUE("version"),
	CONSTRAINT "ck_rollout_percent" CHECK (rollout_percent BETWEEN 0 AND 100)
);
--> statement-breakpoint
CREATE TABLE "review_modes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"name" varchar(80) NOT NULL,
	"description" varchar(500),
	"context_terms" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" varchar(40) NOT NULL,
	"provider_event_id" varchar(160),
	"event_type" varchar(120) NOT NULL,
	"payload_hash" char(64) NOT NULL,
	"processed_at" timestamp with time zone,
	"processing_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_webhook_events_provider_event_id_unique" UNIQUE("provider_event_id")
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"subscription_id" uuid,
	"provider" varchar(40) DEFAULT 'RAZORPAY' NOT NULL,
	"provider_payment_id" varchar(120),
	"provider_order_id" varchar(120),
	"provider_subscription_id" varchar(120),
	"amount_paise" integer NOT NULL,
	"currency" char(3) DEFAULT 'INR' NOT NULL,
	"status" "payment_status" NOT NULL,
	"raw_reference" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"status" "subscription_status" DEFAULT 'FREE' NOT NULL,
	"plan_code" varchar(40) DEFAULT 'AI_REVIEW_PRO_ANNUAL' NOT NULL,
	"currency" char(3) DEFAULT 'INR' NOT NULL,
	"amount_paise" integer DEFAULT 99900 NOT NULL,
	"free_generation_limit" integer DEFAULT 10 NOT NULL,
	"free_generations_used" integer DEFAULT 0 NOT NULL,
	"fair_use_monthly_soft_limit" integer,
	"starts_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"razorpay_plan_id" varchar(100),
	"razorpay_subscription_id" varchar(100),
	"auto_renew" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_business_id_unique" UNIQUE("business_id"),
	CONSTRAINT "ck_free_used_non_negative" CHECK (free_generations_used >= 0),
	CONSTRAINT "ck_free_used_within_limit" CHECK (free_generations_used <= free_generation_limit)
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"mobile" varchar(20) NOT NULL,
	"email" "citext",
	"visit_date" date,
	"note" varchar(1000),
	"status" "customer_request_status" DEFAULT 'NOT_CONTACTED' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "private_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"anonymous_session_id" uuid,
	"name" varchar(120),
	"mobile" varchar(20),
	"message" varchar(2000) NOT NULL,
	"status" "feedback_status" DEFAULT 'NEW' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_request_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"template_text" varchar(1200) NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"template_id" uuid,
	"tracking_token_hash" char(64) NOT NULL,
	"rendered_message" varchar(1500) NOT NULL,
	"prepared_at" timestamp with time zone DEFAULT now() NOT NULL,
	"marked_sent_at" timestamp with time zone,
	"first_clicked_at" timestamp with time zone,
	"last_clicked_at" timestamp with time zone,
	CONSTRAINT "review_requests_tracking_token_hash_unique" UNIQUE("tracking_token_hash")
);
--> statement-breakpoint
CREATE TABLE "custom_domains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"hostname" "citext" NOT NULL,
	"status" "domain_status" DEFAULT 'PENDING_DNS' NOT NULL,
	"provider" varchar(40) DEFAULT 'CLOUDFLARE' NOT NULL,
	"provider_hostname_id" varchar(160),
	"dns_target" text,
	"verification_records" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ssl_status" varchar(60),
	"activated_at" timestamp with time zone,
	"last_checked_at" timestamp with time zone,
	"error_message" varchar(500),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analytics_daily_business" (
	"business_id" uuid NOT NULL,
	"metric_date" date NOT NULL,
	"metric_name" varchar(80) NOT NULL,
	"dimension_key" varchar(120) DEFAULT '' NOT NULL,
	"metric_value" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "analytics_daily_business_business_id_metric_date_metric_name_dimension_key_pk" PRIMARY KEY("business_id","metric_date","metric_name","dimension_key")
);
--> statement-breakpoint
CREATE TABLE "analytics_events" (
	"id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
	"event_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"anonymous_session_id" uuid,
	"qr_code_id" uuid,
	"customer_id" uuid,
	"event_name" varchar(80) NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"properties" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "analytics_events_id_occurred_at_pk" PRIMARY KEY("id","occurred_at")
) PARTITION BY RANGE ("occurred_at");
--> statement-breakpoint
CREATE TABLE "admin_audit_logs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "admin_audit_logs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"actor_user_id" uuid NOT NULL,
	"business_id" uuid,
	"action" varchar(120) NOT NULL,
	"reason" varchar(1000),
	"target_type" varchar(80),
	"target_id" varchar(120),
	"before_state" jsonb,
	"after_state" jsonb,
	"ip_hash" char(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feature_flags" (
	"key" varchar(120) PRIMARY KEY NOT NULL,
	"description" varchar(500),
	"is_enabled" boolean DEFAULT false NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_settings" (
	"key" varchar(120) PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"version" bigint DEFAULT 1 NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_invites" ADD CONSTRAINT "user_invites_invited_by_user_id_users_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_links" ADD CONSTRAINT "business_links_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_slugs" ADD CONSTRAINT "business_slugs_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_logo_asset_id_assets_id_fk" FOREIGN KEY ("logo_asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_cover_asset_id_assets_id_fk" FOREIGN KEY ("cover_asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_destinations" ADD CONSTRAINT "review_destinations_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anonymous_sessions" ADD CONSTRAINT "anonymous_sessions_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qr_codes" ADD CONSTRAINT "qr_codes_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_business_contexts" ADD CONSTRAINT "ai_business_contexts_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_business_contexts" ADD CONSTRAINT "ai_business_contexts_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_generations" ADD CONSTRAINT "ai_generations_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_generations" ADD CONSTRAINT "ai_generations_anonymous_session_id_anonymous_sessions_id_fk" FOREIGN KEY ("anonymous_session_id") REFERENCES "public"."anonymous_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_generations" ADD CONSTRAINT "ai_generations_qr_code_id_qr_codes_id_fk" FOREIGN KEY ("qr_code_id") REFERENCES "public"."qr_codes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_generations" ADD CONSTRAINT "ai_generations_review_mode_id_review_modes_id_fk" FOREIGN KEY ("review_mode_id") REFERENCES "public"."review_modes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_generations" ADD CONSTRAINT "ai_generations_parent_generation_id_ai_generations_id_fk" FOREIGN KEY ("parent_generation_id") REFERENCES "public"."ai_generations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_generations" ADD CONSTRAINT "ai_generations_prompt_version_id_ai_prompt_versions_id_fk" FOREIGN KEY ("prompt_version_id") REFERENCES "public"."ai_prompt_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_prompt_versions" ADD CONSTRAINT "ai_prompt_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_modes" ADD CONSTRAINT "review_modes_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private_feedback" ADD CONSTRAINT "private_feedback_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private_feedback" ADD CONSTRAINT "private_feedback_anonymous_session_id_anonymous_sessions_id_fk" FOREIGN KEY ("anonymous_session_id") REFERENCES "public"."anonymous_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_request_templates" ADD CONSTRAINT "review_request_templates_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_requests" ADD CONSTRAINT "review_requests_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_requests" ADD CONSTRAINT "review_requests_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_requests" ADD CONSTRAINT "review_requests_template_id_review_request_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."review_request_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_domains" ADD CONSTRAINT "custom_domains_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_daily_business" ADD CONSTRAINT "analytics_daily_business_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_anonymous_session_id_anonymous_sessions_id_fk" FOREIGN KEY ("anonymous_session_id") REFERENCES "public"."anonymous_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_qr_code_id_qr_codes_id_fk" FOREIGN KEY ("qr_code_id") REFERENCES "public"."qr_codes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_audit_logs" ADD CONSTRAINT "admin_audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_audit_logs" ADD CONSTRAINT "admin_audit_logs_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_flags" ADD CONSTRAINT "feature_flags_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_settings" ADD CONSTRAINT "platform_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_reset_tokens_user" ON "password_reset_tokens" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_sessions_user_active" ON "sessions" USING btree ("user_id","expires_at");--> statement-breakpoint
CREATE INDEX "idx_sessions_expiry" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_invites_email" ON "user_invites" USING btree ("email","created_at");--> statement-breakpoint
CREATE INDEX "idx_users_role" ON "users" USING btree ("role");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_business_link" ON "business_links" USING btree ("business_id","link_type","label");--> statement-breakpoint
CREATE INDEX "idx_business_links_public" ON "business_links" USING btree ("business_id","is_enabled","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_one_google_review_link" ON "business_links" USING btree ("business_id") WHERE link_type = 'GOOGLE_REVIEW';--> statement-breakpoint
CREATE UNIQUE INDEX "uq_one_primary_slug_per_business" ON "business_slugs" USING btree ("business_id") WHERE is_primary;--> statement-breakpoint
CREATE INDEX "idx_business_slugs_business" ON "business_slugs" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "idx_businesses_owner" ON "businesses" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "idx_businesses_status" ON "businesses" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_one_primary_review_destination" ON "review_destinations" USING btree ("business_id") WHERE is_primary;--> statement-breakpoint
CREATE INDEX "idx_review_destinations_business" ON "review_destinations" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "idx_anon_business_seen" ON "anonymous_sessions" USING btree ("business_id","first_seen_at");--> statement-breakpoint
CREATE INDEX "idx_qr_business" ON "qr_codes" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "idx_ai_gen_business_created" ON "ai_generations" USING btree ("business_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_ai_gen_session" ON "ai_generations" USING btree ("anonymous_session_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_one_active_prompt_version" ON "ai_prompt_versions" USING btree ("status") WHERE status = 'ACTIVE';--> statement-breakpoint
CREATE UNIQUE INDEX "uq_review_mode_name" ON "review_modes" USING btree ("business_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_one_active_mode" ON "review_modes" USING btree ("business_id") WHERE is_active AND NOT is_archived;--> statement-breakpoint
CREATE INDEX "idx_payments_business" ON "payments" USING btree ("business_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_customers_business_mobile" ON "customers" USING btree ("business_id","mobile") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "idx_feedback_business_status" ON "private_feedback" USING btree ("business_id","status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "uq_default_request_template" ON "review_request_templates" USING btree ("business_id") WHERE is_default;--> statement-breakpoint
CREATE INDEX "idx_review_requests_customer" ON "review_requests" USING btree ("customer_id","prepared_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "uq_live_hostname" ON "custom_domains" USING btree ("hostname") WHERE status <> 'REMOVED';--> statement-breakpoint
CREATE UNIQUE INDEX "uq_one_active_domain_per_business" ON "custom_domains" USING btree ("business_id") WHERE status = 'ACTIVE';--> statement-breakpoint
CREATE INDEX "idx_custom_domains_business" ON "custom_domains" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "idx_daily_business_date" ON "analytics_daily_business" USING btree ("business_id","metric_date" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "uq_analytics_event_id" ON "analytics_events" USING btree ("event_id","occurred_at");--> statement-breakpoint
CREATE INDEX "idx_events_business_time" ON "analytics_events" USING btree ("business_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_events_business_name_time" ON "analytics_events" USING btree ("business_id","event_name","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_audit_actor_time" ON "admin_audit_logs" USING btree ("actor_user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_audit_business_time" ON "admin_audit_logs" USING btree ("business_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_audit_action_time" ON "admin_audit_logs" USING btree ("action","created_at" DESC NULLS LAST);--> statement-breakpoint
-- AMENDMENT-012 (continued): monthly partition management for analytics_events.
--
-- 13_Security_Privacy_Compliance.md sets 13-month retention on raw event data. With
-- partitions, retention is DROP TABLE on one partition rather than a DELETE across ~300M
-- rows. The worker calls ensure_analytics_events_partition() ahead of each month so the
-- default partition stays empty; the default exists only so an unexpected timestamp can
-- never fail an insert and break the customer flow (AC-035).
CREATE OR REPLACE FUNCTION ensure_analytics_events_partition(target_month date)
RETURNS text AS $fn$
DECLARE
  start_date date := date_trunc('month', target_month)::date;
  end_date   date := (date_trunc('month', target_month) + interval '1 month')::date;
  part_name  text := format('analytics_events_%s', to_char(start_date, 'YYYY_MM'));
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = part_name AND n.nspname = 'public'
  ) THEN
    EXECUTE format(
      'CREATE TABLE public.%I PARTITION OF public.analytics_events FOR VALUES FROM (%L) TO (%L)',
      part_name, start_date, end_date
    );
  END IF;
  RETURN part_name;
END;
$fn$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TABLE analytics_events_default PARTITION OF analytics_events DEFAULT;
--> statement-breakpoint
SELECT ensure_analytics_events_partition(CURRENT_DATE);
--> statement-breakpoint
SELECT ensure_analytics_events_partition((CURRENT_DATE + interval '1 month')::date);
--> statement-breakpoint
SELECT ensure_analytics_events_partition((CURRENT_DATE + interval '2 months')::date);
