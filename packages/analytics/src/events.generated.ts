// GENERATED FILE — do not edit by hand.
// Source: 11_Analytics_Event_Taxonomy.csv
// Regenerate: pnpm --filter @ai-review/analytics generate

export const EVENT_NAMES = [
  'qr_scan',
  'review_page_view',
  'ai_generate_click',
  'ai_generate_success',
  'ai_generate_failure',
  'ai_regenerate_click',
  'review_edit',
  'experience_confirmed',
  'review_copy',
  'google_open',
  'private_feedback_open',
  'private_feedback_submit',
  'profile_view',
  'profile_link_click',
  'review_request_prepared',
  'review_request_marked_sent',
  'review_request_link_click',
  'qr_created',
  'custom_domain_added',
  'custom_domain_activated',
  'subscription_checkout_started',
  'subscription_activated',
  'admin_business_suspended',
] as const;

export type EventName = (typeof EVENT_NAMES)[number];

export interface EventSpec {
  readonly actor: string;
  readonly trigger: string;
  readonly required: readonly string[];
  readonly optional: readonly string[];
}

export const EVENT_SPECS = {
  'qr_scan': {
    actor: 'Public',
    trigger: "Dynamic QR resolved",
    required: ['business_id', 'qr_code_id', 'anonymous_session_id'],
    optional: ['source_label', 'referrer_host'],
  },
  'review_page_view': {
    actor: 'Public',
    trigger: "AI review page rendered",
    required: ['business_id', 'anonymous_session_id'],
    optional: ['qr_code_id', 'custom_domain'],
  },
  'ai_generate_click': {
    actor: 'Public',
    trigger: "Generate button pressed",
    required: ['business_id', 'anonymous_session_id'],
    optional: ['qr_code_id'],
  },
  'ai_generate_success': {
    actor: 'Server',
    trigger: "Usable draft returned",
    required: ['business_id', 'anonymous_session_id', 'generation_id'],
    optional: ['model', 'prompt_version', 'latency_ms', 'quota_type'],
  },
  'ai_generate_failure': {
    actor: 'Server',
    trigger: "AI generation failed",
    required: ['business_id', 'anonymous_session_id'],
    optional: ['error_class', 'provider', 'latency_ms'],
  },
  'ai_regenerate_click': {
    actor: 'Public',
    trigger: "Regenerate pressed",
    required: ['business_id', 'anonymous_session_id', 'generation_id'],
    optional: ['generation_number'],
  },
  'review_edit': {
    actor: 'Public',
    trigger: "Customer materially edited draft",
    required: ['business_id', 'anonymous_session_id', 'generation_id'],
    optional: ['edit_length_delta'],
  },
  'experience_confirmed': {
    actor: 'Public',
    trigger: "Genuine experience checkbox checked",
    required: ['business_id', 'anonymous_session_id', 'generation_id'],
    optional: [],
  },
  'review_copy': {
    actor: 'Public',
    trigger: "Review copied",
    required: ['business_id', 'anonymous_session_id', 'generation_id'],
    optional: ['was_edited'],
  },
  'google_open': {
    actor: 'Public',
    trigger: "Primary Google review destination opened",
    required: ['business_id', 'anonymous_session_id'],
    optional: ['generation_id', 'destination_id', 'qr_code_id'],
  },
  'private_feedback_open': {
    actor: 'Public',
    trigger: "Private feedback form opened",
    required: ['business_id', 'anonymous_session_id'],
    optional: ['qr_code_id'],
  },
  'private_feedback_submit': {
    actor: 'Public',
    trigger: "Private feedback stored",
    required: ['business_id', 'anonymous_session_id'],
    optional: ['feedback_id'],
  },
  'profile_view': {
    actor: 'Public',
    trigger: "Business trust page viewed",
    required: ['business_id', 'anonymous_session_id'],
    optional: ['custom_domain'],
  },
  'profile_link_click': {
    actor: 'Public',
    trigger: "Enabled profile link clicked",
    required: ['business_id', 'anonymous_session_id'],
    optional: ['link_type', 'link_id'],
  },
  'review_request_prepared': {
    actor: 'Business',
    trigger: "Manual message created",
    required: ['business_id', 'customer_id', 'review_request_id'],
    optional: ['template_id'],
  },
  'review_request_marked_sent': {
    actor: 'Business',
    trigger: "Owner manually marked sent",
    required: ['business_id', 'customer_id', 'review_request_id'],
    optional: [],
  },
  'review_request_link_click': {
    actor: 'Public',
    trigger: "Tracked manual request link opened",
    required: ['business_id', 'review_request_id'],
    optional: ['anonymous_session_id'],
  },
  'qr_created': {
    actor: 'Business',
    trigger: "QR source created",
    required: ['business_id', 'qr_code_id'],
    optional: ['source_label'],
  },
  'custom_domain_added': {
    actor: 'Business',
    trigger: "Custom hostname requested",
    required: ['business_id', 'custom_domain_id'],
    optional: ['hostname'],
  },
  'custom_domain_activated': {
    actor: 'System',
    trigger: "Custom hostname active",
    required: ['business_id', 'custom_domain_id'],
    optional: ['provider'],
  },
  'subscription_checkout_started': {
    actor: 'Business',
    trigger: "Checkout initiated",
    required: ['business_id'],
    optional: ['amount_paise', 'plan_code'],
  },
  'subscription_activated': {
    actor: 'System',
    trigger: "Verified entitlement activated",
    required: ['business_id'],
    optional: ['provider', 'provider_subscription_id'],
  },
  'admin_business_suspended': {
    actor: 'Admin',
    trigger: "Tenant suspended",
    required: ['business_id', 'actor_user_id'],
    optional: ['reason'],
  },
} as const satisfies Record<EventName, EventSpec>;

/** Property keys each event requires, as a literal union per event. */
export interface EventRequiredProps {
  'qr_scan': 'business_id' | 'qr_code_id' | 'anonymous_session_id';
  'review_page_view': 'business_id' | 'anonymous_session_id';
  'ai_generate_click': 'business_id' | 'anonymous_session_id';
  'ai_generate_success': 'business_id' | 'anonymous_session_id' | 'generation_id';
  'ai_generate_failure': 'business_id' | 'anonymous_session_id';
  'ai_regenerate_click': 'business_id' | 'anonymous_session_id' | 'generation_id';
  'review_edit': 'business_id' | 'anonymous_session_id' | 'generation_id';
  'experience_confirmed': 'business_id' | 'anonymous_session_id' | 'generation_id';
  'review_copy': 'business_id' | 'anonymous_session_id' | 'generation_id';
  'google_open': 'business_id' | 'anonymous_session_id';
  'private_feedback_open': 'business_id' | 'anonymous_session_id';
  'private_feedback_submit': 'business_id' | 'anonymous_session_id';
  'profile_view': 'business_id' | 'anonymous_session_id';
  'profile_link_click': 'business_id' | 'anonymous_session_id';
  'review_request_prepared': 'business_id' | 'customer_id' | 'review_request_id';
  'review_request_marked_sent': 'business_id' | 'customer_id' | 'review_request_id';
  'review_request_link_click': 'business_id' | 'review_request_id';
  'qr_created': 'business_id' | 'qr_code_id';
  'custom_domain_added': 'business_id' | 'custom_domain_id';
  'custom_domain_activated': 'business_id' | 'custom_domain_id';
  'subscription_checkout_started': 'business_id';
  'subscription_activated': 'business_id';
  'admin_business_suspended': 'business_id' | 'actor_user_id';
}

/** Property keys each event may additionally carry. */
export interface EventOptionalProps {
  'qr_scan': 'source_label' | 'referrer_host';
  'review_page_view': 'qr_code_id' | 'custom_domain';
  'ai_generate_click': 'qr_code_id';
  'ai_generate_success': 'model' | 'prompt_version' | 'latency_ms' | 'quota_type';
  'ai_generate_failure': 'error_class' | 'provider' | 'latency_ms';
  'ai_regenerate_click': 'generation_number';
  'review_edit': 'edit_length_delta';
  'experience_confirmed': never;
  'review_copy': 'was_edited';
  'google_open': 'generation_id' | 'destination_id' | 'qr_code_id';
  'private_feedback_open': 'qr_code_id';
  'private_feedback_submit': 'feedback_id';
  'profile_view': 'custom_domain';
  'profile_link_click': 'link_type' | 'link_id';
  'review_request_prepared': 'template_id';
  'review_request_marked_sent': never;
  'review_request_link_click': 'anonymous_session_id';
  'qr_created': 'source_label';
  'custom_domain_added': 'hostname';
  'custom_domain_activated': 'provider';
  'subscription_checkout_started': 'amount_paise' | 'plan_code';
  'subscription_activated': 'provider' | 'provider_subscription_id';
  'admin_business_suspended': 'reason';
}
