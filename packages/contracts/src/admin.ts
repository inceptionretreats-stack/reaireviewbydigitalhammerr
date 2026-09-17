import { z } from 'zod';

/**
 * ADMIN-02 / ADMIN-04 request shapes.
 *
 * Every mutation carries a `reason`, required at the contract as well as by the audit writer:
 * RBAC rule 5 says high-risk admin actions require one, and a request that could omit it would
 * only fail later, after the operator had typed everything else.
 */

const reason = z
  .string()
  .trim()
  .min(3, 'Give a reason — it is written to the audit log.')
  .max(1000);

export const adminBusinessAction = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('activate_pro'),
    reason,
    /** Whole months; one year by default. */
    months: z.number().int().min(1).max(60).default(12),
    note: z.string().trim().max(500).optional(),
  }),
  z.object({ action: z.literal('revoke_pro'), reason }),
  z.object({
    action: z.literal('adjust_free_quota'),
    reason,
    free_generation_limit: z.number().int().min(0).max(100_000),
  }),
  z.object({ action: z.literal('reset_free_usage'), reason }),
  z.object({ action: z.literal('suspend'), reason }),
  z.object({ action: z.literal('reactivate'), reason }),
  // AMENDMENT-030 — abuse responses, narrower than a suspension.
  z.object({
    action: z.literal('warn'),
    reason,
    /** What the owner is told, in the email. */
    message: z.string().trim().min(10).max(1000),
  }),
  z.object({ action: z.literal('suspend_ai'), reason }),
  z.object({ action: z.literal('restore_ai'), reason }),
  z.object({
    action: z.literal('throttle'),
    reason,
    per_hour: z.number().int().min(1).max(10_000),
    /** Hours from now; a day by default, a month at most. */
    hours: z
      .number()
      .int()
      .min(1)
      .max(24 * 31)
      .default(24),
  }),
  z.object({ action: z.literal('unthrottle'), reason }),
  // Owner & account tab: the same reset email the forgot-password screen sends, audited.
  z.object({ action: z.literal('send_password_reset'), reason }),
]);
export type AdminBusinessAction = z.infer<typeof adminBusinessAction>;

export const adminBusinessListQuery = z.object({
  q: z.string().trim().max(120).optional(),
  plan: z.enum(['free', 'pro']).optional(),
  status: z.enum(['DRAFT', 'ACTIVE', 'SUSPENDED', 'CLOSED']).optional(),
  /** Paid periods ending within 30 days. */
  expiring: z.coerce.boolean().optional(),
  /** AMENDMENT-030: the top decile of Ai usage in the last 24 hours. */
  high_ai: z.coerce.boolean().optional(),
  /** Businesses whose Ai is suspended or throttled right now. */
  ai_limited: z.coerce.boolean().optional(),
  page: z.coerce.number().int().min(1).default(1),
});
export type AdminBusinessListQuery = z.infer<typeof adminBusinessListQuery>;

export const adminSettingsPatch = z.object({
  reason,
  free_generation_limit: z.number().int().min(0).max(100_000).optional(),
  annual_price_paise: z.number().int().min(100).max(10_000_000).optional(),
  pro_generation_limit: z.number().int().min(1).max(1_000_000).optional(),
  fair_use_monthly_soft_limit: z.number().int().min(1).max(1_000_000).nullable().optional(),
  // AMENDMENT-029 — the seller side of every invoice.
  seller_legal_name: z.string().trim().min(1).max(200).optional(),
  seller_address: z.string().trim().max(500).optional(),
  seller_gstin: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, 'Enter a 15-character GSTIN.')
    .nullable()
    .optional(),
  seller_state_code: z
    .string()
    .trim()
    .regex(/^[0-9]{2}$/, 'Two digits.')
    .nullable()
    .optional(),
  seller_sac_code: z
    .string()
    .trim()
    .regex(/^[0-9]{4,8}$/)
    .optional(),
  invoice_prefix: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{1,8}$/, 'Letters and digits, up to 8.')
    .optional(),
  gst_rate_bps: z.number().int().min(0).max(10_000).optional(),
});
export type AdminSettingsPatch = z.infer<typeof adminSettingsPatch>;

/** ADMIN-03. One rule per line in the UI; the API carries them as string arrays. */
const ruleLines = z.array(z.string().trim().max(600)).max(40);

export const promptGuidanceInput = z.object({
  language_rules: z.object({ en: ruleLines, hinglish: ruleLines }),
  claim_rules: ruleLines,
  emoji_rules: ruleLines,
  opening_hints: ruleLines.min(1, 'At least one opening angle.'),
  emoji_placements: ruleLines.min(1, 'At least one placement.'),
});

export const promptVersionDraftInput = z.object({
  version: z
    .string()
    .trim()
    .regex(/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/, 'Use a version like 1.2.0.'),
  model: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9._-]{1,80}$/, 'A plain model id, like gemini-3.5-flash-lite.'),
  reasoning_effort: z.string().trim().max(20),
  max_output_tokens: z.number().int().min(64).max(4096),
  system_prompt: z.string().trim().min(40).max(20_000),
  guidance: promptGuidanceInput,
});
export type PromptVersionDraftInput = z.infer<typeof promptVersionDraftInput>;

/** Create: optionally cloned from another version, with any field overridden. */
export const promptVersionCreate = promptVersionDraftInput.partial().extend({
  clone_from: z.string().uuid().optional(),
  version: promptVersionDraftInput.shape.version,
});

export const promptVersionAction = z.object({ reason });

/** AMENDMENT-027 — the admin team. */
export const adminRole = z.enum(['SUPER_ADMIN', 'BUSINESS_SUPPORT_VIEWER']);
export type AdminRole = z.infer<typeof adminRole>;
export const adminTeamInvite = z.object({
  email: z.email(),
  full_name: z.string().trim().min(2).max(80),
  role: adminRole,
  reason,
});
export type AdminTeamInvite = z.infer<typeof adminTeamInvite>;
export const adminTeamAction = z.discriminatedUnion('action', [
  z.object({ action: z.literal('change_role'), role: adminRole, reason }),
  z.object({ action: z.literal('disable'), reason }),
  z.object({ action: z.literal('enable'), reason }),
]);
export type AdminTeamAction = z.infer<typeof adminTeamAction>;
export const adminMfaReset = z.object({ reason });

/** AMENDMENT-028 — the activity explorer's filters. */
export const adminActivityQuery = z.object({
  user: z.uuid().optional(),
  business: z.uuid().optional(),
  action: z
    .string()
    .trim()
    .regex(/^[a-z_]+(\.[a-z_]+)*\.?$/)
    .max(80)
    .optional(),
  outcome: z.enum(['SUCCESS', 'FAILURE', 'DENIED']).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  before: z.coerce.number().int().positive().optional(),
});
export type AdminActivityQuery = z.infer<typeof adminActivityQuery>;

/** AMENDMENT-029 — payment control. */
export const adminPaymentListQuery = z.object({
  status: z.enum(['CREATED', 'AUTHORIZED', 'CAPTURED', 'REFUNDED', 'FAILED']).optional(),
  business: z.uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  refunded: z.enum(['yes', 'no']).optional(),
  before: z.uuid().optional(),
});
export type AdminPaymentListQuery = z.infer<typeof adminPaymentListQuery>;

export const adminWebhookQuery = z.object({
  outcome: z.enum(['processed', 'duplicate', 'ignored', 'rejected', 'failed']).optional(),
  event: z
    .string()
    .trim()
    .regex(/^[a-z_.]{1,60}$/)
    .optional(),
  before: z.uuid().optional(),
});
export type AdminWebhookQuery = z.infer<typeof adminWebhookQuery>;

export const adminPaymentRefund = z.object({
  reason,
  /** Omit for a full refund of what is still refundable. */
  amount_paise: z.number().int().min(100).max(10_000_000).optional(),
});
export type AdminPaymentRefund = z.infer<typeof adminPaymentRefund>;

export const adminPaymentAction = z.object({
  action: z.enum(['reconcile', 'mark_failed', 'resend_receipt']),
  reason,
});
export type AdminPaymentAction = z.infer<typeof adminPaymentAction>;
