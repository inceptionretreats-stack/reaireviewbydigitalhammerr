import { Badge, Card } from '@ai-review/ui';

/**
 * The logo, cover and brand accent PROFILE-01 lists — shown, and honestly marked as not editable yet.
 *
 * Three fields, no controls, and that is the whole point of the component. V1's route tree has no
 * upload endpoint, so a file input here could only accept a file and drop it; and nothing consumes
 * `businesses.brand_accent` — the public page renders from the shared palette in
 * `packages/ui/src/styles.css` — so a colour picker could only store a value that changes nothing a
 * visitor sees. `BusinessStep` left the logo field out of ONB-01 for exactly the first reason.
 *
 * Marked "Soon" rather than omitted, because unlike ONB-01 this screen is where an owner comes
 * looking for it: the same treatment `DashboardNav` gives a screen that does not exist yet, on the
 * grounds that a control which plainly says it is unavailable is merely unfinished, while one that
 * silently does nothing teaches an owner the product is broken. Whatever has already been uploaded is
 * rendered, so an existing logo is never hidden by the absence of a way to change it.
 */

export interface AppearanceCardProps {
  logoUrl: string | null;
  coverUrl: string | null;
  /** `businesses.brand_accent`, a 7-character hex string, or null while unset. */
  brandAccent: string | null;
}

export function AppearanceCard({ logoUrl, coverUrl, brandAccent }: AppearanceCardProps) {
  return (
    <Card
      title="Logo, cover and colour"
      titleAs="h2"
      description="What your page looks like above the buttons."
      actions={<Badge tone="neutral">Soon</Badge>}
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start gap-6">
          <div>
            <p className="text-sm font-medium text-ink">Logo</p>
            {logoUrl !== null ? (
              /*
                Plain <img> rather than next/image, for the same reason the public page uses one: the
                asset host comes from S3_PUBLIC_BASE_URL and varies per environment, and next/image
                would need a matching remotePatterns entry in a config file this module must not touch.
              */
              <img
                src={logoUrl}
                alt="Your current logo"
                width={72}
                height={72}
                className="mt-2 size-18 rounded-pill object-cover"
              />
            ) : (
              <p className="mt-2 text-sm text-ink-muted">Not added yet.</p>
            )}
          </div>

          <div className="min-w-0">
            <p className="text-sm font-medium text-ink">Cover</p>
            {coverUrl !== null ? (
              <img
                src={coverUrl}
                alt="Your current cover image"
                width={1200}
                height={400}
                className="mt-2 h-auto w-64 max-w-full rounded-control object-cover"
              />
            ) : (
              <p className="mt-2 text-sm text-ink-muted">Not added yet.</p>
            )}
          </div>

          <div>
            <p className="text-sm font-medium text-ink">Brand colour</p>
            {brandAccent !== null ? (
              <p className="mt-2 flex items-center gap-2 text-sm text-ink-muted">
                {/* The swatch is decorative: the hex value beside it is what carries the meaning. */}
                <span
                  aria-hidden="true"
                  style={{ backgroundColor: brandAccent }}
                  className="inline-block size-5 rounded-control border border-line-strong"
                />
                {brandAccent}
              </p>
            ) : (
              <p className="mt-2 text-sm text-ink-muted">Not set.</p>
            )}
          </div>
        </div>

        <p className="text-sm text-ink-muted">
          Changing these is not available yet. Your page uses the standard colours, and anything
          already uploaded is shown above.
        </p>
      </div>
    </Card>
  );
}
