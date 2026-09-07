import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { TenantGuard } from '@ai-review/core';
import { businessLinks } from '@ai-review/db';
import { db } from '@/lib/db';
import { getSession } from '@/lib/session';
import { LinksStep, type SavedContactLinks } from '@/components/onboarding/LinksStep';

/**
 * ONB-03 — `/onboarding/links`.
 *
 * A Server Component so the step opens already filled in. Every ONB screen offers "Save & exit",
 * so an owner reaching this route may well have saved links on another day or another device, and
 * a step that renders empty in that case looks as though the earlier save was lost.
 *
 * Read straight from the database rather than by calling GET /business/links from here: an
 * internal fetch would have to be given this request's cookies to pass requireTenant, for an
 * answer the same process can read directly.
 *
 * No step-order guard, for the same asymmetry ONB-02 records — an over-eager redirect makes a
 * step unreachable, while arriving early is harmless — and for one reason specific to this step:
 * `hasContactLinks` is false for an owner who legitimately used "Skip optional", so gating on
 * derived progress here would bounce them straight back out of the step they had just skipped,
 * and would break the shell's Back link from ONB-04. `/onboarding` already resumes at the
 * earliest incomplete step.
 */

export const metadata: Metadata = {
  title: 'Contact links | AI Review',
  description: 'Choose which contact and social buttons appear on your public page.',
};

/**
 * The handler stores a phone for WHATSAPP and CALL and a url for everything else, never both, so
 * one accessor covers both kinds. Absent means the section has no target yet, which is exactly
 * what an empty input represents (ONB-03-02).
 */
function targetFor(
  rows: readonly { linkType: string; url: string | null; phone: string | null }[],
  linkType: string,
): string {
  const row = rows.find((candidate) => candidate.linkType === linkType);
  return row?.phone ?? row?.url ?? '';
}

export default async function Page() {
  // The layout has already rejected an anonymous caller; this resolves the session again because
  // the tenant has to be looked up from it, and an RSC cannot be handed the layout's result.
  const session = await getSession();
  if (!session) redirect('/login');

  const database = db();
  const tenant = await new TenantGuard(database).resolveActive(session);
  if (!tenant.ok) redirect('/login');

  const rows = await database
    .select({
      linkType: businessLinks.linkType,
      url: businessLinks.url,
      phone: businessLinks.phone,
    })
    .from(businessLinks)
    .where(eq(businessLinks.businessId, tenant.businessId));

  const saved: SavedContactLinks = {
    whatsapp: targetFor(rows, 'WHATSAPP'),
    call: targetFor(rows, 'CALL'),
    instagram: targetFor(rows, 'INSTAGRAM'),
    facebook: targetFor(rows, 'FACEBOOK'),
    website: targetFor(rows, 'WEBSITE'),
  };

  return <LinksStep saved={saved} />;
}
