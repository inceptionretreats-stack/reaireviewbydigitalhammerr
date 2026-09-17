-- Deployment-only hardening for Ai Review's dedicated Supabase project.
-- Run as the restored app table owner after importing public + drizzle.
-- Existing custom sessions authorize through the Next.js API; browser API roles get no access.
-- This is separate from Drizzle migration history so local/Postgres-only installs are unchanged.
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $secure$
DECLARE
  app_tables text[] := ARRAY[
    'password_reset_tokens', 'sessions', 'user_invites', 'users', 'assets',
    'business_links', 'business_slugs', 'businesses', 'review_destinations',
    'anonymous_sessions', 'qr_codes', 'ai_business_contexts', 'ai_generations',
    'ai_prompt_versions', 'review_modes', 'payment_webhook_events', 'payments',
    'subscriptions', 'customers', 'private_feedback', 'review_request_templates',
    'review_requests', 'custom_domains', 'analytics_daily_business', 'analytics_events',
    'admin_audit_logs', 'feature_flags', 'platform_settings', 'mfa_recovery_codes',
    'invoice_sequences', 'payment_refunds', 'subscription_reminders', 'user_activity_logs'
  ];
  object_name text;
  item record;
BEGIN
  -- Fail closed on a wrong/incomplete target, rather than changing unrelated tables.
  IF (SELECT count(*) FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role')) <> 3 THEN
    RAISE EXCEPTION 'Expected Supabase API roles are missing; verify the target project';
  END IF;
  FOREACH object_name IN ARRAY app_tables LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = object_name AND c.relkind IN ('r', 'p')
        AND c.relowner = (SELECT oid FROM pg_roles WHERE rolname = current_user)
    ) THEN
      RAISE EXCEPTION 'Expected app table missing or owned by another role: %', object_name;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = object_name) THEN
      RAISE EXCEPTION 'Unexpected existing RLS policies on %; review them before hardening', object_name;
    END IF;
  END LOOP;

  FOR item IN
    SELECT c.oid, c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
      AND (c.relname = ANY(app_tables) OR c.oid IN (
        SELECT relid FROM pg_partition_tree('public.analytics_events'::regclass)
      ))
  LOOP
    -- A child can be queried directly, so its policies need the same fail-closed review.
    IF EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = item.oid) THEN
      RAISE EXCEPTION 'Unexpected existing RLS policies on %; review them before hardening', item.relname;
    END IF;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', item.relname);
    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM PUBLIC, anon, authenticated, service_role', item.relname);
  END LOOP;

  -- Revoke only sequences owned by app tables, not Supabase's internal objects.
  FOR item IN
    SELECT DISTINCT seq.relname FROM pg_class seq
    JOIN pg_namespace ns ON ns.oid = seq.relnamespace
    JOIN pg_depend d ON d.objid = seq.oid AND d.deptype IN ('a', 'i')
      AND d.classid = 'pg_class'::regclass AND d.refclassid = 'pg_class'::regclass
    JOIN pg_class tbl ON tbl.oid = d.refobjid
    JOIN pg_namespace tn ON tn.oid = tbl.relnamespace
    WHERE ns.nspname = 'public' AND seq.relkind = 'S'
      AND tn.nspname = 'public' AND tbl.relname = ANY(app_tables)
  LOOP
    EXECUTE format('REVOKE ALL PRIVILEGES ON SEQUENCE public.%I FROM PUBLIC, anon, authenticated, service_role', item.relname);
  END LOOP;

  -- These defaults apply only to future objects created by this migration owner in public.
  EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated, service_role', current_user);
  EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated, service_role', current_user);
  -- PUBLIC function execution is a global default; a schema-level revoke cannot override it.
  EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC', current_user);
  EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated, service_role', current_user);
END;
$secure$;

-- Future partitions need their own RLS and grants; parent RLS alone does not protect direct access.
CREATE OR REPLACE FUNCTION public.ensure_analytics_events_partition(target_month date)
RETURNS text
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $partition$
DECLARE
  start_date date := date_trunc('month', target_month)::date;
  end_date date := (date_trunc('month', target_month) + interval '1 month')::date;
  part_name text := format('analytics_events_%s', to_char(start_date, 'YYYY_MM'));
BEGIN
  IF target_month IS NULL THEN
    RAISE EXCEPTION 'target_month must not be null';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = part_name AND n.nspname = 'public'
  ) THEN
    EXECUTE format(
      'CREATE TABLE public.%I PARTITION OF public.analytics_events FOR VALUES FROM (%L) TO (%L)',
      part_name, start_date, end_date
    );
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_inherits
    WHERE inhparent = 'public.analytics_events'::regclass
      AND inhrelid = to_regclass(format('public.%I', part_name))
  ) THEN
    RAISE EXCEPTION 'Existing % is not an analytics partition', part_name;
  END IF;
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', part_name);
  EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM PUBLIC, anon, authenticated, service_role', part_name);
  RETURN part_name;
END;
$partition$;

ALTER FUNCTION public.reset_pro_quota_on_period_change() SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION public.ensure_analytics_events_partition(date) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.reset_pro_quota_on_period_change() FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
