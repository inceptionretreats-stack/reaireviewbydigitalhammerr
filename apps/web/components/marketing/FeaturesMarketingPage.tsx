import type { CSSProperties } from 'react';
import type { LandingDemo } from '@/lib/landing-demo';
import { QrStandeePreview } from '@/components/qr/QrStandeePreview';
import {
  ActionLink,
  MarketingCallToAction,
  MarketingIcon,
  MarketingShell,
  marketingStyles as styles,
} from './MarketingSite';

function DraftPreview() {
  return (
    <div className={styles.draftPreview} aria-label="Ai review draft preview">
      <div className={styles.previewTop}>
        <span>
          <MarketingIcon name="draft" size={20} /> Your review draft
        </span>
        <i>Editable</i>
      </div>
      <p>
        The team made us feel welcome, answered every question and turned a quick visit into a
        lovely experience.
      </p>
      <div className={styles.previewActions}>
        <span>
          <MarketingIcon name="edit" size={16} /> Make it yours
        </span>
        <span>
          <MarketingIcon name="copy" size={16} /> Copy when ready
        </span>
      </div>
    </div>
  );
}

function LinkPagePreview() {
  return (
    <div className={styles.linkPagePreview} aria-label="Public business link page preview">
      <span className={styles.profileAvatar}>YC</span>
      <strong>Your café</strong>
      <small>Everything customers need, in one place.</small>
      <span className={styles.profilePrimary}>Review us</span>
      <span className={styles.profileLink}>Visit our website</span>
      <span className={styles.profileLink}>Send private feedback</span>
      <em>By Digital Hammerr</em>
    </div>
  );
}

function AnalyticsPreview() {
  return (
    <div className={styles.analyticsPreview} aria-label="Review journey analytics preview">
      <div>
        <span>
          <strong>Review journey</strong>
          <small>Understand each step</small>
        </span>
        <MarketingIcon name="analytics" size={22} />
      </div>
      <ol>
        <li>
          <span>QR scans</span>
          <i style={{ '--bar': '88%' } as CSSProperties} />
        </li>
        <li>
          <span>Drafts started</span>
          <i style={{ '--bar': '72%' } as CSSProperties} />
        </li>
        <li>
          <span>Reviews copied</span>
          <i style={{ '--bar': '58%' } as CSSProperties} />
        </li>
        <li>
          <span>Google opened</span>
          <i style={{ '--bar': '49%' } as CSSProperties} />
        </li>
      </ol>
    </div>
  );
}

function FeedbackPreview() {
  return (
    <div className={styles.feedbackPreview} aria-label="Private feedback form preview">
      <span>
        <MarketingIcon name="feedback" size={23} />
      </span>
      <h3>Tell us privately</h3>
      <p>Every customer can share what could have gone better.</p>
      <i />
      <i />
      <b>Send feedback</b>
    </div>
  );
}

export function FeaturesMarketingPage({ demo }: { demo: LandingDemo | null }) {
  return (
    <MarketingShell demo={demo}>
      <section className={styles.pageHeading}>
        <div>
          <h1>Everything you need for a better review journey.</h1>
          <p>
            Colorful on the surface, careful underneath—each tool is designed around real customer
            choice.
          </p>
        </div>
        <ActionLink href="/signup">Create your account</ActionLink>
      </section>

      <section className={`${styles.featureRow} ${styles.featureRowBlue}`} data-accent="blue">
        <div className={styles.featureRowCopy}>
          <span className={styles.featureRowIcon}>
            <MarketingIcon name="qr" size={28} />
          </span>
          <h2>Print one QR. Keep improving what opens.</h2>
          <p>
            Create a source for each counter, table or campaign. The printed code never changes,
            even when your review destination does.
          </p>
          <ul>
            <li>Only your business name, QR and Digital Hammerr credit on the artwork</li>
            <li>Branded SVG and PNG downloads</li>
            <li>Separate source reporting</li>
          </ul>
        </div>
        <div className={styles.featureVisual}>
          {demo ? (
            <QrStandeePreview
              businessName={demo.name}
              qrSrc={demo.qrDataUri}
              className={styles.featureStandee}
            />
          ) : (
            <span className={styles.largeFeatureIcon}>
              <MarketingIcon name="qr" size={72} />
            </span>
          )}
        </div>
      </section>

      <section
        className={`${styles.featureRow} ${styles.featureRowRed} ${styles.featureRowReverse}`}
        data-accent="red"
      >
        <div className={styles.featureRowCopy}>
          <span className={styles.featureRowIcon}>
            <MarketingIcon name="edit" size={28} />
          </span>
          <h2>Ai gives them a start, never a script.</h2>
          <p>
            A cautious first draft is built from your business context. Every word stays editable
            before anything can be copied.
          </p>
          <ul>
            <li>Business-specific context</li>
            <li>Editable review modes</li>
            <li>Clear customer confirmation</li>
          </ul>
        </div>
        <div className={styles.featureVisual}>
          <DraftPreview />
        </div>
      </section>

      <section className={`${styles.featureRow} ${styles.featureRowYellow}`} data-accent="yellow">
        <div className={styles.featureRowCopy}>
          <span className={styles.featureRowIcon}>
            <MarketingIcon name="profile" size={28} />
          </span>
          <h2>A public page that feels like your business.</h2>
          <p>
            Put your Google review destination, useful links and private feedback together in a
            polished mobile-first page.
          </p>
          <ul>
            <li>Your business image and description</li>
            <li>Ordered social and contact links</li>
            <li>Digital Hammerr branding in the footer</li>
          </ul>
        </div>
        <div className={styles.featureVisual}>
          <LinkPagePreview />
        </div>
      </section>

      <section
        className={`${styles.featureRow} ${styles.featureRowGreen} ${styles.featureRowReverse}`}
        data-accent="green"
      >
        <div className={styles.featureRowCopy}>
          <span className={styles.featureRowIcon}>
            <MarketingIcon name="analytics" size={28} />
          </span>
          <h2>See the journey without guessing.</h2>
          <p>
            Understand scans, page views, drafts, copies and Google opens while keeping private
            feedback available to everyone.
          </p>
          <ul>
            <li>Source-by-source QR activity</li>
            <li>Clear funnel reporting</li>
            <li>Permanent private-feedback path</li>
          </ul>
        </div>
        <div className={`${styles.featureVisual} ${styles.featureVisualStack}`}>
          <AnalyticsPreview />
          <FeedbackPreview />
        </div>
      </section>

      <MarketingCallToAction
        title="Bring the whole review experience together."
        body="Start free, print your QR and shape a journey that feels like your business."
      />
    </MarketingShell>
  );
}
