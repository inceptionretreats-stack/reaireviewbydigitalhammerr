import type { Metadata } from 'next';
import Link from 'next/link';
import {
  PublicContactLink,
  PublicInformationPage,
} from '@/components/marketing/legal/PublicInformationPage';
import { PUBLIC_CONTACT } from '@/lib/marketing/public-information';

export const metadata: Metadata = {
  title: 'Contact | Ai Review by Digital Hammerr',
  description: 'Contact Digital Hammerr about Ai Review, billing, privacy or account access.',
};

export default function ContactPage() {
  return (
    <PublicInformationPage
      title="Contact us"
      intro="Questions about your QR, account or plan? You can contact Digital Hammerr without signing in."
      path="/legal/contact"
    >
      <section>
        <h2>Talk to Digital Hammerr</h2>
        <address>
          <p>
            Email: <PublicContactLink />
          </p>
          <p>
            Phone: <a href={PUBLIC_CONTACT.phoneHref}>{PUBLIC_CONTACT.phone}</a>
          </p>
        </address>
        <p>
          These are the contact details published on{' '}
          <a href={PUBLIC_CONTACT.website}>Digital Hammerr’s website</a>. Email opens your mail app;
          it does not submit a ticket automatically.
        </p>
      </section>
      <section>
        <h2>Help us find the issue</h2>
        <p>
          Include “Ai Review” in your subject, your business name or public QR-page link, and a
          short explanation. For a billing question, include the order or payment reference and
          approximate payment date.
        </p>
        <p>
          Do not send passwords, one-time codes, full card details or unnecessary customer
          information. Redact personal details from screenshots.
        </p>
      </section>
      <section>
        <h2>Privacy and account requests</h2>
        <p>
          Email us to ask about access, correction, export or deletion of data, or to raise a
          privacy concern. Include enough information to identify the relevant account or business.
          Identity or authority may need to be checked before a request can be actioned.
        </p>
        <p>
          For feedback sent to an individual business through its QR page, identify that business in
          your message. Private feedback is not a support ticket to Digital Hammerr.
        </p>
      </section>
      <section>
        <h2>Before you pay</h2>
        <p>
          Read the <Link href="/#pricing">plan details</Link> and{' '}
          <Link href="/legal/cancellation-refunds">cancellation and refund information</Link>. Ask
          us to confirm any refund eligibility, tax detail or billing term that is unclear before
          making a purchase.
        </p>
      </section>
    </PublicInformationPage>
  );
}
