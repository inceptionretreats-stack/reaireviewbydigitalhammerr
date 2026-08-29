import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';

/**
 * Error envelope from 23_API_Error_Codes.md.
 *
 * Every response carries a request_id so a customer-facing message can be traced back to a
 * log line without the message itself leaking anything. AC-030 and the security baseline both
 * require that provider errors, stack traces and internal identifiers never reach a public
 * client, so callers pass a safe message and log the detail separately.
 */

export const ERROR_STATUS: Record<string, number> = {
  AUTH_REQUIRED: 401,
  AUTH_INVALID_CREDENTIALS: 401,
  AUTH_RATE_LIMITED: 429,
  FORBIDDEN: 403,
  TENANT_SCOPE_VIOLATION: 403,
  VALIDATION_FAILED: 422,
  RESOURCE_NOT_FOUND: 404,
  SLUG_UNAVAILABLE: 409,
  BUSINESS_NOT_ACTIVE: 409,
  REVIEW_DESTINATION_INVALID: 422,
  PLAN_QUOTA_EXHAUSTED: 402,
  FAIR_USE_THROTTLED: 429,
  PUBLIC_RATE_LIMITED: 429,
  AI_PROVIDER_UNAVAILABLE: 503,
  AI_OUTPUT_REJECTED: 503,
  QR_NOT_FOUND: 404,
  QR_DISABLED: 410,
  DOMAIN_ALREADY_CLAIMED: 409,
  DOMAIN_VERIFICATION_PENDING: 409,
  PAYMENT_VERIFICATION_FAILED: 400,
  SUBSCRIPTION_NOT_ACTIVE: 402,
  UPLOAD_INVALID: 422,
  ADMIN_REASON_REQUIRED: 422,
  INTERNAL_ERROR: 500,
};

export function apiError(
  code: keyof typeof ERROR_STATUS | string,
  message: string,
  details?: Record<string, unknown>,
): NextResponse {
  const status = ERROR_STATUS[code] ?? 500;
  return NextResponse.json(
    { error: { code, message, request_id: randomUUID(), ...(details ? { details } : {}) } },
    { status },
  );
}
