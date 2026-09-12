import { Card } from '@ai-review/ui';

/**
 * The four things an owner has to understand before QR-01's buttons make sense.
 *
 * A Server Component with no interactivity, so none of this copy reaches the browser bundle — and
 * so it stays beside the screen rather than inside the client component that manages the list.
 *
 * Each point exists because a missing explanation turns a safe action into a scary one:
 *
 * - QR-01-01, the immutable code. Renaming feels destructive if you believe the label is encoded in
 *   the standee. It is not: the code is opaque and permanent, and the label is ours alone.
 * - AC-017 and D-026, the dynamic destination. This is the whole product argument for a dynamic QR,
 *   and an owner who does not know it will reprint standees they did not need to.
 * - QR-01-02, why there is no Delete. The counter still has the standee on it, so a disabled code
 *   resolves to a controlled page (`app/r/[code]/page.tsx`) instead of a 404.
 * - QR-01-03, why the label matters. It is the attribution key in analytics later, so "Reception"
 *   and "Billing Counter" are worth the ten seconds it takes to type them.
 */
export function QrHowItWorks() {
  // A plain div rather than `as="section"`: an unnamed section is not a landmark, and Card does not
  // generate an aria-labelledby for one.
  return (
    <Card title="How your QR codes work" titleAs="h2">
      <dl className="m-0 flex flex-col gap-4">
        <div>
          <dt className="text-sm font-semibold text-ink">The printed code never changes</dt>
          <dd className="m-0 mt-1 max-w-prose text-sm text-ink-muted">
            Each source has its own permanent code. Renaming a source, changing your Google review
            link, your web address or your custom domain does not affect it — the standees you have
            already printed keep working. That is the point of a dynamic QR code.
          </dd>
        </div>

        <div>
          <dt className="text-sm font-semibold text-ink">Every code goes to your review page</dt>
          <dd className="m-0 mt-1 max-w-prose text-sm text-ink-muted">
            A scan opens your Ai review page, where the customer writes their review with a little
            help and then opens Google themselves to post it. This destination is the same for every
            QR code in this version, so there is nothing to choose here.
          </dd>
        </div>

        <div>
          <dt className="text-sm font-semibold text-ink">Disable instead of deleting</dt>
          <dd className="m-0 mt-1 max-w-prose text-sm text-ink-muted">
            There is no delete, on purpose: a standee you printed may still be sitting on a counter.
            Disabling a source shows anyone who scans it a short &ldquo;not available&rdquo; message
            instead of a broken page, and you can enable it again at any time.
          </dd>
        </div>

        <div>
          <dt className="text-sm font-semibold text-ink">Labels are what your reports read by</dt>
          <dd className="m-0 mt-1 max-w-prose text-sm text-ink-muted">
            The source label is how scans are attributed, so name each code after where it lives —
            Reception, Billing Counter, Packaging. &ldquo;QR 1&rdquo; and &ldquo;QR 2&rdquo; will
            tell you nothing in three months.
          </dd>
        </div>
      </dl>
    </Card>
  );
}
