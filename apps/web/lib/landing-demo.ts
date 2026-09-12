import { and, asc, eq } from 'drizzle-orm';
import { businessSlugs, businesses, qrCodes } from '@ai-review/db';
import { buildQrUrl } from '@ai-review/core';
import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { qrDataUri } from '@/lib/qr-image';

export interface LandingDemo {
  slug: string;
  name: string;
  code: string;
  qrDataUri: string;
}

const DEMO_SLUG = 'demo-south-cafe';

/**
 * Loads the seeded development tenant for the live, genuinely scannable marketing demo.
 * Production renders the same pages without demo-only credentials or an environment-local QR.
 */
export async function loadLandingDemo(): Promise<LandingDemo | null> {
  if (env().NODE_ENV === 'production') return null;

  try {
    const [row] = await db()
      .select({ name: businesses.name, code: qrCodes.code })
      .from(businessSlugs)
      .innerJoin(businesses, eq(businesses.id, businessSlugs.businessId))
      .innerJoin(qrCodes, eq(qrCodes.businessId, businesses.id))
      .where(
        and(
          eq(businessSlugs.slug, DEMO_SLUG),
          eq(businesses.status, 'ACTIVE'),
          eq(qrCodes.status, 'ACTIVE'),
        ),
      )
      .orderBy(asc(qrCodes.createdAt), asc(qrCodes.id))
      .limit(1);

    if (!row) return null;

    // The QR must use the same canonical, phone-reachable origin as every dashboard and download
    // producer. Rebuilding it from the incoming Host header made a landing page opened at
    // localhost mint a localhost QR even when APP_BASE_URL correctly pointed at a LAN host or
    // public tunnel. It also let an untrusted Host header decide what the printed code contained.
    const scanUrl = buildQrUrl(env().APP_BASE_URL, row.code);
    return {
      slug: DEMO_SLUG,
      name: row.name,
      code: row.code,
      qrDataUri: await qrDataUri(scanUrl),
    };
  } catch {
    return null;
  }
}
