import { NextResponse } from 'next/server';
import { desc, eq, lt } from 'drizzle-orm';
import { adminAuditLogs, businesses, users } from '@ai-review/db';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/require-admin';

export const runtime = 'nodejs';

/**
 * E12-07 audit explorer, and OPEN-03's missing `GET /admin/audit-logs`. Newest first, keyset
 * paged by id so a busy log never repeats or skips a row between pages.
 */
export async function GET(request: Request) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  const params = new URL(request.url).searchParams;
  const before = Number(params.get('before') ?? '');
  const rows = await db()
    .select({
      id: adminAuditLogs.id,
      action: adminAuditLogs.action,
      reason: adminAuditLogs.reason,
      targetType: adminAuditLogs.targetType,
      targetId: adminAuditLogs.targetId,
      before: adminAuditLogs.beforeState,
      after: adminAuditLogs.afterState,
      createdAt: adminAuditLogs.createdAt,
      actorEmail: users.email,
      businessId: adminAuditLogs.businessId,
      businessName: businesses.name,
    })
    .from(adminAuditLogs)
    .leftJoin(users, eq(users.id, adminAuditLogs.actorUserId))
    .leftJoin(businesses, eq(businesses.id, adminAuditLogs.businessId))
    .where(Number.isInteger(before) && before > 0 ? lt(adminAuditLogs.id, before) : undefined)
    .orderBy(desc(adminAuditLogs.id))
    .limit(50);

  return NextResponse.json({
    entries: rows.map((row) => ({ ...row, id: Number(row.id) })),
    next_before: rows.length === 50 ? Number(rows[rows.length - 1]!.id) : null,
  });
}
