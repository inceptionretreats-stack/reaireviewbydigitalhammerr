import { cache } from 'react';
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { analyticsEvents, assets, businessLinks, businesses } from '@ai-review/db';
import { normalizePhone } from '@ai-review/core';
import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { resolveBySlug } from '@/lib/public-business';
import { resolveAnonymousSession } from '@/lib/anonymous-session';
import {
  PublicProfile,
  type ProfileSection,
  type ProfileSectionType,
} from '@/components/PublicProfile';

/**
 * GET /{slug} — PUB-01, the public business trust/link page.
 *
 * No login (PUB-01-01), no star rating and no sentiment question anywhere (D-009, AC-006),
 * and private feedback offered to every visitor (D-010).
 *
 * The three UI states PUB-01 names map as follows:
 *
 *  - `live`                 — a business whose status is ACTIVE.
 *  - `business disabled`    — SUSPENDED, DRAFT or CLOSED. Flow J requires a controlled
 *                             unavailable page, not a 404: the link is on a standee or in a
 *                             WhatsApp message that someone is reading right now.
 *  - `expired policy state` — deliberately NOT a state of this page. Flow J says the profile
 *                             and its links may stay live on an expired paid plan to encourage
 *                             renewal, so nothing here consults subscription status. Only AI
 *                             generation is entitlement-gated, and that lives on REV-01.
 */

/**
 * force-dynamic, not ISR.
 *
 * AC-017 requires a changed Google review URL to take effect immediately, and the Review Us
 * button below renders from review_destinations. Any revalidate window would keep sending real
 * customers to the old destination for its duration. AC-033's LCP target is met instead by
 * server-rendering the whole page, fetching nothing from the browser, and keeping the client
 * bundle down to a single click handler.
 *
 * The documented next step for AC-033 is a CDN cache keyed on businesses.config_version — the
 * column exists for exactly this — purged on profile write, which buys caching without the
 * staleness window. That belongs with the profile-editing endpoints (PROFILE-01).
 */
export const dynamic = 'force-dynamic';

interface ProfileContent {
  businessId: string;
  slug: string;
  name: string;
  description: string | null;
  logoUrl: string | null;
  coverUrl: string | null;
  sections: ProfileSection[];
}

type PageState =
  | { kind: 'live'; content: ProfileContent }
  | { kind: 'redirect'; to: string }
  | { kind: 'unavailable' }
  | { kind: 'missing' };

/**
 * Cached for the lifetime of one request so generateMetadata and the render share a single set
 * of queries instead of doubling them (AC-033).
 */
const loadPage = cache(async (slug: string): Promise<PageState> => {
  const database = db();
  const resolution = await resolveBySlug(database, slug);

  if (!resolution.ok) {
    // Flow J: a suspended or unpublished tenant is a controlled state, not a 404.
    return resolution.reason === 'BUSINESS_NOT_ACTIVE'
      ? { kind: 'unavailable' }
      : { kind: 'missing' };
  }

  // Flow I: a retired slug keeps working as a redirect for its retention window.
  if (!('config' in resolution)) return { kind: 'redirect', to: resolution.redirectTo };

  const { config } = resolution;

  // resolveBySlug answers "which tenant, and is it reachable". It does not carry the
  // presentation fields PUB-01 renders, so two more queries run together here: the identity
  // row with its logo and cover, and the enabled sections.
  const logo = alias(assets, 'logo_asset');
  const cover = alias(assets, 'cover_asset');

  const [identity, links] = await Promise.all([
    database
      .select({
        description: businesses.description,
        logoStorageKey: logo.storageKey,
        coverStorageKey: cover.storageKey,
      })
      .from(businesses)
      // A soft-deleted asset must not leave a broken image on a live profile, so the join
      // itself excludes it rather than the render.
      .leftJoin(logo, and(eq(logo.id, businesses.logoAssetId), isNull(logo.deletedAt)))
      .leftJoin(cover, and(eq(cover.id, businesses.coverAssetId), isNull(cover.deletedAt)))
      .where(eq(businesses.id, config.businessId))
      .limit(1),

    // AC-020, first of two gates: disabled sections are excluded in SQL, so they are never
    // loaded, never serialized into the RSC payload and never present in the HTML.
    database
      .select({
        id: businessLinks.id,
        linkType: businessLinks.linkType,
        label: businessLinks.label,
        url: businessLinks.url,
        phone: businessLinks.phone,
      })
      .from(businessLinks)
      .where(
        and(eq(businessLinks.businessId, config.businessId), eq(businessLinks.isEnabled, true)),
      )
      // D-015: stored order is the owner's order. createdAt breaks ties so two sections
      // sharing a sort_order cannot swap places between renders (AC-021).
      .orderBy(asc(businessLinks.sortOrder), asc(businessLinks.createdAt)),
  ]);

  const identityRow = identity[0];

  return {
    kind: 'live',
    content: {
      businessId: config.businessId,
      // The slug this page was reached by. config.slug is nullable for a QR-resolved tenant;
      // here it cannot be, because the lookup used it.
      slug,
      name: config.name,
      description: identityRow?.description ?? null,
      logoUrl: assetUrl(identityRow?.logoStorageKey ?? null),
      coverUrl: assetUrl(identityRow?.coverStorageKey ?? null),
      // AC-020, second gate: a section whose target does not resolve is dropped here, on the
      // server, so "enabled but blank" ends up as absent as "disabled".
      sections: links
        .map((link) => resolveSection(link, config.reviewUrl))
        .filter((section): section is ProfileSection => section !== null),
    },
  };
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const state = await loadPage(slug);
  if (state.kind !== 'live') return { title: 'Business page' };

  return {
    title: state.content.name,
    ...(state.content.description ? { description: state.content.description } : {}),
  };
}

export default async function PublicProfilePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const state = await loadPage(slug);

  if (state.kind === 'missing') notFound();
  if (state.kind === 'redirect') redirect(state.to);
  if (state.kind === 'unavailable') return <UnavailablePage />;

  const { content } = state;
  await recordProfileView(content.businessId);

  return (
    <main className="shell">
      <PublicProfile
        slug={content.slug}
        name={content.name}
        description={content.description}
        logoUrl={content.logoUrl}
        coverUrl={content.coverUrl}
        sections={content.sections}
      />
    </main>
  );
}

function UnavailablePage() {
  return (
    <main className="shell">
      <div className="notice">
        <p>This business page is not available at the moment.</p>
        <p className="muted">Please ask the business for an up-to-date link.</p>
      </div>
    </main>
  );
}

/**
 * Builds one renderable section, or null when it cannot be rendered.
 *
 * Returning null rather than a disabled-looking button is the whole of AC-020: the section
 * does not exist in the output at all.
 */
function resolveSection(
  link: {
    id: string;
    linkType: ProfileSectionType;
    label: string;
    url: string | null;
    phone: string | null;
  },
  reviewUrl: string | null,
): ProfileSection | null {
  const target = resolveTarget(link, reviewUrl);
  if (!target) return null;

  return { id: link.id, type: link.linkType, label: link.label, ...target };
}

function resolveTarget(
  link: { linkType: ProfileSectionType; url: string | null; phone: string | null },
  reviewUrl: string | null,
): { href: string; opensInNewTab: boolean } | null {
  switch (link.linkType) {
    case 'GOOGLE_REVIEW': {
      // AMENDMENT-003: the business_links row is presentation only — it decides whether and
      // where the button renders and carries no url of its own (ck_google_review_has_no_url).
      // The destination comes from review_destinations, which is why changing it there takes
      // effect on every surface at once (AC-017).
      const href = externalHref(reviewUrl);
      return href ? { href, opensInNewTab: true } : null;
    }

    case 'CALL': {
      const href = telHref(link.phone);
      return href ? { href, opensInNewTab: false } : null;
    }

    case 'WHATSAPP': {
      // Prefer the stored number: wa.me needs a country code, and normalizePhone is what
      // supplies +91 for the bare 10-digit numbers Indian owners actually type (D-002). A
      // pasted wa.me or chat link is accepted as a fallback.
      const href = whatsAppHref(link.phone) ?? externalHref(link.url);
      return href ? { href, opensInNewTab: true } : null;
    }

    case 'INSTAGRAM':
    case 'FACEBOOK':
    case 'WEBSITE':
    case 'DIRECTIONS':
    case 'CUSTOM': {
      const href = externalHref(link.url);
      return href ? { href, opensInNewTab: true } : null;
    }
  }
}

/**
 * Only http(s) survives.
 *
 * The stored url is owner-supplied text, and this page renders it into an href that every one
 * of that tenant's visitors can click. Without a scheme check, a `javascript:` value written by
 * a compromised owner account — or by a future admin or import path that skips
 * validateGoogleReviewUrl — becomes stored XSS on a public page.
 * 13_Security_Privacy_Compliance.md puts server-side input validation on the security baseline;
 * this is the render-time half of it.
 */
function externalHref(raw: string | null): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function telHref(phone: string | null): string | null {
  const trimmed = phone?.trim();
  if (!trimmed) return null;

  const normalized = normalizePhone(trimmed);
  if (normalized.ok) return `tel:${normalized.e164}`;

  // A number that fails normalization may still be dialable — a landline, or a foreign format
  // the India-first validator does not model — so it is passed through with everything but
  // digits and a single leading + stripped, which is all this tel: URI may carry.
  const digits = trimmed.replace(/[^\d+]/g, '').replace(/(?!^)\+/g, '');
  return digits.replace(/\D/g, '').length >= 6 ? `tel:${digits}` : null;
}

function whatsAppHref(phone: string | null): string | null {
  const trimmed = phone?.trim();
  if (!trimmed) return null;

  // wa.me needs an unambiguous country code, so an un-normalizable number is dropped rather
  // than guessed at: a wrong guess opens a stranger's chat.
  const normalized = normalizePhone(trimmed);
  if (!normalized.ok) return null;

  // No prefilled text. buildWhatsAppLink exists for the owner's outbound request messages
  // (REQ-01), where the platform composes the wording; a customer contacting a business
  // writes their own.
  return `https://wa.me/${normalized.e164.replace(/\D/g, '')}`;
}

function assetUrl(storageKey: string | null): string | null {
  const base = env().S3_PUBLIC_BASE_URL;
  if (!base || !storageKey) return null;
  return `${base.replace(/\/+$/, '')}/${storageKey.replace(/^\/+/, '')}`;
}

/**
 * profile_view, emitted server-side so it is recorded even with JavaScript disabled — matching
 * how the QR landing page records qr_scan and review_page_view.
 *
 * AC-035: a failure here never affects the page. The event is skipped entirely when there is no
 * anonymous session, because anonymous_session_id is a required property of profile_view in the
 * taxonomy and a row without it would be off-contract.
 */
async function recordProfileView(businessId: string): Promise<void> {
  try {
    const headerList = await headers();
    const session = await resolveAnonymousSession(
      new Request('https://internal', { headers: headerList }),
      businessId,
    );
    if (!session) return;

    await db()
      .insert(analyticsEvents)
      .values({
        businessId,
        anonymousSessionId: session.sessionId,
        eventName: 'profile_view',
        properties: { business_id: businessId, anonymous_session_id: session.sessionId },
      });
  } catch (error) {
    console.warn('[analytics] profile_view failed', error);
  }
}
