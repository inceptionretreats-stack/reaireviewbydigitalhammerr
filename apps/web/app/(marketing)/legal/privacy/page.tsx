import type { Metadata } from 'next';
import Link from 'next/link';
import {
  PublicContactLink,
  PublicInformationPage,
} from '@/components/marketing/legal/PublicInformationPage';

export const metadata: Metadata = {
  title: 'Privacy Policy | Ai Review by Digital Hammerr',
  description:
    'What Ai Review handles, how drafting and activity tracking work, and how to contact us about your data.',
};

export default function PrivacyPage() {
  return (
    <PublicInformationPage
      title="Privacy Policy"
      intro="This notice covers the Ai Review application operated by Digital Hammerr. It explains the information used for business accounts and the customer review journey."
      path="/legal/privacy"
    >
      <section>
        <h2>Information the application handles</h2>
        <ul>
          <li>
            <strong>Account information:</strong> your name, email, mobile number, password hash
            when you set a password, session information and account-security activity. If you
            choose Google sign-in, we also store Google’s stable account identifier to recognize
            your account on future sign-ins.
          </li>
          <li>
            <strong>Business information:</strong> profile details, location, branding, public
            links, Google review destination, Ai context and billing information you provide.
          </li>
          <li>
            <strong>Customer records:</strong> names, phone numbers, optional email and notes
            entered by a business, along with its review-request messages and activity.
          </li>
          <li>
            <strong>Private feedback:</strong> a message and any optional name or mobile number the
            customer supplies. This is shared with the relevant business, not published as a Google
            review.
          </li>
          <li>
            <strong>Drafts and usage:</strong> original generated draft text, model and generation
            references, usage counts, payment references, invoice details and review-journey events.
          </li>
        </ul>
      </section>
      <section>
        <h2>Why this information is used</h2>
        <p>
          The application uses this information to create and secure accounts, display business
          pages, generate drafts, route private feedback, manage plan allowances and payments, and
          show activity to the relevant business. Session and technical information also support
          abuse prevention and troubleshooting.
        </p>
        <p>
          Continue with Google confirms a vendor’s identity; it does not give this application
          access to their Google Business Profile or automatically import a review destination.
          Business details and the Google review link are still provided during setup.
        </p>
        <p>
          Activity includes QR-page visits, draft generation, editing, copying and opening a review
          destination. Review-request links can associate click activity with a customer record held
          by the business. A Google-link click is not confirmation that a review was published.
        </p>
      </section>
      <section>
        <h2>Ai drafting and your words</h2>
        <p>
          To generate a draft, the configured Ai provider receives business context, the selected
          review mode and language, generation instructions and up to three earlier generated
          drafts. Business descriptions and other free-text fields may contain personal information
          if someone enters it there. Do not include secrets or unnecessary sensitive information.
        </p>
        <p>
          The generation request does not deliberately include account credentials, customer contact
          lists or private feedback. The service stores original generated drafts and generation
          metadata. Edits made in the customer review editor stay in that page’s browser memory;
          edit and copy events record activity, not the edited wording. Refreshing or leaving the
          page can lose those unsaved edits.
        </p>
        <p>
          Ai providers supported by the application include Anthropic, OpenAI and Google Gemini; the
          active provider depends on service configuration. Contact us if you need the current
          provider or processing details. We do not make a blanket promise that third-party
          providers never retain data or use it for training.
        </p>
      </section>
      <section>
        <h2>Cookies and technical information</h2>
        <p>
          The public visitor cookie, <code>dh_anon</code>, normally lasts 30 days. Account sessions
          normally last 30 days, or 90 days when “Keep me signed in” is selected. Administrator
          access uses shorter sessions. Cookies help identify sessions without placing the account
          password in the cookie.
        </p>
        <p>
          The application stores session identifiers, browser information and privacy-preserving
          hashes of certain network information. Hosting infrastructure may also maintain technical
          logs. This is pseudonymous activity tracking, not a promise that every visit is
          unidentifiable.
        </p>
        <p>
          You can clear or block cookies in your browser, but signing in and remembering a review
          session may then stop working. Cookie expiry does not automatically erase all associated
          records.
        </p>
      </section>
      <section>
        <h2>Service providers and external destinations</h2>
        <p>
          Hosting, database, file storage and security services process the information needed to
          operate the application. The configured email service handles transactional messages.
          Payments use Razorpay; the application keeps payment references, statuses and invoice
          information rather than card-number or CVV fields in its checkout flow.
        </p>
        <p>
          When you open Google or another external business link, that service handles your
          subsequent activity under its own policies. Posting to Google is your choice. Private
          feedback goes to the business you selected; it is not a message to Digital Hammerr
          support.
        </p>
      </section>
      <section>
        <h2>Retention and deletion</h2>
        <p>
          Retention varies by record type and the purpose for which it is held. Removing a record
          from the interface may not immediately erase it from the underlying systems. Account
          closure, cookie expiry and plan expiry are different from data deletion.
        </p>
        <p>
          There is no universal automatic-deletion deadline for saved drafts, feedback or customer
          records stated here. Contact us for the applicable retention and deletion process. Some
          payment, accounting or security records may need to be retained; do not assume that a
          request immediately removes every record or backup.
        </p>
      </section>
      <section>
        <h2>Your questions and requests</h2>
        <p>
          Contact <PublicContactLink /> to ask about access, correction, export or deletion, the
          current service providers, or a privacy concern. Identify the relevant account or business
          without sending passwords or unnecessary personal data. Authority or identity may need to
          be verified before information can be disclosed or changed.
        </p>
        <p>
          Contact details are also available on our <Link href="/legal/contact">Contact page</Link>.
          If a business entered your customer information or received your private feedback, tell us
          which business so your request can be directed appropriately.
        </p>
      </section>
    </PublicInformationPage>
  );
}
