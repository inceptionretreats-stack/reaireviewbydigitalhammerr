import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { asc, eq } from 'drizzle-orm';
import { businesses, qrCodes } from '@ai-review/db';
import { TenantGuard, buildQrUrl } from '@ai-review/core';
import { Card } from '@ai-review/ui';
import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { getSession } from '@/lib/session';
import { MAX_SOURCES_PER_BUSINESS } from '@/app/api/v1/qr/qr-source';
import { describeBusinessStatus } from '@/components/dashboard/presentation';
import { qrDataUri } from '@/lib/qr-image';
import { QrHowItWorks } from '@/components/dashboard/qr/QrHowItWorks';
import { QrSourcesScreen } from '@/components/dashboard/qr/QrSourcesScreen';
import type { QrSource } from '@/components/dashboard/qr/qr-sources';

/**
 * QR-01 — `/app/qr`.
 *
 * A Server Component, and the list is read straight from the database rather than by calling
 * `GET /api/v1/qr` from here: an internal fetch would have to be handed this request's cookies to
 * pass `requireTenant`, for an answer the same process can read directly. The same division the
 * onboarding steps already draw.
 *
 * Everything is awaited here rather than behind a Suspense boundary, unlike DASH-01. That screen
 * splits because its slowest card holds up a page full of other content; this one *is* the list, so
 * a skeleton would flash for the length of one indexed query and leave nothing usable behind it.
 *
 * The tenant is resolved from the session, never from the request (RBAC rule 2, AC-003) — which is
 * also why there is no business id anywhere in this route's path.
 */

export const metadata: Metadata = {
  title: 'QR codes | Ai Review',
  description: 'Create, label, download and disable the dynamic QR codes you print.',
};

export default async function Page() {
  // The layout has already rejected an anonymous caller. Repeated because this page reads tenant
  // data and must not depend on a parent's guard for that; it also narrows the type.
  const session = await getSession();
  if (!session) redirect('/login');

  const database = db();
  const tenant = await new TenantGuard(database).resolveActive(session);
  if (!tenant.ok) return <NoBusinessFound />;

  const [businessRows, rows] = await Promise.all([
    database
      .select({
        name: businesses.name,
        status: businesses.status,
        timezone: businesses.timezone,
      })
      .from(businesses)
      .where(eq(businesses.id, tenant.businessId))
      .limit(1),

    database
      .select({
        id: qrCodes.id,
        code: qrCodes.code,
        sourceLabel: qrCodes.sourceLabel,
        internalNote: qrCodes.internalNote,
        status: qrCodes.status,
        createdAt: qrCodes.createdAt,
      })
      .from(qrCodes)
      .where(eq(qrCodes.businessId, tenant.businessId))
      // Oldest first, matching GET /api/v1/qr exactly: the default source created at publish
      // (ONB-05-01) stays at the top, and the order does not reshuffle under an owner who is about
      // to press Disable on a particular row. id breaks ties because rows created in one
      // transaction can share created_at to the microsecond.
      .orderBy(asc(qrCodes.createdAt), asc(qrCodes.id))
      // The same cap the list endpoint applies, imported rather than repeated so the screen and the
      // API cannot disagree about which sources exist.
      .limit(MAX_SOURCES_PER_BUSINESS),
  ]);

  const business = businessRows[0];
  if (!business) return <NoBusinessFound />;

  const baseUrl = env().APP_BASE_URL;
  const sources: QrSource[] = await Promise.all(
    rows.map(async (row) => ({
      id: row.id,
      code: row.code,
      label: row.sourceLabel,
      note: row.internalNote,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      // ADR-002, D-026: the opaque dynamic URL is what the standee encodes, resolved fresh on every
      // scan, which is what lets the destination change without a reprint (AC-017).
      resolveUrl: buildQrUrl(baseUrl, row.code),
      // Rendered here rather than in the browser: the owner should be able to see which code is
      // which without downloading each one, and the encoder is the same module the printable file
      // uses, so the thumbnail and the print are the same symbol.
      previewSrc: await qrDataUri(buildQrUrl(baseUrl, row.code)),
    })),
  );

  const status = describeBusinessStatus(business.status);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold tracking-tight text-ink">QR codes</h1>
        <p className="max-w-prose text-sm text-ink-muted">
          One source for each place you print a code, so you can tell later which one your customers
          actually use. The printed code never changes, so renaming a source or changing where your
          reviews go never means reprinting a standee.
        </p>
      </header>

      <QrSourcesScreen
        initialSources={sources}
        businessName={business.name}
        timezone={business.timezone}
        // Exactly the condition `requireActiveTenant` enforces on POST /qr and PATCH /qr/{id}, so
        // the screen offers no control the API would refuse.
        canManage={business.status === 'ACTIVE'}
        // What a scan actually does. Only an ACTIVE business is served publicly
        // (`loadPublicConfig`), so a suspended tenant's enabled codes resolve to the "not
        // available" page and the table must say so rather than promising a review page.
        isPubliclyLive={status.isPubliclyLive}
        statusNote={status.note}
        // Only a DRAFT tenant can act on this: publish is what creates the first source
        // (ONB-05-01). `/onboarding` resumes at the earliest incomplete step, so it is the right
        // destination whatever is missing. A suspended or closed tenant cannot publish its way out
        // (Flow J), so it gets the explanation without a button that would fail.
        setupPath={business.status === 'DRAFT' ? '/onboarding' : null}
      />

      <QrHowItWorks />
    </div>
  );
}

/**
 * A live session with no business behind it — a broken invariant rather than a normal state, since
 * signup creates the business in the same transaction as the user. Rendered rather than redirected
 * for the reason `DashboardOverview` gives: `/login` sends a BUSINESS_OWNER straight back to
 * `/app`, so redirecting there would bounce the browser between two routes forever.
 */
function NoBusinessFound() {
  return (
    <Card title="We could not find your business" titleAs="h2">
      <p className="text-sm text-ink-muted">
        This account is signed in but no business is attached to it, so there are no QR codes to
        show. Please contact Digital Hammerr — this is not something you can fix from this screen.
      </p>
    </Card>
  );
}
