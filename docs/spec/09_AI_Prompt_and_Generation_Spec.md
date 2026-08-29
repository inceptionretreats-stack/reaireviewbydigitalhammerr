# AI Prompt and Generation Specification

## Purpose
Generate **one editable English review draft** that is useful as writing assistance to a real customer while minimizing invented specifics, repetitive output and merchant-controlled keyword stuffing.

## Critical product constraint
V1 asks the customer **no questionnaire** and does not collect a star rating before Google. Therefore the AI does not possess reliable facts about the individual customer's subjective experience. It must not invent detailed claims as if they came from the customer.

The safest V1 implementation is:
- use merchant data only as factual business context;
- write generic, low-claim draft language;
- avoid specific statements about waiting time, price, employee behavior, treatment results, delivery speed or other facts not supplied by the customer;
- make the text editable;
- require the customer to check **"I confirm this draft reflects my genuine experience"** before Copy is enabled;
- always provide Private Feedback and a direct review destination without rating-gating.

This is a product requirement, not just prompt wording.

## Provider contract
- OpenAI Responses API.
- Default model: `gpt-5.6-luna` for high-volume, cost-sensitive generation.
- Reasoning effort: `none` or lowest validated latency setting.
- Structured output: strict JSON schema.
- Target output: 45-85 words.
- Hard UI maximum: 1,200 chars after customer edits.
- Generation timeout budget: 8 seconds server-side; UI should show retry/fallback.

## Input object
```json
{
  "business": {
    "name": "Digital Hammerr",
    "category": "Digital Marketing & AI Services",
    "city": "Udaipur",
    "description": "...",
    "services": ["SEO", "Web Development", "AI Training"],
    "context_terms": ["digital marketing", "AI solutions"]
  },
  "review_mode": {
    "name": "SEO",
    "description": "General SEO service context",
    "context_terms": ["SEO", "website visibility"]
  },
  "previous_drafts": ["..."],
  "generation_number": 2
}
```

## Structured output
```json
{
  "review_text": "...",
  "used_context_terms": ["SEO"],
  "claim_risk": "low",
  "internal_quality_notes": []
}
```
`internal_quality_notes` is never shown to the customer.

## Global system prompt - required behavior
1. Act as a review-writing assistant, not as the reviewer.
2. Produce exactly one normal-length English draft.
3. Treat business fields as factual context only.
4. Do not imply a 5-star rating or any numeric rating.
5. Do not say "best", "perfect", "guaranteed", "highly recommend" or similar extreme praise unless the customer themselves supplied it (V1 supplies none, so avoid by default).
6. Do not fabricate staff names, exact service outcomes, time saved, price/value claims, medical outcomes, legal outcomes or delivery facts.
7. Avoid keyword lists and SEO-style repetition.
8. Use at most 1-2 context/service terms naturally.
9. Do not mention competitors.
10. Do not include incentives, discounts or quid-pro-quo wording.
11. Avoid identical openings/closings across regeneration.
12. If previous drafts exist, vary structure and wording substantially.
13. Do not include quotation marks around the review.
14. Output only the JSON schema.

## Regeneration algorithm
1. Load up to the last 3 drafts from the same anonymous session/business.
2. Generate a candidate.
3. Normalize lowercase/whitespace and compute similarity against previous drafts.
4. Recommended threshold: if normalized semantic/text similarity > 0.82, retry once with stronger variation instruction.
5. Reject candidate if:
   - outside target length by large margin;
   - contains forbidden rating language;
   - contains obvious keyword stuffing;
   - includes unsupported detailed claims;
   - includes platform policy manipulation language.
6. Store final candidate, prompt version, model, tokens and similarity score.

## Merchant "keywords" implementation
UI label should preferably be **Business Context** or **AI Context**, with helper text:
> Add services or topics that help AI understand your business. These are context hints and may not appear in every review.

Do not provide a setting called "Mandatory keywords in every review".

## Review modes
A review mode changes context emphasis, not sentiment.
Example:
- Balanced
- Food
- Service
- Ambience
- SEO
- Website Development

A mode must never mean "positive only", "5 star" or "negative suppress".

## Free quota semantics
- Business onboarding/test preview: not counted.
- Public successful generation: counted.
- Public regeneration: counted, because it consumes provider resources.
- Provider failure before usable output: not counted.
- Duplicate internal retry caused by quality gate: count as one customer generation, but track provider cost separately.

## Abuse controls
- Per anonymous session: recommended <= 10 generations/hour/business.
- Per IP prefix: adaptive rate limit.
- Per Free business: hard 10 successful public generations total.
- Paid fair-use: start with soft alerts at a configurable monthly threshold; do not advertise a hidden hard cap to normal users.
- Detect bot-like rapid generation without copy/navigation behavior.

## Evaluation set before launch
Create at least 200 test contexts across:
- restaurant/cafe
- hotel
- salon/spa
- dental/medical clinic
- jewellery/retail
- gym
- school/coaching
- real estate
- agency/professional services
- automobile/service center

Score each output for:
- naturalness
- claim risk
- business-context correctness
- variation
- no star/rating manipulation
- no keyword stuffing
- grammar
- usefulness as editable draft

Release only when predefined evaluation thresholds are met.
