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
export const aiContextRequest = z.object({
  summary: z.string().max(2000).optional(),
  services: z.array(z.string().max(80)).max(30).default([]),
  context_terms: z.array(z.string().max(80)).max(30).default([]),
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
