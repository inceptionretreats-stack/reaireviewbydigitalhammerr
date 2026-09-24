/**
 * The manual review-request message: its three variables, its limits, and the two link shapes a
 * request can carry.
 *
 * Flow F step 3 fixes the variable set exactly — `{customer_name}`, `{business_name}`,
 * `{review_link}` — so it is a closed list here rather than an open substitution map. An open one
 * would let a template reference anything the renderer happened to be handed, and the renderer is
 * handed a customer row.
 *
 * This module is deliberately dependency-free: no database, no `@/lib/infra/env`, no `@ai-review/core`.
 * The route handlers render with it on the server, and the composer imports the variable names and
 * the limits to build its insert buttons and counters. Importing `@ai-review/core` into a client
 * component instead would pull pg, ioredis and @node-rs/argon2 into the browser bundle — the same
 * reason `components/onboarding/BusinessStep.tsx` takes its slug rules as props.
 */

/** Flow F step 3, in the order the flow lists them. */
export const TEMPLATE_VARIABLES = ['customer_name', 'business_name', 'review_link'] as const;

export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number];
export type TemplateValues = Record<TemplateVariable, string>;

/** `review_request_templates.template_text` is varchar(1200). */
export const TEMPLATE_TEXT_MAX = 1200;

/** `review_requests.rendered_message` is varchar(1500). */
export const RENDERED_MESSAGE_MAX = 1500;

/**
 * Matches any `{word}` placeholder, not only the three known ones.
 *
 * Recognising more than it substitutes is the point: `{Customer_Name}` and `{name}` are what an
 * owner actually types, and a pattern narrowed to the known names would leave both silently
 * unexpanded in a message going to a real customer. Detected here, they come back from
 * `unknownVariables` and the screen can say so before anything is prepared.
 */
const PLACEHOLDER_PATTERN = /\{([A-Za-z0-9_]{1,40})\}/g;

export function isTemplateVariable(name: string): name is TemplateVariable {
  return (TEMPLATE_VARIABLES as readonly string[]).includes(name);
}

/**
 * Substitutes the three known variables and leaves anything else exactly as written.
 *
 * One pass, and `String.prototype.replace` never rescans what it has just inserted, so a value
 * cannot expand into another placeholder. That matters because two of the three values are
 * merchant- and customer-supplied: a customer saved as `{review_link}` in the contact list cannot
 * make their own name resolve to the tracked link, and no amount of nesting produces a second
 * round of substitution.
 *
 * An unknown placeholder is preserved rather than blanked. Deleting part of the owner's text
 * because the platform did not recognise it is the worse failure — they can see `{name}` in the
 * preview and fix it; they cannot see something that vanished.
 */
export function renderTemplate(template: string, values: TemplateValues): string {
  return template.replace(PLACEHOLDER_PATTERN, (whole, name: string) =>
    isTemplateVariable(name) ? values[name] : whole,
  );
}

/** Placeholders the renderer will not substitute, first occurrence first, without duplicates. */
export function unknownVariables(template: string): string[] {
  const found = new Set<string>();
  for (const match of template.matchAll(PLACEHOLDER_PATTERN)) {
    const name = match[1];
    if (name !== undefined && !isTemplateVariable(name)) found.add(name);
  }
  return [...found];
}

/**
 * The default template seeded for a tenant that has none (REQ-01 shows a template; nothing else
 * creates one).
 *
 * Every clause is a compliance decision, not a copy preference:
 *
 *  - It asks the customer to share their experience on Google. It never claims, promises or
 *    implies that a review was left — the platform cannot observe that (D-028, AC-025).
 *  - It asks for no rating, and offers no scale (D-009, AC-006). "Share your experience" is not
 *    "rate us out of five".
 *  - It reads as one person writing to one customer, because that is what it is: the owner sends
 *    it from their own number (D-017, ADR-004, REQ-01-02). Nothing here is signed by the platform.
 *  - It is short. It is pasted into WhatsApp, and a wall of text is what gets ignored.
 *
 * The owner can edit it freely (Flow F step 4), so this is a starting point rather than a policy.
 */
export const DEFAULT_TEMPLATE_NAME = 'Default message';

export const DEFAULT_TEMPLATE_TEXT =
  'Hi {customer_name}, thank you for choosing {business_name}. ' +
  'If you have a moment, would you share your experience on Google? ' +
  'This link helps you put it into words in a few taps: {review_link}';

/**
 * The tracked link a prepared request carries (Flow F step 9, OPEN-02).
 *
 * Mirrors `buildQrUrl` in `@ai-review/core` and belongs beside it; it is here because
 * `packages/core` is outside this module's write scope. See the returned concerns.
 *
 * The token is base64url from `issueToken`, so it contains no character that could add a path
 * segment — but it is still validated on the way back in (`isTrackingTokenFormat`) rather than
 * trusted, because the value that arrives at the resolver comes from a URL bar, not from here.
 */
export function buildTrackedRequestUrl(baseUrl: string, token: string): string {
  return new URL(`/r/req/${token}`, baseUrl).toString();
}

/** The business's own review page — what a preview shows before any token exists. */
export function buildCanonicalReviewUrl(baseUrl: string, slug: string): string {
  return new URL(`/${slug}/review`, baseUrl).toString();
}

/**
 * Recovers the tracked link from a message that was already prepared.
 *
 * The token is never stored — only its SHA-256 — so `rendered_message` holds the single surviving
 * copy of the usable link. Reading it back out is what lets REQ-01 show the link beside an older
 * request instead of only inside the message body.
 *
 * Matched by shape rather than against the current APP_BASE_URL, so a request prepared before a
 * domain change still resolves. Returns null when the owner's template omitted `{review_link}` —
 * which is allowed, and which the screen reports rather than hiding.
 */
const TRACKED_URL_PATTERN = /https?:\/\/[^\s<>"']+\/r\/req\/[A-Za-z0-9_-]{32,64}/;

export function findTrackedRequestUrl(message: string): string | null {
  return TRACKED_URL_PATTERN.exec(message)?.[0] ?? null;
}

/**
 * Shape check for a token arriving in a URL.
 *
 * `issueToken()` produces 43 base64url characters from 32 random bytes; the range accepts a
 * future change of token length without accepting arbitrary input. Checking before hashing means
 * a scanner probing `/r/req/../../etc` costs no database round trip, and — because the lookup is
 * by SHA-256 of the token — nothing about the stored value is exposed either way.
 */
const TRACKING_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,64}$/;

export function isTrackingTokenFormat(value: string): boolean {
  return TRACKING_TOKEN_PATTERN.test(value);
}

/** `issueToken()`'s default 32 random bytes, base64url-encoded, is 43 characters. */
export const TRACKING_TOKEN_LENGTH = 43;

/**
 * A token-shaped string used only to *measure* a tracked link, never to build a usable one.
 *
 * The preview shows the business's canonical review link, because that link works if an owner
 * copies it out of the preview by hand. The prepared message carries the tracked link instead,
 * which is some forty characters longer — so the character count the screen shows has to be
 * measured against the tracked shape, or a message that counts as 1,480 characters on screen is
 * rejected by the varchar(1500) column at the moment the owner presses Prepare.
 */
export const SAMPLE_TRACKING_TOKEN = 'A'.repeat(TRACKING_TOKEN_LENGTH);
