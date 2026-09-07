import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { and, asc, eq } from 'drizzle-orm';
import * as QRCode from 'qrcode';
import { businessSlugs, businesses, qrCodes } from '@ai-review/db';
import { db } from '@/lib/db';
import { env } from '@/lib/env';

/**
 * `/` — the front door for a business owner.
 *
 * Customers never arrive here. They arrive at `/r/{code}` from a printed QR, so this page is
 * written for the person deciding whether to put that QR on their counter. It says what the
 * product does, and — just as deliberately — where it stops, because "we do not post for you and
 * we never ask for a star rating" is the difference between this and a review-gating tool that
 * gets a Google Business Profile restricted.
 *
 * No rating control, no radio group and no star glyph appears below, for the same reason they
 * appear nowhere else in the product (D-009, AC-006). The compliance E2E sweeps rendered HTML,
 * and this page is part of that surface.
 */

export const runtime = 'nodejs';

/**
 * force-dynamic because the demo panel reads the seeded tenant and builds its QR from the
 * request's own host. Nothing here is worth caching: production renders the static half only.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'AI Review by Digital Hammerr',
  description:
    'Turn a QR scan into a review your customer writes, confirms and posts themselves on Google.',
};

/** Matches the tenant created by `pnpm seed` (scripts/seed.ts). */
const DEMO_SLUG = 'demo-south-cafe';

interface DemoTenant {
  slug: string;
  name: string;
  code: string;
  qrDataUri: string;
  scanUrl: string;
  /**
   * Whether the visitor is on this machine.
   *
   * The demo sign-in details are only printed when they are. The block below exists for a
   * developer looking at their own dev server, but the moment that server is put behind a tunnel
   * — which is now the supported way to make a QR scannable — the same page hands the demo
   * owner's dashboard to anyone holding the link. Not production-only, because production is not
   * the boundary that matters here; reachability is.
   */
  isLocalVisitor: boolean;
}

/**
 * The seeded tenant, or null when it is absent — a fresh clone that has not run `pnpm seed` gets
 * the product page without a broken demo block dangling off the bottom of it.
 *
 * The QR encodes the *request's* origin rather than APP_BASE_URL, which is the one place this
 * page deviates from how a real QR is minted. A printed code must carry the canonical hostname;
 * this one exists so that a phone on the same network can scan the screen and land somewhere that
 * answers, which `http://localhost:3000` never would.
 */
async function loadDemoTenant(): Promise<DemoTenant | null> {
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

    const requestHeaders = await headers();
    const host = requestHeaders.get('host') ?? new URL(env().APP_BASE_URL).host;
    const hostname = host.split(':')[0] ?? '';
    const isLocalVisitor =
      hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
    const protocol = requestHeaders.get('x-forwarded-proto') ?? 'http';
    const scanUrl = `${protocol}://${host}/r/${row.code}`;

    // Error-correction H and a four-module quiet zone, the same values the printable download
    // uses, so what is scanned off the screen behaves like what comes off the printer.
    const svg = await QRCode.toString(scanUrl, {
      type: 'svg',
      errorCorrectionLevel: 'H',
      margin: 4,
      width: 240,
      color: { dark: '#000000', light: '#ffffff' },
    });

    return {
      slug: DEMO_SLUG,
      name: row.name,
      code: row.code,
      qrDataUri: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`,
      scanUrl,
      isLocalVisitor,
    };
  } catch {
    // A landing page that 500s because the development database is not running is worse than one
    // that renders without its demo block. Production never reaches this path.
    return null;
  }
}

const CUSTOMER_STEPS = [
  {
    title: 'They scan the code',
    body: 'On a standee, a receipt or a table card. No app to install, no account to make, no form to fill in first.',
  },
  {
    title: 'A draft appears, and it is theirs to change',
    body: 'Built from your business details and the review mode you picked. They can rewrite any part of it, or ask for a different draft.',
  },
  {
    title: 'They confirm, copy, and post it on Google',
    body: 'Copy stays locked until they confirm they actually visited. Then Google opens and they post it in their own account.',
  },
] as const;

const BOUNDARIES = [
  {
    title: 'We never post on a customer’s behalf',
    body: 'The person who visited copies the text and posts it themselves. We open the Google review page — everything after that belongs to them and their account.',
  },
  {
    title: 'We never ask for a star rating',
    body: 'There is no rating control anywhere in this product. Rating happens on Google, where it counts, and not in a step that could quietly filter who gets asked.',
  },
  {
    title: 'We never claim a review was submitted',
    body: 'We cannot see Google, so we do not pretend to. Your analytics report that the review page was opened, which is the last thing we can honestly observe.',
  },
  {
    title: 'A draft is a starting point, not a script',
    body: 'The terms you add are hints for tone and context. Nothing obliges a customer to keep a single word of them, and a draft they disagree with is one they should rewrite.',
  },
] as const;

const BUSINESS_FEATURES = [
  {
    title: 'Print the QR once',
    body: 'The code points at us, not at Google. Change your review link, your profile buttons or your AI context whenever you like and every printed code follows along.',
  },
  {
    title: 'A public page that is yours',
    body: 'Your logo, your description and your links — Google, WhatsApp, Call, Instagram, Facebook — reordered or hidden as you please.',
  },
  {
    title: 'The whole funnel, not a vanity number',
    body: 'Scans, page views, drafts, copies and Google opens. When people stop, you can see exactly where.',
  },
  {
    title: 'Unhappy customers get a private door',
    body: 'Private feedback is offered to every visitor and lands in your inbox, so a bad visit reaches you instead of a public page.',
  },
] as const;

function SectionHeading({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="mb-8 flex flex-col gap-2">
      <p className="m-0 text-xs font-semibold tracking-widest text-accent uppercase">{eyebrow}</p>
      <h2 className="m-0 text-2xl font-semibold text-balance sm:text-3xl">{title}</h2>
    </div>
  );
}

/**
 * The demo QR, sitting in the first screenful rather than at the foot of the page.
 *
 * A product whose whole premise is "scan this" should show the thing being scanned before it
 * explains itself. Rendered only when the seeded tenant exists, so production gets a single-column
 * hero instead of a mock code that leads nowhere.
 */
function DemoStandee({ demo }: { demo: DemoTenant }) {
  return (
    <aside className="w-full rounded-2xl border border-line bg-surface p-5 lg:w-80">
      <p className="m-0 text-xs font-semibold tracking-widest text-accent uppercase">
        Live on this machine
      </p>
      <p className="mt-1 mb-4 text-sm text-ink-muted">Seeded tenant — {demo.name}</p>
      {/* A generated data URI, so there is nothing for next/image to fetch or optimise. */}
      <img
        src={demo.qrDataUri}
        alt={`QR code opening the review page for ${demo.name}`}
        width={240}
        height={240}
        className="mx-auto block w-full max-w-56 rounded-lg bg-white"
      />
      <p className="mt-4 mb-0 text-center text-sm text-ink-muted">
        Scan it from a phone on this network, or{' '}
        <a href={`/r/${demo.code}`} className="font-medium text-accent">
          open it here
        </a>
        .
      </p>
      <p className="mt-2 mb-0 text-center text-xs break-all text-ink-faint">{demo.scanUrl}</p>
    </aside>
  );
}

export default async function HomePage() {
  const demo = await loadDemoTenant();

  return (
    <div className="min-h-screen bg-bg text-ink">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-5 py-4">
          <div className="flex flex-col">
            <span className="text-base font-semibold">AI Review</span>
            <span className="text-xs text-ink-muted">by Digital Hammerr</span>
          </div>
          <nav className="flex items-center gap-2">
            <a
              href="/login"
              className="inline-flex min-h-11 items-center rounded-lg px-4 font-medium text-ink no-underline hover:bg-surface"
            >
              Sign in
            </a>
            <a
              href="/signup"
              className="inline-flex min-h-11 items-center rounded-lg bg-accent px-4 font-semibold text-on-accent no-underline"
            >
              Create account
            </a>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-5">
        <section className="grid items-center gap-10 py-14 sm:py-20 lg:grid-cols-[1fr_auto]">
          <div className="max-w-2xl">
            <h1 className="m-0 text-3xl leading-tight font-semibold text-balance sm:text-4xl">
              Your customers would leave a review. Writing one is the part they skip.
            </h1>
            <p className="mt-5 mb-0 text-lg text-ink-muted">
              AI Review turns a scan of the code on your counter into a draft in your customer’s
              hands. They edit it, confirm the visit was real, copy it, and post it themselves on
              Google.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a
                href="/signup"
                className="inline-flex min-h-12 items-center rounded-lg bg-accent px-6 font-semibold text-on-accent no-underline"
              >
                Create your account
              </a>
              <a
                href="/login"
                className="inline-flex min-h-12 items-center rounded-lg border border-line-strong px-6 font-semibold text-ink no-underline"
              >
                Sign in
              </a>
            </div>
            <p className="mt-4 mb-0 text-sm text-ink-muted">
              Ten free drafts to start, no card. Most businesses are live in about five minutes.
            </p>
          </div>
          {demo ? <DemoStandee demo={demo} /> : null}
        </section>

        {demo ? (
          <section className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-line py-6 text-sm">
            <span className="font-semibold">Walk the same path in this browser:</span>
            <a href={`/r/${demo.code}`} className="font-medium text-accent">
              The review page →
            </a>
            <a href={`/${demo.slug}`} className="font-medium text-accent">
              The public profile →
            </a>
            <a href="/login" className="font-medium text-accent">
              The dashboard →
            </a>
            {/* Printed only to a visitor on this machine — see DemoTenant.isLocalVisitor. Behind
                a tunnel this page is public, and these credentials open the demo dashboard to
                anyone holding the link. `pnpm seed` prints them to the terminal, which is where
                whoever is running the server can read them. */}
            {demo.isLocalVisitor && (
              <span className="text-ink-muted">demo-owner@example.com / demo-owner-Password1!</span>
            )}
          </section>
        ) : null}

        <section className="border-t border-line py-14">
          <SectionHeading eyebrow="The customer" title="Three taps, and none of them are yours" />
          <ol className="m-0 grid list-none gap-4 p-0 md:grid-cols-3">
            {CUSTOMER_STEPS.map((step, index) => (
              <li key={step.title} className="rounded-xl border border-line bg-surface p-5">
                <span className="inline-flex size-8 items-center justify-center rounded-full bg-accent-soft text-sm font-semibold text-accent">
                  {index + 1}
                </span>
                <h3 className="mt-4 mb-2 text-base font-semibold">{step.title}</h3>
                <p className="m-0 text-sm text-ink-muted">{step.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="border-t border-line py-14">
          <SectionHeading eyebrow="The limits" title="Where this product stops, on purpose" />
          <p className="mt-0 mb-8 max-w-2xl text-ink-muted">
            Google restricts business profiles that solicit reviews the wrong way. Every rule below
            is built into the product rather than left to your good judgement.
          </p>
          <div className="grid gap-4 md:grid-cols-2">
            {BOUNDARIES.map((item) => (
              <div key={item.title} className="rounded-xl border border-line p-5">
                <h3 className="mt-0 mb-2 text-base font-semibold">{item.title}</h3>
                <p className="m-0 text-sm text-ink-muted">{item.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="border-t border-line py-14">
          <SectionHeading eyebrow="Your side" title="What you get for the counter space" />
          <div className="grid gap-4 md:grid-cols-2">
            {BUSINESS_FEATURES.map((item) => (
              <div key={item.title} className="rounded-xl border border-line bg-surface p-5">
                <h3 className="mt-0 mb-2 text-base font-semibold">{item.title}</h3>
                <p className="m-0 text-sm text-ink-muted">{item.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="border-t border-line py-14">
          <SectionHeading
            eyebrow="Pricing"
            title="One plan, and a free tier that is actually usable"
          />
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-xl border border-line p-6">
              <h3 className="mt-0 mb-1 text-base font-semibold">Free</h3>
              <p className="m-0 text-3xl font-semibold">₹0</p>
              <p className="mt-3 mb-0 text-sm text-ink-muted">
                Ten AI drafts for the lifetime of the account. Your QR, your public page, your
                analytics and private feedback all work exactly as they do on the paid plan.
              </p>
            </div>
            <div className="rounded-xl border-2 border-accent p-6">
              <h3 className="mt-0 mb-1 text-base font-semibold">Pro</h3>
              <p className="m-0 text-3xl font-semibold">
                ₹999
                <span className="text-base font-normal text-ink-muted"> / year</span>
              </p>
              <p className="mt-3 mb-0 text-sm text-ink-muted">
                Unlimited drafts under fair use, and every feature in the product. One price, billed
                once a year, with nothing held back for a higher tier.
              </p>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-5xl flex-col gap-1 px-5 py-8 text-sm text-ink-muted">
          <p className="m-0">AI Review by Digital Hammerr — review.digitalhammerr.com</p>
          {demo ? (
            <p className="m-0">
              Development build. Drafts on this instance come from a deterministic stub, not a live
              model, so the same wording repeats.
            </p>
          ) : null}
        </div>
      </footer>
    </div>
  );
}
