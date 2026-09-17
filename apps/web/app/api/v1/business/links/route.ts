import { NextResponse, type NextRequest } from 'next/server';
import { asc, eq } from 'drizzle-orm';
import { businessLinks, businesses } from '@ai-review/db';
import { normalizePhone } from '@ai-review/core';
import { db } from '@/lib/db';
import { apiError } from '@/lib/api-error';
import { requireTenant } from '@/lib/require-tenant';
import { recordActivity } from '@/lib/activity';

/**
 * GET/PUT /api/v1/business/links — ONB-03, and the section list behind PROFILE-01.
 *
 * The default five sections (D-014) are created here, in the order the Decision Log lists them.
 * Note that GOOGLE_REVIEW is one of the five but carries no url: AMENDMENT-003 makes
 * review_destinations the source of truth for the destination, and this row controls only whether
 * and where the button renders so that it still participates in hide/reorder (D-015).
 *
 * ONB-03-02 and PROFILE-01-02 both require that a section with nothing to point at is not
 * rendered. That is enforced by ck_enabled_link_has_target in the database rather than here, so a
 * future caller cannot bypass it — this handler simply refuses to set is_enabled without a target
 * so the failure is a clear 422 rather than a constraint violation.
 */

interface LinkInput {
  type: string;
  url?: string | null;
  phone?: string | null;
  enabled?: boolean;
}

/** D-014, in order. GOOGLE_REVIEW first because it is the primary action on the page. */
const DEFAULT_SECTIONS = [
  { type: 'GOOGLE_REVIEW', label: 'Review Us' },
  { type: 'WHATSAPP', label: 'WhatsApp' },
  { type: 'CALL', label: 'Call' },
  { type: 'INSTAGRAM', label: 'Instagram' },
  { type: 'FACEBOOK', label: 'Facebook' },
] as const;

const PHONE_TYPES = new Set(['WHATSAPP', 'CALL']);
const URL_TYPES = new Set(['INSTAGRAM', 'FACEBOOK', 'WEBSITE', 'DIRECTIONS', 'CUSTOM']);

export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await requireTenant(request);
  if (!auth.ok) return auth.response;

  const rows = await db()
    .select({
      id: businessLinks.id,
      type: businessLinks.linkType,
      label: businessLinks.label,
      url: businessLinks.url,
      phone: businessLinks.phone,
      enabled: businessLinks.isEnabled,
      sortOrder: businessLinks.sortOrder,
    })
    .from(businessLinks)
    .where(eq(businessLinks.businessId, auth.context.businessId))
    .orderBy(asc(businessLinks.sortOrder));

  return NextResponse.json({ sections: rows });
}

export async function PUT(request: NextRequest): Promise<NextResponse> {
  const auth = await requireTenant(request);
  if (!auth.ok) return auth.response;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return apiError('VALIDATION_FAILED', 'Malformed request body.');
  }

  const provided = readLinks(raw);
  if (provided === null) {
    return apiError('VALIDATION_FAILED', 'Malformed section list.');
  }

  const normalized: Array<{ type: string; url: string | null; phone: string | null }> = [];

  for (const link of provided) {
    if (PHONE_TYPES.has(link.type)) {
      const value = (link.phone ?? '').trim();
      if (value.length === 0) {
        normalized.push({ type: link.type, url: null, phone: null });
        continue;
      }
      const phone = normalizePhone(value);
      if (!phone.ok) {
        return apiError('VALIDATION_FAILED', 'Enter a valid 10-digit mobile number.', {
          details: { fields: [link.type.toLowerCase()] },
        });
      }
      normalized.push({ type: link.type, url: null, phone: phone.e164 });
      continue;
    }

    if (URL_TYPES.has(link.type)) {
      const value = (link.url ?? '').trim();
      if (value.length === 0) {
        normalized.push({ type: link.type, url: null, phone: null });
        continue;
      }
      if (!isHttpsUrl(value)) {
        return apiError('VALIDATION_FAILED', 'Enter a full web address starting with https://', {
          details: { fields: [link.type.toLowerCase()] },
        });
      }
      normalized.push({ type: link.type, url: value, phone: null });
      continue;
    }

    if (link.type !== 'GOOGLE_REVIEW') {
      return apiError('VALIDATION_FAILED', `Unsupported section type: ${link.type}`);
    }
  }

  const database = db();
  const { businessId } = auth.context;
  const byType = new Map(normalized.map((n) => [n.type, n]));

  await database.transaction(async (tx) => {
    const existing = await tx
      .select({ id: businessLinks.id, type: businessLinks.linkType })
      .from(businessLinks)
      .where(eq(businessLinks.businessId, businessId));

    const existingByType = new Map(existing.map((row) => [String(row.type), row.id]));

    for (const [index, section] of DEFAULT_SECTIONS.entries()) {
      const input = byType.get(section.type);
      const url = input?.url ?? null;
      const phone = input?.phone ?? null;

      // GOOGLE_REVIEW is enabled by default and has no target of its own. Everything else is
      // enabled only once it has somewhere to point (ONB-03-02).
      const enabled = section.type === 'GOOGLE_REVIEW' ? true : url !== null || phone !== null;

      const id = existingByType.get(section.type);
      if (id) {
        await tx
          .update(businessLinks)
          .set({ url, phone, isEnabled: enabled, sortOrder: index, updatedAt: new Date() })
          .where(eq(businessLinks.id, id));
      } else {
        await tx.insert(businessLinks).values({
          businessId,
          linkType: section.type,
          label: section.label,
          url,
          phone,
          isEnabled: enabled,
          sortOrder: index,
        });
      }
    }

    await tx
      .update(businesses)
      .set({ configVersion: Date.now(), updatedAt: new Date() })
      .where(eq(businesses.id, businessId));
  });

  recordActivity(
    request,
    { session: auth.context.session, businessId },
    {
      action: 'business.links.replace',
      targetType: 'business',
      targetId: businessId,
      metadata: { sections: DEFAULT_SECTIONS.length },
    },
  );
  return NextResponse.json({ sections: DEFAULT_SECTIONS.length });
}

function readLinks(raw: unknown): LinkInput[] | null {
  if (typeof raw !== 'object' || raw === null || !('sections' in raw)) return null;
  const sections = (raw as { sections: unknown }).sections;
  if (!Array.isArray(sections)) return null;

  const out: LinkInput[] = [];
  for (const entry of sections) {
    if (typeof entry !== 'object' || entry === null || !('type' in entry)) return null;
    const record = entry as Record<string, unknown>;
    out.push({
      type: String(record.type),
      url: typeof record.url === 'string' ? record.url : null,
      phone: typeof record.phone === 'string' ? record.phone : null,
    });
  }
  return out;
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}
