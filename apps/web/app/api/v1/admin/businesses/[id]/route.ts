import { NextResponse } from 'next/server';
import { adminBusinessAction } from '@ai-review/contracts';
import {
  AbuseService,
  AbuseTargetNotFoundError,
  AuditReasonRequiredError,
  InvalidQuotaAdjustmentError,
  SubscriptionNotFoundError,
  SubscriptionService,
} from '@ai-review/core';
import { analyticsEvents } from '@ai-review/db';
import { db } from '@/lib/infra/db';
import { apiError } from '@/lib/http/api-error';
import { readJsonObject } from '@/lib/http/request-body';
import { requireAdmin } from '@/lib/auth/require-admin';
import { getBusinessDetail } from '@/lib/admin/businesses';
import { sendOwnerPasswordReset, warnOwner } from '@/lib/admin/owner-actions';

export const runtime = 'nodejs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** ADMIN-02 detail: everything the operator needs to decide, on one screen. */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(request, { allowViewer: true });
  if (!auth.ok) return auth.response;

  const { id } = await ctx.params;
  if (!UUID.test(id)) return apiError('RESOURCE_NOT_FOUND', 'No such business.');
  const detail = await getBusinessDetail(db(), id);
  if (!detail) return apiError('RESOURCE_NOT_FOUND', 'No such business.');
  return NextResponse.json(detail);
}

/**
 * ADMIN-02 mutations, as one action-based PATCH ("Audited support/admin mutation" in the
 * OpenAPI contract). Every branch lands in SubscriptionService, which is where the reason rule,
 * the transaction and the audit row live — this handler only translates.
 */
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  const { id } = await ctx.params;
  if (!UUID.test(id)) return apiError('RESOURCE_NOT_FOUND', 'No such business.');

  const rawResult = await readJsonObject(request);
  if (!rawResult.ok) return rawResult.response;
  const raw = rawResult.body;
  const parsed = adminBusinessAction.safeParse(raw);
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((i) => String(i.path[0] ?? 'body')))];
    if (fields.includes('reason')) {
      return apiError(
        'ADMIN_REASON_REQUIRED',
        'A reason is required; it is written to the audit log.',
      );
    }
    return apiError('VALIDATION_FAILED', 'Please check the details you entered.', {
      details: { fields },
    });
  }

  const action = parsed.data;
  const service = new SubscriptionService(db());
  const base = { actor: auth.context.actor, reason: action.reason };

  try {
    switch (action.action) {
      case 'activate_pro':
        await service.activatePro(id, {
          source: 'ADMIN',
          ...base,
          months: action.months,
          note: action.note ?? null,
        });
        break;
      case 'revoke_pro':
        await service.revokePro(id, base);
        break;
      case 'adjust_free_quota':
        await service.adjustFreeQuota(id, {
          ...base,
          freeGenerationLimit: action.free_generation_limit,
        });
        break;
      case 'reset_free_usage':
        await service.resetFreeUsage(id, base);
        break;
      case 'suspend':
        await service.suspend(id, base);
        await recordAdminEvent(id, 'admin_business_suspended', {
          actor_user_id: auth.context.actor.userId,
          reason: action.reason,
        });
        break;
      case 'reactivate':
        await service.reactivate(id, base);
        break;
      // AMENDMENT-030 — abuse responses. Ai-only: the public page keeps working.
      case 'warn': {
        const { sent } = await warnOwner({ businessId: id, ...base, message: action.message });
        const detail = await getBusinessDetail(db(), id);
        return NextResponse.json({ ...detail, email_sent: sent });
      }
      case 'suspend_ai':
        await new AbuseService(db()).suspendAi(id, base);
        break;
      case 'restore_ai':
        await new AbuseService(db()).restoreAi(id, base);
        break;
      case 'throttle':
        await new AbuseService(db()).throttle(id, {
          ...base,
          perHour: action.per_hour,
          until: new Date(Date.now() + action.hours * 3_600_000),
        });
        break;
      case 'unthrottle':
        await new AbuseService(db()).unthrottle(id, base);
        break;
      case 'send_password_reset': {
        const { sent, email } = await sendOwnerPasswordReset({ businessId: id, ...base });
        const detail = await getBusinessDetail(db(), id);
        return NextResponse.json({ ...detail, email_sent: sent, email });
      }
    }
  } catch (error) {
    if (error instanceof SubscriptionNotFoundError || error instanceof AbuseTargetNotFoundError) {
      return apiError('RESOURCE_NOT_FOUND', 'No such business.');
    }
    if (error instanceof AuditReasonRequiredError) {
      return apiError(
        'ADMIN_REASON_REQUIRED',
        'A reason is required; it is written to the audit log.',
      );
    }
    if (error instanceof InvalidQuotaAdjustmentError) {
      return apiError('VALIDATION_FAILED', error.message, {
        details: { fields: ['free_generation_limit'] },
      });
    }
    throw error;
  }

  const detail = await getBusinessDetail(db(), id);
  return NextResponse.json(detail);
}

/** 11_Analytics_Event_Taxonomy: `admin_business_suspended` carries actor and reason. */
async function recordAdminEvent(
  businessId: string,
  name: string,
  properties: Record<string, unknown>,
): Promise<void> {
  try {
    await db()
      .insert(analyticsEvents)
      .values({
        businessId,
        eventName: name,
        properties: { ...properties, business_id: businessId },
      });
  } catch (error) {
    console.warn('[analytics] admin event failed', error);
  }
}
