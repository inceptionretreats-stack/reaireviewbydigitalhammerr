CREATE TABLE "maintenance_jobs" (
	"name" varchar(80) PRIMARY KEY NOT NULL,
	"state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_started_at" timestamp with time zone,
	"last_completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
