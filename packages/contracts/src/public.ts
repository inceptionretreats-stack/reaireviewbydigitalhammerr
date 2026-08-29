import { z } from 'zod';

/**
 * Shared request/response contracts (08_OpenAPI_v1.yaml, 02_System_Architecture.md).
 *
 * One Zod definition per payload, used by the browser form, the route handler and the worker,
 * so a field cannot be validated one way on the client and another on the server. Server-side
 * validation remains authoritative (03_Screen_Field_Button_Spec.md preamble).
 *
 * These also fill in what OPEN-04 records as missing: the delivered OpenAPI declares almost no
 * request or response schemas, so the contract is defined here and the YAML is completed from
 * it endpoint by endpoint.
 */

/**
 * The browser holds only public identifiers. The tenant is resolved server-side from the slug
 * or QR code (02_System_Architecture.md: 'slug resolution server-side'), so no internal UUID
 * crosses the boundary and no caller can nominate a business it does not own.
 */
export const generateReviewRequest = z.object({
  slug: z.string().min(3).max(48).optional(),
  qr_code: z.string().min(6).max(32).optional(),
  previous_generation_id: z.uuid().optional(),
});
export type GenerateReviewRequest = z.infer<typeof generateReviewRequest>;

/**
 * requires_experience_confirmation is a literal true rather than a boolean.
 *
 * ADR-008 and AC-008 make the confirmation gate mandatory, so there is no valid response in
 * which it is false — encoding it as a constant means a client cannot be written against a
 * shape where Copy is enabled without it.
 */
export const generateReviewResponse = z.object({
  generation_id: z.uuid(),
  review_text: z.string().min(20).max(1200),
  prompt_version: z.string(),
  requires_experience_confirmation: z.literal(true),
});
export type GenerateReviewResponse = z.infer<typeof generateReviewResponse>;

/** FB-01. Name and mobile are optional; only the message is required. */
export const submitFeedbackRequest = z.object({
  slug: z.string().min(3).max(48),
  name: z.string().max(120).optional(),
  mobile: z.string().max(20).optional(),
  message: z.string().min(5).max(2000),
});
export type SubmitFeedbackRequest = z.infer<typeof submitFeedbackRequest>;

/**
 * Identity properties (business_id, anonymous_session_id, qr_code_id) are deliberately absent:
 * the server injects them from resolved state so a client cannot write into another tenant.
 */
export const publicEventRequest = z.object({
  slug: z.string().min(3).max(48).optional(),
  qr_code: z.string().min(6).max(32).optional(),
  name: z.string().min(1).max(80),
  properties: z.record(z.string(), z.unknown()).default({}),
});
export type PublicEventRequest = z.infer<typeof publicEventRequest>;

/**
 * Public tenant configuration.
 *
 * RBAC rule 6: hostname and slug resolution may return public configuration only. There is
 * deliberately no field here for anything private — no owner details, no analytics, no
 * subscription state.
 */
export const publicBusinessResponse = z.object({
  slug: z.string(),
  name: z.string(),
  logo_url: z.url().nullable(),
  review_url: z.url().nullable(),
  review_platform_label: z.string(),
  sections: z.array(
    z.object({
      id: z.uuid(),
      type: z.enum([
        'GOOGLE_REVIEW',
        'WHATSAPP',
        'CALL',
        'INSTAGRAM',
        'FACEBOOK',
        'WEBSITE',
        'DIRECTIONS',
        'CUSTOM',
      ]),
      label: z.string(),
      url: z.url().nullable(),
      sort_order: z.number().int(),
    }),
  ),
});
export type PublicBusinessResponse = z.infer<typeof publicBusinessResponse>;

export const apiErrorResponse = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    request_id: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});
export type ApiErrorResponse = z.infer<typeof apiErrorResponse>;
