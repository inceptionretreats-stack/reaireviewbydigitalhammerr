-- AI Review by Digital Hammerr - PostgreSQL 18 schema draft
-- This is a developer-ready logical schema, not a substitute for migration review.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TYPE user_role AS ENUM ('BUSINESS_OWNER','BUSINESS_SUPPORT_VIEWER','SUPER_ADMIN');
CREATE TYPE business_status AS ENUM ('DRAFT','ACTIVE','SUSPENDED','CLOSED');
CREATE TYPE subscription_status AS ENUM ('FREE','CHECKOUT_PENDING','PRO_ACTIVE','PAST_DUE','EXPIRED','CANCELLED');
CREATE TYPE feedback_status AS ENUM ('NEW','READ','ARCHIVED');
CREATE TYPE customer_request_status AS ENUM ('NOT_CONTACTED','MESSAGE_PREPARED','MESSAGE_SENT_MANUAL','LINK_CLICKED','AI_GENERATED','REVIEW_COPIED','GOOGLE_OPENED','PRIVATE_FEEDBACK');
CREATE TYPE qr_status AS ENUM ('ACTIVE','DISABLED');
CREATE TYPE domain_status AS ENUM ('PENDING_DNS','PENDING_SSL','ACTIVE','ERROR','REMOVED');
CREATE TYPE ai_prompt_status AS ENUM ('DRAFT','ACTIVE','ARCHIVED');

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email citext NOT NULL UNIQUE,
  mobile varchar(20),
  full_name varchar(120) NOT NULL,
  password_hash text NOT NULL,
  role user_role NOT NULL DEFAULT 'BUSINESS_OWNER',
  email_verified_at timestamptz,
  last_login_at timestamptz,
  failed_login_count int NOT NULL DEFAULT 0,
  locked_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE businesses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES users(id),
  name varchar(160) NOT NULL,
  slug citext NOT NULL UNIQUE,
  category varchar(100) NOT NULL,
  description varchar(1000),
  city varchar(100),
  state varchar(100),
  country_code char(2) NOT NULL DEFAULT 'IN',
  status business_status NOT NULL DEFAULT 'DRAFT',
  logo_asset_id uuid,
  cover_asset_id uuid,
  brand_accent varchar(7),
  config_version bigint NOT NULL DEFAULT 1,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX idx_businesses_owner ON businesses(owner_user_id);
CREATE INDEX idx_businesses_status ON businesses(status);

CREATE TABLE business_slug_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  slug citext NOT NULL UNIQUE,
  redirect_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid REFERENCES businesses(id) ON DELETE CASCADE,
  storage_key text NOT NULL UNIQUE,
  mime_type varchar(100) NOT NULL,
  bytes bigint NOT NULL CHECK (bytes >= 0),
  width int,
  height int,
  checksum_sha256 char(64),
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
ALTER TABLE businesses ADD CONSTRAINT fk_business_logo FOREIGN KEY (logo_asset_id) REFERENCES assets(id);
ALTER TABLE businesses ADD CONSTRAINT fk_business_cover FOREIGN KEY (cover_asset_id) REFERENCES assets(id);

CREATE TABLE business_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  link_type varchar(40) NOT NULL,
  label varchar(80) NOT NULL,
  url text,
  phone varchar(20),
  is_enabled boolean NOT NULL DEFAULT false,
  sort_order int NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, link_type, label)
);
CREATE INDEX idx_business_links_public ON business_links(business_id, is_enabled, sort_order);

CREATE TABLE review_destinations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  platform varchar(40) NOT NULL,
  label varchar(80) NOT NULL,
  url text NOT NULL,
  is_primary boolean NOT NULL DEFAULT false,
  is_enabled boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_one_primary_review_destination ON review_destinations(business_id) WHERE is_primary = true;

CREATE TABLE ai_business_contexts (
  business_id uuid PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
  summary text,
  services jsonb NOT NULL DEFAULT '[]'::jsonb,
  context_terms jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES users(id)
);

CREATE TABLE review_modes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name varchar(80) NOT NULL,
  description varchar(500),
  context_terms jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_active boolean NOT NULL DEFAULT false,
  is_archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, name)
);
CREATE UNIQUE INDEX uq_one_active_mode ON review_modes(business_id) WHERE is_active = true AND is_archived = false;

CREATE TABLE qr_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  code varchar(32) NOT NULL UNIQUE,
  source_label varchar(120) NOT NULL,
  internal_note varchar(500),
  status qr_status NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_qr_business ON qr_codes(business_id);

CREATE TABLE anonymous_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  public_token_hash char(64) NOT NULL UNIQUE,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  user_agent_hash char(64),
  ip_prefix_hash char(64),
  expires_at timestamptz NOT NULL
);
CREATE INDEX idx_anon_business_seen ON anonymous_sessions(business_id, first_seen_at);

CREATE TABLE ai_prompt_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version varchar(40) NOT NULL UNIQUE,
  status ai_prompt_status NOT NULL DEFAULT 'DRAFT',
  model varchar(80) NOT NULL,
  reasoning_effort varchar(20) NOT NULL DEFAULT 'none',
  system_prompt text NOT NULL,
  output_schema jsonb NOT NULL,
  max_output_tokens int NOT NULL DEFAULT 220,
  rollout_percent int NOT NULL DEFAULT 100 CHECK (rollout_percent BETWEEN 0 AND 100),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz
);

CREATE TABLE ai_generations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  anonymous_session_id uuid REFERENCES anonymous_sessions(id) ON DELETE SET NULL,
  qr_code_id uuid REFERENCES qr_codes(id) ON DELETE SET NULL,
  review_mode_id uuid REFERENCES review_modes(id) ON DELETE SET NULL,
  parent_generation_id uuid REFERENCES ai_generations(id) ON DELETE SET NULL,
  prompt_version_id uuid NOT NULL REFERENCES ai_prompt_versions(id),
  model varchar(80) NOT NULL,
  generation_number int NOT NULL DEFAULT 1,
  review_text text NOT NULL,
  input_tokens int,
  output_tokens int,
  provider_request_id varchar(160),
  similarity_score numeric(5,4),
  moderation_flags jsonb NOT NULL DEFAULT '{}'::jsonb,
  counted_toward_quota boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_ai_gen_business_created ON ai_generations(business_id, created_at DESC);
CREATE INDEX idx_ai_gen_session ON ai_generations(anonymous_session_id, created_at);

CREATE TABLE subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL UNIQUE REFERENCES businesses(id) ON DELETE CASCADE,
  status subscription_status NOT NULL DEFAULT 'FREE',
  plan_code varchar(40) NOT NULL DEFAULT 'AI_REVIEW_PRO_ANNUAL',
  currency char(3) NOT NULL DEFAULT 'INR',
  amount_paise int NOT NULL DEFAULT 99900,
  free_generation_limit int NOT NULL DEFAULT 10,
  free_generations_used int NOT NULL DEFAULT 0,
  fair_use_monthly_soft_limit int,
  starts_at timestamptz,
  expires_at timestamptz,
  razorpay_plan_id varchar(100),
  razorpay_subscription_id varchar(100),
  auto_renew boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (free_generations_used >= 0)
);

CREATE TABLE payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  subscription_id uuid REFERENCES subscriptions(id) ON DELETE SET NULL,
  provider varchar(40) NOT NULL DEFAULT 'RAZORPAY',
  provider_payment_id varchar(120),
  provider_order_id varchar(120),
  provider_subscription_id varchar(120),
  amount_paise int NOT NULL,
  currency char(3) NOT NULL DEFAULT 'INR',
  status varchar(40) NOT NULL,
  raw_reference jsonb NOT NULL DEFAULT '{}'::jsonb,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_payments_business ON payments(business_id, created_at DESC);

CREATE TABLE payment_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider varchar(40) NOT NULL,
  provider_event_id varchar(160) UNIQUE,
  event_type varchar(120) NOT NULL,
  payload_hash char(64) NOT NULL,
  processed_at timestamptz,
  processing_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE private_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  anonymous_session_id uuid REFERENCES anonymous_sessions(id) ON DELETE SET NULL,
  name varchar(120),
  mobile varchar(20),
  message varchar(2000) NOT NULL,
  status feedback_status NOT NULL DEFAULT 'NEW',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_feedback_business_status ON private_feedback(business_id, status, created_at DESC);

CREATE TABLE customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name varchar(120) NOT NULL,
  mobile varchar(20) NOT NULL,
  email citext,
  visit_date date,
  note varchar(1000),
  status customer_request_status NOT NULL DEFAULT 'NOT_CONTACTED',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX idx_customers_business_mobile ON customers(business_id, mobile) WHERE deleted_at IS NULL;

CREATE TABLE review_request_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name varchar(100) NOT NULL,
  template_text varchar(1200) NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_default_request_template ON review_request_templates(business_id) WHERE is_default = true;

CREATE TABLE review_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  template_id uuid REFERENCES review_request_templates(id) ON DELETE SET NULL,
  tracking_token_hash char(64) NOT NULL UNIQUE,
  rendered_message varchar(1500) NOT NULL,
  prepared_at timestamptz NOT NULL DEFAULT now(),
  marked_sent_at timestamptz,
  first_clicked_at timestamptz,
  last_clicked_at timestamptz
);
CREATE INDEX idx_review_requests_customer ON review_requests(customer_id, prepared_at DESC);

CREATE TABLE custom_domains (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  hostname citext NOT NULL UNIQUE,
  status domain_status NOT NULL DEFAULT 'PENDING_DNS',
  provider varchar(40) NOT NULL DEFAULT 'CLOUDFLARE',
  provider_hostname_id varchar(160),
  dns_target text,
  verification_records jsonb NOT NULL DEFAULT '[]'::jsonb,
  ssl_status varchar(60),
  activated_at timestamptz,
  last_checked_at timestamptz,
  error_message varchar(500),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_one_active_domain_per_business ON custom_domains(business_id) WHERE status = 'ACTIVE';

CREATE TABLE analytics_events (
  id bigserial PRIMARY KEY,
  event_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  anonymous_session_id uuid REFERENCES anonymous_sessions(id) ON DELETE SET NULL,
  qr_code_id uuid REFERENCES qr_codes(id) ON DELETE SET NULL,
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  event_name varchar(80) NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  properties jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX idx_events_business_time ON analytics_events(business_id, occurred_at DESC);
CREATE INDEX idx_events_business_name_time ON analytics_events(business_id, event_name, occurred_at DESC);

CREATE TABLE analytics_daily_business (
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  metric_date date NOT NULL,
  metric_name varchar(80) NOT NULL,
  dimension_key varchar(120) NOT NULL DEFAULT '',
  metric_value bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id, metric_date, metric_name, dimension_key)
);

CREATE TABLE admin_audit_logs (
  id bigserial PRIMARY KEY,
  actor_user_id uuid NOT NULL REFERENCES users(id),
  business_id uuid REFERENCES businesses(id),
  action varchar(120) NOT NULL,
  reason varchar(1000),
  target_type varchar(80),
  target_id varchar(120),
  before_state jsonb,
  after_state jsonb,
  ip_hash char(64),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_actor_time ON admin_audit_logs(actor_user_id, created_at DESC);
CREATE INDEX idx_audit_business_time ON admin_audit_logs(business_id, created_at DESC);

CREATE TABLE feature_flags (
  key varchar(120) PRIMARY KEY,
  description varchar(500),
  is_enabled boolean NOT NULL DEFAULT false,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE platform_settings (
  key varchar(120) PRIMARY KEY,
  value jsonb NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Recommended app-level invariants not fully represented by SQL:
-- 1. All business API access must scope resources by authenticated tenant.
-- 2. Free quota consumption + successful generation reservation must be atomic.
-- 3. Analytics must never infer "review submitted" from google_open.
-- 4. AI context terms are hints; they are not mandatory text requirements.
