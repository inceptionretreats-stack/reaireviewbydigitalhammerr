import { NextResponse } from 'next/server';
import { adminSettingsPatch } from '@ai-review/contracts';
import {
  AuditReasonRequiredError,
  InvalidPlatformSettingError,
  PlatformSettingsService,
} from '@ai-review/core';
import { db } from '@/lib/db';
import { apiError } from '@/lib/api-error';
import { readJsonObject } from '@/lib/request-body';
import { requireAdmin } from '@/lib/require-admin';

export const runtime = 'nodejs';

/** ADMIN-04: the commercial numbers, each with the version of its stored row. */
export async function GET(request: Request) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;
  return NextResponse.json({ settings: await new PlatformSettingsService(db()).readAll() });
}

/**
 * "Versioned platform settings update" — one audit row per save, before/after per key.
 * AMENDMENT-027: a high-risk action, so a fresh MFA code is demanded (step-up).
 */
export async function PATCH(request: Request) {
  const auth = await requireAdmin(request, { stepUp: true });
  if (!auth.ok) return auth.response;

  const rawResult = await readJsonObject(request);
  if (!rawResult.ok) return rawResult.response;
  const raw = rawResult.body;
  const parsed = adminSettingsPatch.safeParse(raw);
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((i) => String(i.path[0] ?? 'body')))];
    if (fields.includes('reason')) {
      return apiError(
        'ADMIN_REASON_REQUIRED',
        'A reason is required; it is written to the audit log.',
      );
    }
    return apiError('VALIDATION_FAILED', 'Please check the values.', { details: { fields } });
  }

  const { reason, ...changes } = parsed.data;
  try {
    const settings = await new PlatformSettingsService(db()).update({
      actor: auth.context.actor,
      reason,
      changes,
    });
    return NextResponse.json({ settings });
  } catch (error) {
    if (error instanceof AuditReasonRequiredError) {
      return apiError(
        'ADMIN_REASON_REQUIRED',
        'A reason is required; it is written to the audit log.',
      );
    }
    if (error instanceof InvalidPlatformSettingError) {
      return apiError('VALIDATION_FAILED', error.message);
    }
    throw error;
  }
}
