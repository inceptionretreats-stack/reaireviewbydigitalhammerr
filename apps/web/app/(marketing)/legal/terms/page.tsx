import type { Metadata } from 'next';
import Link from 'next/link';
import {
  PublicContactLink,
  PublicInformationPage,
} from '@/components/marketing/legal/PublicInformationPage';

export const metadata: Metadata = {
  title: 'Terms of service | Ai Review by Digital Hammerr',
  description: 'How Ai Review works, account responsibilities, plan usage and customer control.',
};

export default function TermsPage() {
  return (
    <PublicInformationPage
      title="Terms of service"
      intro="These terms describe use of Ai Review by Digital Hammerr, including business accounts and the customer review-writing journey."
      path="/legal/terms"
    >
      <section>
        <h2>What the service does</h2>
        <p>
          Ai Review provides business profiles, QR links, editable Ai-assisted review drafts,
          private feedback and journey analytics. It is a writing assistant, not a service that
          sells reviews or posts them on a customer’s behalf.
        </p>
        <p>
          Customers must check and edit a draft so it reflects their genuine experience. Copying
          text or opening Google does not prove that a review has been published. Google controls
          its own accounts, posting process and moderation.
        </p>
        <p>
          Digital Hammerr does not guarantee review counts, ratings, search rankings, publication,
          sales or a particular time to complete the process. Ai Review is independent software, not
          an endorsement by Google.
        </p>
      </section>
      <section>
        <h2>Your business account</h2>
        <p>
          Provide accurate account and business details, keep your credentials private, and use the
          service only for businesses you are authorised to manage. Check that your Google review
          destination belongs to the correct business before sharing or printing a QR.
        </p>
        <p>
          If you upload branding or add customer contact information, you must have the necessary
          authority to use it. Do not put secrets or unnecessary sensitive personal information in
          business descriptions or review prompts.
        </p>
      </section>
      <section>
        <h2>Plans and usage</h2>
        <p>
          Free includes 10 Ai drafts total per business profile, without a periodic reset. The
          standard Pro plan is ₹999 for 12 calendar months and includes 2,000 Ai drafts in that paid
          period. These allowances are for drafts, not posted Google reviews.
        </p>
        <p>
          Each successful customer regeneration uses another draft. Editing and copying do not.
          Unused Pro drafts do not carry over to another paid period. When Ai allowance runs out,
          customers can still open Google and write their own review.
        </p>
        <p>
          See <Link href="/#pricing">pricing and billing details</Link> for scope, taxes, expiry and
          counting rules. Renewal requires a new annual payment; the current plan does not charge
          automatically. Cancellation and refund questions are covered on our{' '}
          <Link href="/legal/cancellation-refunds">cancellation and refunds page</Link>.
        </p>
      </section>
      <section>
        <h2>Honest, customer-controlled reviews</h2>
        <ul>
          <li>
            Do not fabricate a visit, impersonate a customer, offer review incentives or pressure
            someone to leave a particular rating.
          </li>
          <li>
            Do not block dissatisfied customers from the public review option or require
            merchant-selected praise.
          </li>
          <li>
            Customers can change or reject Ai wording and choose whether to post. Private feedback
            remains optional.
          </li>
          <li>
            Do not use the service to access another business’s information, distribute harmful
            content or bypass usage limits.
          </li>
        </ul>
        <p>
          Review the{' '}
          <a href="https://support.google.com/contributionpolicy/answer/7400114?hl=en">
            Google Maps content policy
          </a>{' '}
          before publishing to Google.
        </p>
      </section>
      <section>
        <h2>Data and third-party services</h2>
        <p>
          Our <Link href="/legal/privacy">Privacy Policy</Link> explains the account, business,
          customer and usage data handled by the application. External payment, email, Ai and Google
          services operate under their own terms and may be unavailable independently of Ai Review.
        </p>
      </section>
      <section>
        <h2>Questions about these terms</h2>
        <p>
          Contact <PublicContactLink /> for clarification, account assistance or a complaint. Ask
          about any unclear purchase condition before paying. Nothing on this page is intended to
          exclude rights that cannot be excluded under applicable law.
        </p>
      </section>
    </PublicInformationPage>
  );
}
