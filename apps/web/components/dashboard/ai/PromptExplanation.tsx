import { Card } from '@ai-review/ui';

/**
 * The "Prompt preview explanation" content of AI-01, and the whole of AI-01-02.
 *
 * AI-01-02 is a two-sided requirement: a business owner must never see or edit the global system
 * prompt, *and* must still understand what the assistant does with what they typed. Only refusing
 * is not enough — an owner who cannot see why a draft came out the way it did will assume the terms
 * box does nothing.
 *
 * So this describes behaviour, never wording. Each line below corresponds to a rule in
 * 09_AI_Prompt_and_Generation_Spec.md ("Global system prompt - required behavior"), restated as
 * what the owner will observe: business fields are facts (rule 3), at most one or two terms appear
 * naturally (rule 8), no rating is implied (rule 4), no extreme praise (rule 5), nothing invented
 * about staff, prices, times or outcomes (rule 6). None of it quotes the prompt, and none of it is
 * editable, because the prompt lives in `ai_prompt_versions` and is admin-only (ADR-006, ADMIN-03).
 *
 * The last paragraph says plainly that the wording rules are not editable and why. An owner who is
 * simply given no control assumes one is hidden from them; an owner told it is the same for every
 * business, and what it is for, has been given an answer.
 *
 * A Server Component: it is static prose, so shipping it as client JavaScript would buy nothing.
 */
export function PromptExplanation() {
  return (
    <Card title="How your details are used" titleAs="h2">
      <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm text-ink">
        <li>
          Your business name, category and city go in as plain facts, so a draft is about the right
          kind of business in the right place.
        </li>
        <li>
          Your summary, services and context terms are background. A draft uses at most one or two
          of them, worked into normal sentences — and sometimes none, because a list of terms in a
          review reads like an advertisement.
        </li>
        <li>
          The mode in use decides which of those topics gets the emphasis. It changes the subject,
          not the sentiment.
        </li>
        <li>
          The draft stays deliberately unspecific about anything nobody has told us: no waiting
          times, prices, staff names, or results. Your customer knows those things; we do not, and
          inventing them would put words in their mouth.
        </li>
        <li>
          It never implies a rating out of five and avoids extreme praise, because that is the
          customer&rsquo;s to give, not ours to write.
        </li>
        <li>
          Your customer can rewrite every word, and has to confirm the draft reflects their own
          experience before they can copy it.
        </li>
      </ol>

      <div className="mt-4 border-t border-line pt-3">
        <p className="text-sm text-ink-muted">
          The writing rules themselves are the same for every business on the platform and are
          managed by Digital Hammerr, so they are not editable here. They are what keeps drafts
          honest and inside the review platforms&rsquo; own policies — which is what protects your
          page in the long run. What you control is the context above, and that is the part that
          makes a draft sound like your business.
        </p>
      </div>
    </Card>
  );
}
