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
  // CHANGE-004: online payment is optional in production because admin activation exists; a
  // checkout attempted without Razorpay keys is refused with this rather than a misleading 500.
  PAYMENTS_NOT_CONFIGURED: 503,
  UPLOAD_INVALID: 422,
  ADMIN_REASON_REQUIRED: 422,
  INTERNAL_ERROR: 500,
};

export interface ApiErrorOptions {
  details?: Record<string, unknown>;
  /**
   * Emitted as Retry-After on a 429. Required for a well-behaved client to back off rather
   * than hammer, and AC-032 is not really satisfied by a bare 429 that gives no interval.
   */
  retryAfterSeconds?: number;
}

export function apiError(
  code: keyof typeof ERROR_STATUS | string,
  message: string,
  options: ApiErrorOptions = {},
): NextResponse {
  const status = ERROR_STATUS[code] ?? 500;
  const headers: Record<string, string> = {};

  if (options.retryAfterSeconds !== undefined) {
    headers['Retry-After'] = String(Math.max(1, Math.ceil(options.retryAfterSeconds)));
  }

  return NextResponse.json(
    {
      error: {
        code,
        message,
        request_id: randomUUID(),
        ...(options.details ? { details: options.details } : {}),
      },
    },
    { status, headers },
  );
}
