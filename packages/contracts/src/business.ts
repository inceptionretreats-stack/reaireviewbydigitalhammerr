import { z } from 'zod';

/** ONB-01. Description is 0-500 per the screen spec (AMENDMENT-009). */
export const businessIdentityRequest = z.object({
  name: z.string().min(2).max(160),
  category: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  city: z.string().max(100),
  state: z.string().max(100),
  slug: z.string().min(3).max(48),
  timezone: z.string().max(64).default('Asia/Kolkata'),
});
export type BusinessIdentityRequest = z.infer<typeof businessIdentityRequest>;

/** ONB-02. Shape only; the Google-host allow-list lives in core and is authoritative. */
export const reviewDestinationRequest = z.object({
  url: z.url().startsWith('https://', 'The link must start with https://'),
  label: z.string().max(80).default('Google'),
});
export type ReviewDestinationRequest = z.infer<typeof reviewDestinationRequest>;

/**
 * ONB-04 / AI-01. Deliberately no "mandatory keywords" field.
 *
 * D-025 and 09_AI_Prompt_and_Generation_Spec.md are explicit: there must be no setting called
 * "mandatory keywords in every review". Terms are context hints, and the absence of that field
 * from the contract is what stops one being added by accident.
 */
/**
 * CHANGE-003. The language drafts are written in, per business. Mirrors the `draft_language`
 * enum in @ai-review/db and DRAFT_LANGUAGES in @ai-review/core; a test pins all three together.
 */
export const DRAFT_LANGUAGES = ['en', 'hinglish'] as const;
export type DraftLanguage = (typeof DRAFT_LANGUAGES)[number];
export const DEFAULT_DRAFT_LANGUAGE: DraftLanguage = 'hinglish';

export const aiContextRequest = z.object({
  summary: z.string().max(2000).optional(),
  services: z.array(z.string().max(80)).max(30).default([]),
  context_terms: z.array(z.string().max(80)).max(30).default([]),
  draft_language: z.enum(DRAFT_LANGUAGES).default(DEFAULT_DRAFT_LANGUAGE),
});
export type AiContextRequest = z.infer<typeof aiContextRequest>;

export const qrSourceRequest = z.object({
  source_label: z.string().min(1).max(120),
  internal_note: z.string().max(500).optional(),
});
export type QrSourceRequest = z.infer<typeof qrSourceRequest>;

/** CRM-01. */
export const customerRequest = z.object({
  name: z.string().min(1).max(120),
  mobile: z.string().min(8).max(20),
  email: z.email().optional(),
  visit_date: z.iso.date().optional(),
  note: z.string().max(1000).optional(),
});
export type CustomerRequest = z.infer<typeof customerRequest>;

/**
 * AMENDMENT-029. What the owner wants printed on their GST invoice. Every field is optional —
 * a business with no GSTIN still gets an invoice, just one addressed to the business by name.
 * Empty strings clear a field; the GSTIN and state code are checked for shape only, the seller's
 * accountant checks the rest.
 */
const GSTIN_SHAPE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export const billingDetailsRequest = z.object({
  billing_legal_name: z.string().trim().max(200).default(''),
  gstin: z
    .string()
    .trim()
    .toUpperCase()
    .refine((v) => v === '' || GSTIN_SHAPE.test(v), 'Enter a 15-character GSTIN.')
    .default(''),
  billing_state_code: z
    .string()
    .trim()
    .refine((v) => v === '' || /^[0-9]{2}$/.test(v), 'Enter the two-digit GST state code.')
    .default(''),
  billing_address: z.string().trim().max(500).default(''),
});
export type BillingDetailsRequest = z.infer<typeof billingDetailsRequest>;
