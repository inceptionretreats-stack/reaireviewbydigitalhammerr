-- Four hot paths were running sequential scans. Confirmed with EXPLAIN against the live
-- schema, and invisible to the test suites because those tables are empty there.
--
-- The first one is the reason this migration exists at all: payments.provider_order_id is the
-- lookup key for CheckoutService.settleOrder, which runs `SELECT ... FOR UPDATE` on every
-- checkout callback and every Razorpay webhook. A sequential scan there is not only slow, it
-- holds the row lock for the duration of the scan, so settlement latency — the one path where
-- delay turns into money that was taken but not credited — degrades linearly with the total
-- number of payments across every tenant.

-- Settlement and reconciliation: `where provider_order_id = ? for update`.
CREATE INDEX IF NOT EXISTS "idx_payments_provider_order"
  ON "payments" ("provider_order_id")
  WHERE "provider_order_id" IS NOT NULL;
--> statement-breakpoint

-- The webhook ledger, joined per payment on the admin payments screen and read again by
-- PaymentAdminService.get; lastWebhookFor issues an `IN (...)` over 50 ids per list render.
CREATE INDEX IF NOT EXISTS "idx_payment_webhook_events_payment"
  ON "payment_webhook_events" ("payment_id", "created_at" DESC)
  WHERE "payment_id" IS NOT NULL;
--> statement-breakpoint

-- Audit rows for one payment. admin_audit_logs is append-only, so this scan only ever grows.
CREATE INDEX IF NOT EXISTS "idx_admin_audit_logs_target"
  ON "admin_audit_logs" ("target_type", "target_id", "created_at" DESC);
--> statement-breakpoint

-- REQ-01: loadRecentRequests, on the Review Requests screen every owner opens.
CREATE INDEX IF NOT EXISTS "idx_review_requests_business"
  ON "review_requests" ("business_id", "prepared_at" DESC);
