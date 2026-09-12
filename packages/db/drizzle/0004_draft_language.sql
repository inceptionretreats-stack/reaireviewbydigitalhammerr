CREATE TYPE "public"."draft_language" AS ENUM('en', 'hinglish');--> statement-breakpoint
ALTER TABLE "ai_business_contexts" ADD COLUMN "draft_language" "draft_language" DEFAULT 'hinglish' NOT NULL;