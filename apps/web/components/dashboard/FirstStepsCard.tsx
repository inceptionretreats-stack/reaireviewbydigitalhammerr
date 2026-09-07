import { Card } from '@ai-review/ui';

/**
 * What to do once the page is live and before the first scan arrives.
 *
 * Publishing is where a self-service setup usually stops helping: everything on the dashboard
 * turns green, and the owner is left holding a working product that no customer has met, because
 * the one remaining task happens away from the screen. This card names that task.
 *
 * It retires itself on the first `qr_scan`, so it is guidance rather than furniture — an owner who
 * has printed the code and put it out never sees it again, and nobody has to dismiss anything.
 *
 * There is deliberately no "open your review page" link here. Following it from the dashboard
 * would record a scan against a source the owner is only inspecting, inflating the very
 * attribution QR-01-03 exists to make readable — the same reason QR-01 prints the resolve URL as
 * text rather than as a link. Testing is done with a phone, on the printed artwork, which is also
 * the only way to test the thing that actually fails: a code that will not scan off paper.
 */
export function FirstStepsCard({
  qrPreviewSrc,
  qrCode,
  qrDownloadId,
}: {
  qrPreviewSrc: string | null;
  qrCode: string | null;
  qrDownloadId: string | null;
}) {
  return (
    <Card
      title="Your page is live. One thing left."
      titleAs="h2"
      description="Nothing reaches you until a customer can scan your code, and that part happens off this screen."
    >
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
        {qrPreviewSrc && (
          /* White plate in both themes: the symbol is black on opaque white for the scanner, so a
             dark background behind the quiet zone would undo the margin it relies on. */
          <img
            src={qrPreviewSrc}
            alt={qrCode ? `QR code ${qrCode}` : 'Your QR code'}
            width={128}
            height={128}
            className="mx-auto block size-32 shrink-0 rounded-card bg-white p-2 sm:mx-0"
          />
        )}

        <ol className="m-0 flex list-none flex-col gap-4 p-0">
          <Step number={1} title="Print it and put it where people pay">
            The counter, the table, the back of the bill. Somewhere a customer is already standing
            still with a phone in their hand.
          </Step>

          <Step number={2} title="Scan it yourself, from the print">
            Use your own phone on the printed copy, not the screen. A code that looks right can
            still fail on paper if it is too small or too glossy.
          </Step>

          <Step number={3} title="Then leave it alone">
            Reviews come from real visits, so there is nothing here to tend daily. Come back when
            you want to change where reviews go or how the drafts read.
          </Step>
        </ol>
      </div>

      {qrDownloadId && (
        <p className="mt-5 mb-0 text-sm text-ink-muted">
          Your code is on the{' '}
          <a href="/app/qr" className="font-medium text-accent">
            QR codes
          </a>{' '}
          screen, where the SVG is the one to send to a printer.
        </p>
      )}
    </Card>
  );
}

function Step({
  number,
  title,
  children,
}: {
  number: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex gap-3">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-sm font-semibold text-accent">
        {number}
      </span>
      <span className="flex flex-col gap-0.5">
        <span className="font-semibold text-ink">{title}</span>
        <span className="text-sm text-ink-muted">{children}</span>
      </span>
    </li>
  );
}
