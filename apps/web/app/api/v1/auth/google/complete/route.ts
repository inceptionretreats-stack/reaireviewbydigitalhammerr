import { NextResponse, type NextRequest } from 'next/server';
import { businesses, googleIdentities, subscriptions, users } from '@ai-review/db';
import { normalizePhone, PlatformSettingsService } from '@ai-review/core';
import { z } from 'zod';
import { apiError } from '@/lib/api-error';
import { readJsonObject } from '@/lib/request-body';
import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { verifyCsrf } from '@/lib/csrf';
import { SHELL_CATEGORY, shellBusinessName } from '@/lib/auth-helpers';
import { clearGooglePending, readGooglePending } from '@/lib/google-auth';
import { signInGoogleVendor } from '@/lib/google-auth-session';
import { recordActivity } from '@/lib/activity';
import { isUniqueViolation, safeError } from '@/lib/safe-error';

const completeRequest = z.object({
  flow_id: z.string().regex(/^[A-Za-z0-9_-]{32}$/),
  full_name: z.string().trim().min(2).max(80),
  mobile: z.string().trim().min(8).max(20),
  accept_terms: z.literal(true),
});

/** Complete the existing vendor signup transaction after Google has proved the identity. */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!verifyCsrf(request).ok) return apiError('FORBIDDEN', 'Request rejected.');
  const pending = await readGooglePending();
  if (!pending || pending.flow !== 'signup') {
    return apiError('AUTH_REQUIRED', 'Google sign-in expired. Please try again.');
  }

  const rawResult = await readJsonObject(request);
  if (!rawResult.ok) return rawResult.response;
  const raw = rawResult.body;
  const parsed = completeRequest.safeParse(raw);
  if (!parsed.success) {
    return apiError('VALIDATION_FAILED', 'Please check your details and accept the terms.', {
      details: {
        fields: [...new Set(parsed.error.issues.map((issue) => String(issue.path[0] ?? 'body')))],
      },
    });
  }
  if (parsed.data.flow_id !== pending.flowId) {
    return apiError('AUTH_REQUIRED', 'Google sign-in changed. Please start again.');
  }
  const phone = normalizePhone(parsed.data.mobile);
  if (!phone.ok) {
    return apiError('VALIDATION_FAILED', 'Enter a valid 10-digit mobile number.', {
      details: { fields: ['mobile'] },
    });
  }

  let userId: string;
  try {
    const database = db();
    const commercial = await new PlatformSettingsService(database).values();
    userId = await database.transaction(async (tx) => {
      const [user] = await tx
        .insert(users)
        .values({
          email: pending.email,
          mobile: phone.e164,
          fullName: parsed.data.full_name,
          passwordHash: null,
          role: 'BUSINESS_OWNER',
          // A third-party address may no longer belong to its Google-account holder, even when
          // Google says email_verified. Gmail and hosted Workspace addresses are authoritative.
          emailVerifiedAt: pending.authoritativeEmail ? new Date() : null,
        })
        .returning({ id: users.id });
      if (!user) throw new Error('Google signup user insert returned no row');

      await tx.insert(googleIdentities).values({
        userId: user.id,
        googleSubject: pending.sub,
      });

      const [business] = await tx
        .insert(businesses)
        .values({
          ownerUserId: user.id,
          name: shellBusinessName(parsed.data.full_name),
          category: SHELL_CATEGORY,
          status: 'DRAFT',
          timezone: env().DEFAULT_TIMEZONE,
        })
        .returning({ id: businesses.id });
      if (!business) throw new Error('Google signup business insert returned no row');

      await tx.insert(subscriptions).values({
        businessId: business.id,
        status: 'FREE',
        freeGenerationLimit: commercial.free_generation_limit,
        proGenerationLimit: commercial.pro_generation_limit,
        amountPaise: commercial.annual_price_paise,
      });
      return user.id;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      // A concurrent signup/link may have claimed either the email or the Google subject.
      await clearGooglePending();
      return apiError(
        'VALIDATION_FAILED',
        'This account has just been registered. Please try Google sign-in again.',
      );
    }
    console.error('[auth] Google signup failed', safeError(error));
    return apiError('INTERNAL_ERROR', 'We could not create your account. Please try again.');
  }

  await clearGooglePending();
  recordActivity(
    request,
    { userId },
    {
      action: 'auth.signup',
      targetType: 'user',
      targetId: userId,
      metadata: { provider: 'google' },
    },
  );

  try {
    await signInGoogleVendor(request, userId);
  } catch (error) {
    console.error('[auth] Google signup session failed after account creation', safeError(error));
    return apiError(
      'INTERNAL_ERROR',
      'Your account was created, but we could not sign you in. Please use Continue with Google again.',
      { details: { account_created: true, next: '/login' } },
    );
  }

  return NextResponse.json(
    { next: '/onboarding/business', onboarding_required: true },
    { status: 201, headers: { 'Cache-Control': 'no-store' } },
  );
}
