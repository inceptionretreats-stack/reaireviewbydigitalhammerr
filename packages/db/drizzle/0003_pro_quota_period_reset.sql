-- The subscription row is reused when an annual plan renews. Resetting the counter is a database
-- invariant rather than a convention for one future webhook: any genuine period change starts a
-- fresh allowance, while retries that write the same starts_at value are idempotent.
DROP TRIGGER IF EXISTS "trg_reset_pro_quota_on_period_change" ON "subscriptions";--> statement-breakpoint
CREATE OR REPLACE FUNCTION "reset_pro_quota_on_period_change"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	-- A caller may deliberately import/backfill a non-zero count in the same statement. Respect an
	-- explicit counter change; reset only when advancing the period would otherwise carry the old
	-- year's usage forward unchanged.
	IF NEW."pro_generations_used" IS NOT DISTINCT FROM OLD."pro_generations_used" THEN
		NEW."pro_generations_used" := 0;
	END IF;
	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "trg_reset_pro_quota_on_period_change"
BEFORE UPDATE OF "starts_at" ON "subscriptions"
FOR EACH ROW
WHEN (OLD."starts_at" IS DISTINCT FROM NEW."starts_at")
EXECUTE FUNCTION "reset_pro_quota_on_period_change"();
