import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/lib/infra/db';
import { env } from '@/lib/infra/env';
import { apiError } from '@/lib/http/api-error';
import { requireTenant } from '@/lib/tenant/require-tenant';
import { readComposeBody } from '@/lib/crm/review-requests/compose-request';
import {
  DEFAULT_TEMPLATE_TEXT,
  RENDERED_MESSAGE_MAX,
  SAMPLE_TRACKING_TOKEN,
  buildTrackedRequestUrl,
  renderTemplate,
  unknownVariables,
} from '@/lib/crm/review-requests/template';
import {
  canonicalReviewUrlFor,
  loadCustomer,
  loadTenantMessagingContext,
  readDefaultTemplate,
} from '@/lib/crm/review-requests/repository';

/**
 * POST /api/v1/review-requests/preview — Flow F steps 3 and 4, without persisting anything.
 *
 * This is the only renderer. The screen calls it on a debounce as the template is edited rather
 * than substituting variables in the browser, so that what the owner reads and what the create
 * endpoint stores come from one implementation and cannot drift. It also keeps the composer's
 * bundle free of `@ai-review/core`, which would drag pg and argon2 into the browser.
 *
 * Read-only, deliberately. `ensureDefaultTemplate` is not called here: a preview is a GET in all but
 * name, and seeding a row as a side effect of looking at a screen is the kind of write nobody
 * expects. The screen's own loader and the create endpoint seed it, so the constant fallback below
 * is reached only by an API caller previewing before either has run.
 *
 * The tenant is never taken from the request: requireTenant resolves it from the session, and the
 * customer id in the body is ownership-checked inside the query (RBAC rule 2, AC-003).
 *
 * Not gated on `requireActiveTenant`. Drafting the message is safe before a business is published —
 * only *preparing* one mints a public link, and that is where Flow J's gate belongs.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await requireTenant(request);
  if (!auth.ok) return auth.response;

  const body = await readComposeBody(request);
  if (!body.ok) return body.response;

  const database = db();
  const { businessId } = auth.context;

  const [customer, tenant] = await Promise.all([
    loadCustomer(database, businessId, body.input.customerId),
    loadTenantMessagingContext(database, businessId),
  ]);

  // A missing customer and another tenant's customer are reported identically — that is what stops
  // this endpoint being an existence oracle for ids it should know nothing about (AC-003).
  if (!customer) return apiError('RESOURCE_NOT_FOUND', 'We could not find that customer.');
  if (!tenant) return apiError('RESOURCE_NOT_FOUND', 'We could not find your business.');

  const saved =
    body.input.templateText === undefined ? await readDefaultTemplate(database, businessId) : null;
  const templateText = body.input.templateText ?? saved?.templateText ?? DEFAULT_TEMPLATE_TEXT;

  const baseUrl = env().APP_BASE_URL;
  const reviewLink = canonicalReviewUrlFor(baseUrl, tenant.slug);

  /*
   * The preview shows the canonical review link, not a tracked one.
   *
   * Two reasons. A tracked link cannot exist yet — the token is minted when the request is created
   * — and a plausible-looking fake in a panel an owner can select and copy by hand is a link that
   * leads nowhere. The canonical link is real: copied out of the preview it still reaches the
   * business's review page, and the only thing lost is the attribution in Flow F step 9.
   */
  const rendered = renderTemplate(templateText, {
    customer_name: customer.name,
    business_name: tenant.name,
    // With no address claimed there is no link to show, so the placeholder is substituted with
    // itself and stays visible in the preview. Blanking it would leave a sentence ending in
    // nothing, which reads like a rendering bug rather than like setup that is unfinished.
    review_link: reviewLink ?? '{review_link}',
  });

  /*
   * Measured against the tracked link's length, because that is the string the column will hold.
   * See SAMPLE_TRACKING_TOKEN — the sample is never returned, only counted.
   */
  const preparedLength = renderTemplate(templateText, {
    customer_name: customer.name,
    business_name: tenant.name,
    review_link: buildTrackedRequestUrl(baseUrl, SAMPLE_TRACKING_TOKEN),
  }).length;

  return NextResponse.json({
    rendered_message: rendered,
    // Echoed so a caller that sent no template can see which text was used.
    template_text: templateText,
    review_link: reviewLink,
    // The screen says so in words: this preview is not the tracked link the customer will receive.
    review_link_is_tracked: false,
    // Placeholders the renderer will not substitute — `{name}`, `{Customer_Name}`. Returned rather
    // than silently ignored, because they would otherwise reach a customer verbatim.
    unknown_variables: unknownVariables(templateText),
    rendered_length: rendered.length,
    prepared_length: preparedLength,
    length_limit: RENDERED_MESSAGE_MAX,
    customer: { id: customer.id, name: customer.name },
  });
}
