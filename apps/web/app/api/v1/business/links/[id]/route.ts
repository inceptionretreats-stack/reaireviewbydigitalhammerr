import { NextResponse, type NextRequest } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { businessLinks, businesses } from '@ai-review/db';
import { normalizePhone } from '@ai-review/core';
import { db } from '@/lib/db';
import { apiError } from '@/lib/api-error';
import { readJsonObject } from '@/lib/request-body';
import { requireTenant, type AuthenticatedContext } from '@/lib/require-tenant';
import {
  SECTION_LABEL_MAX,
  hasStoredTarget,
  isDefaultSectionType,
  isSectionType,
  sectionTarget,
  type SectionType,
} from '@/components/dashboard/profile/sections';
import { recordActivity } from '@/lib/activity';

/**
 * PATCH/DELETE /api/v1/business/links/{id} — the per-section half of PROFILE-01.
 *
 * `GET/PUT /business/links` writes the whole default set at once, which is right for ONB-03 (one
 * form, five fields, one save) and wrong here: PROFILE-01 edits one section at a time, and a PUT
 * that rewrites every row also rewrites every `sort_order`, which would silently undo the ordering
 * AC-021 requires to persist.
 *
 * Three rules do the real work.
 *
 *  - AC-003. The id arrives in the URL, which is exactly the IDOR shape that criterion tests. It is
 *    never trusted: the tenant comes from the session via `requireTenant`, ownership is part of the
 *    WHERE clause rather than a check on a returned row, and "no such section" and "not yours" are
 *    reported identically so the endpoint cannot be used to enumerate another tenant's rows.
 *  - PROFILE-01-02. A section with a blank target cannot be enabled. `ck_enabled_link_has_target`
 *    enforces it in the database; this handler refuses it first so the owner reads a sentence
 *    instead of a constraint name.
 *  - AMENDMENT-003. GOOGLE_REVIEW is a presentation row: it decides whether and where the Review Us
 *    button renders (D-015) and carries no url of its own. A request that tries to set one is
 *    refused and pointed at ONB-02, which owns the destination — the single-owner property AC-017
 *    depends on.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface SectionPatch {
  label?: string;
  /** `null` clears the target. Absent leaves it alone. */
  url?: string | null;
  phone?: string | null;
  enabled?: boolean;
}

type PatchRead =
  { ok: true; patch: SectionPatch } | { ok: false; message: string; fields?: string[] };

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireTenant(request);
  if (!auth.ok) return auth.response;

  const frozen = refuseFrozenTenant(auth.context);
  if (frozen) return frozen;

  const { id } = await params;
  // Checked before the query rather than trusted into it: a non-uuid id makes Postgres raise 22P02,
  // which would surface as a 500 for what is plainly a request for something that does not exist.
  if (!UUID_PATTERN.test(id)) return notFound();

  const rawResult = await readJsonObject(request);
  if (!rawResult.ok) return rawResult.response;
  const raw = rawResult.body;

  const read = readPatch(raw);
  if (!read.ok) {
    return apiError('VALIDATION_FAILED', read.message, {
      ...(read.fields ? { details: { fields: read.fields } } : {}),
    });
  }
  const { patch } = read;

  const database = db();
  const { businessId } = auth.context;

  const [row] = await database
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
    // Ownership is in the WHERE clause, not a branch on the result, so there is no fetched-then-
    // forgotten path for a later edit to get wrong (AC-003, RBAC rule 2).
    .where(and(eq(businessLinks.id, id), eq(businessLinks.businessId, businessId)))
    .limit(1);

  if (!row) return notFound();

  // `link_type` is a Postgres enum, so this can only fail if the enum gains a member that
  // `sections.ts` has not been told about — which must not be a 500 on an owner's screen.
  if (!isSectionType(row.type)) {
    console.error('[profile-links] unknown link_type', { linkId: row.id, type: row.type });
    return apiError('INTERNAL_ERROR', 'We could not update that section. Please try again.');
  }
  const type: SectionType = row.type;

  const target = sectionTarget(type);

  if (target === 'none' && (present(patch.url) || present(patch.phone))) {
    // AMENDMENT-003 / AC-017: two writable copies of the Google URL is how "changing it changes
    // every QR's destination" silently half-works. There is one owner, and it is not this row.
    return apiError(
      'VALIDATION_FAILED',
      'The Review Us button always opens your Google review link. Change that link on your Google review link screen.',
      { details: { fields: ['url'] } },
    );
  }

  if (target === 'phone' && patch.url !== undefined) {
    return apiError(
      'VALIDATION_FAILED',
      'This button dials a number, so it takes a phone number rather than a link.',
      { details: { fields: ['url'] } },
    );
  }

  if (target === 'url' && patch.phone !== undefined) {
    return apiError(
      'VALIDATION_FAILED',
      'This button opens a link, so it takes a web address rather than a number.',
      { details: { fields: ['phone'] } },
    );
  }

  const nextUrl = patch.url !== undefined ? patch.url : row.url;
  let nextPhone = patch.phone !== undefined ? patch.phone : row.phone;

  if (target === 'url' && nextUrl !== null && patch.url !== undefined && !isHttpsUrl(nextUrl)) {
    // Same sentence the PUT handler answers with, so ONB-03 and PROFILE-01 never describe one
    // problem two ways.
    return apiError('VALIDATION_FAILED', 'Enter a full web address starting with https://', {
      details: { fields: ['url'] },
    });
  }

  if (target === 'phone' && patch.phone !== undefined && patch.phone !== null) {
    const normalized = normalizePhone(patch.phone);
    if (!normalized.ok) {
      return apiError('VALIDATION_FAILED', 'Enter a valid 10-digit mobile number.', {
        details: { fields: ['phone'] },
      });
    }
    // Stored in E.164 (D-002 is India-first, so a bare 10-digit number becomes +91…). The public
    // page needs the country code to build a wa.me link at all.
    nextPhone = normalized.e164;
  }

  const nextLabel = patch.label ?? row.label;

  let nextEnabled = patch.enabled ?? row.enabled;
  let autoDisabled = false;

  if (nextEnabled && !hasStoredTarget({ type, url: nextUrl, phone: nextPhone })) {
    if (patch.enabled === true) {
      // PROFILE-01-02, said in words. The database would refuse this too, and a constraint name is
      // not an explanation.
      return apiError(
        'VALIDATION_FAILED',
        'Add a link to this section before you show it on your page.',
        { details: { fields: ['enabled'] } },
      );
    }

    // The owner cleared the target of a section that was on. Refusing would leave them unable to
    // remove a link at all, so the section is switched off with them — which is what AC-020 means
    // for the public page anyway: with nothing to point at, the button is absent. `autoDisabled`
    // is returned so the screen can say so rather than quietly flipping a switch.
    nextEnabled = false;
    autoDisabled = true;
  }

  try {
    await database.transaction(async (tx) => {
      await tx
        .update(businessLinks)
        .set({
          label: nextLabel,
          url: nextUrl,
          phone: nextPhone,
          isEnabled: nextEnabled,
          updatedAt: new Date(),
        })
        .where(and(eq(businessLinks.id, id), eq(businessLinks.businessId, businessId)));

      await tx
        .update(businesses)
        .set({ configVersion: Date.now(), updatedAt: new Date() })
        .where(eq(businesses.id, businessId));
    });
  } catch (error) {
    // uq_business_link is (business_id, link_type, label): two sections of one type cannot share a
    // button name. Reported as what it is rather than as a 500.
    if (isUniqueViolation(error)) {
      return apiError('VALIDATION_FAILED', 'You already have a section with that button text.', {
        details: { fields: ['label'] },
      });
    }
    throw error;
  }

  recordActivity(
    request,
    { session: auth.context.session, businessId: auth.context.businessId },
    {
      action: 'business.link.update',
      targetType: 'business_link',
      targetId: id,
    },
  );
  return NextResponse.json({
    // Field names mirror GET /business/links, so the screen reads back exactly the shape it lists.
    section: {
      id: row.id,
      type,
      label: nextLabel,
      url: nextUrl,
      phone: nextPhone,
      enabled: nextEnabled,
      sortOrder: row.sortOrder,
    },
    autoDisabled,
  });
}

/**
 * DELETE removes a section the owner added; it never removes one of the D-014 five.
 *
 * PROFILE-01-01 asserts the default five *exist*, and nothing in V1 can recreate one — there is no
 * create endpoint, and ONB-03's PUT would reset every `sort_order` on its way past. So a default is
 * hidden (D-015, `is_enabled`), not deleted, and this refuses it in those words. That leaves DELETE
 * for the types the defaults do not cover — WEBSITE, DIRECTIONS, CUSTOM — which the seed and any
 * future import can create.
 *
 * Nothing in the schema references `business_links.id` by foreign key, so the row goes cleanly. The
 * one loss is historical: `profile_link_click` events carry the id in their properties rather than as
 * a reference, so DASH-01's "top link clicks" can no longer name a removed section. That is a reason
 * to prefer hiding over removing — which is what the screen offers — not a reason to keep a section
 * the owner has asked to be rid of.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireTenant(request);
  if (!auth.ok) return auth.response;

  const frozen = refuseFrozenTenant(auth.context);
  if (frozen) return frozen;

  const { id } = await params;
  if (!UUID_PATTERN.test(id)) return notFound();

  const database = db();
  const { businessId } = auth.context;

  const [row] = await database
    .select({ id: businessLinks.id, type: businessLinks.linkType })
    .from(businessLinks)
    .where(and(eq(businessLinks.id, id), eq(businessLinks.businessId, businessId)))
    .limit(1);

  if (!row) return notFound();

  if (isSectionType(row.type) && isDefaultSectionType(row.type)) {
    return apiError(
      'VALIDATION_FAILED',
      'This is one of your standard sections, so it cannot be removed. Hide it instead and it will not appear on your page.',
    );
  }

  await database.transaction(async (tx) => {
    await tx
      .delete(businessLinks)
      .where(and(eq(businessLinks.id, id), eq(businessLinks.businessId, businessId)));

    await tx
      .update(businesses)
      .set({ configVersion: Date.now(), updatedAt: new Date() })
      .where(eq(businesses.id, businessId));
  });

  // The remaining rows are deliberately not renumbered. `sort_order` is read only as a relative
  // ordering (`ORDER BY sort_order, created_at` on the public page), so a gap changes nothing an
  // owner or a visitor can observe, and a second write per delete would be for tidiness alone.
  recordActivity(
    request,
    { session: auth.context.session, businessId: auth.context.businessId },
    {
      action: 'business.link.delete',
      targetType: 'business_link',
      targetId: row.id,
    },
  );
  return NextResponse.json({ id: row.id, deleted: true });
}

/**
 * Flow J: a suspended or closed business must not edit its public page, or a suspension is
 * cosmetic.
 *
 * `requireActiveTenant` is deliberately not used: it demands ACTIVE, and a DRAFT tenant editing its
 * profile before publishing is the normal case on this screen. So the two states that must be
 * refused are named, exactly as the publish handler names them.
 */
function refuseFrozenTenant(context: AuthenticatedContext): NextResponse | null {
  if (context.status === 'SUSPENDED' || context.status === 'CLOSED') {
    return apiError('BUSINESS_NOT_ACTIVE', 'This business is not active.');
  }
  return null;
}

/**
 * RESOURCE_NOT_FOUND — "absent/inaccessible" in 23_API_Error_Codes.md — answers "no such section"
 * and "not your section" identically. That identical answer is the whole point: anything else makes
 * this endpoint an existence oracle for another tenant's row ids (AC-003).
 */
function notFound(): NextResponse {
  return apiError('RESOURCE_NOT_FOUND', 'We could not find that section.');
}

/**
 * Reads the patch, accepting only the four fields this endpoint owns.
 *
 * Unrecognised keys are ignored rather than rejected, matching the PUT handler beside it, but a body
 * carrying *nothing* recognised is an error: a typo'd field name would otherwise return 200 and the
 * screen would show a save that never happened.
 *
 * `sort_order` is not among them on purpose. Order is set by POST /business/links/reorder, which
 * writes the whole arrangement in one transaction; letting a single row's position be patched
 * independently is how two sections end up sharing a position (AC-021).
 */
function readPatch(raw: unknown): PatchRead {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, message: 'Malformed request body.' };
  }
  const body = raw as Record<string, unknown>;
  const patch: SectionPatch = {};

  if ('label' in body) {
    if (typeof body.label !== 'string') {
      return { ok: false, message: 'Give the button a name.', fields: ['label'] };
    }
    const label = body.label.trim();
    if (label.length === 0) {
      return { ok: false, message: 'Give the button a name.', fields: ['label'] };
    }
    if (label.length > SECTION_LABEL_MAX) {
      return {
        ok: false,
        message: `Keep the button text to ${SECTION_LABEL_MAX} characters or fewer.`,
        fields: ['label'],
      };
    }
    patch.label = label;
  }

  for (const key of ['url', 'phone'] as const) {
    if (!(key in body)) continue;
    const value = body[key];

    if (value === null) {
      patch[key] = null;
      continue;
    }
    if (typeof value !== 'string') {
      return { ok: false, message: 'Malformed section target.', fields: [key] };
    }

    // An empty box means "no target", stored as NULL. Storing '' instead would leave two values
    // meaning the same thing, which every predicate downstream would then have to know about.
    const trimmed = value.trim();
    patch[key] = trimmed.length === 0 ? null : trimmed;
  }

  if ('enabled' in body) {
    if (typeof body.enabled !== 'boolean') {
      return { ok: false, message: 'Malformed visibility value.', fields: ['enabled'] };
    }
    patch.enabled = body.enabled;
  }

  if (Object.keys(patch).length === 0) {
    return { ok: false, message: 'There was nothing to change in that request.' };
  }

  return { ok: true, patch };
}

/** Whether the patch is trying to *set* this target, as opposed to clearing or ignoring it. */
function present(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

/** Mirrors the PUT handler beside this one: only https is stored, so only https is accepted. */
function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

/** Postgres `unique_violation`, raised here by uq_business_link on a duplicate button text. */
function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}
