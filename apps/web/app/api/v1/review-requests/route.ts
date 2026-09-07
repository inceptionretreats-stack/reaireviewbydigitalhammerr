import { NextResponse, type NextRequest } from 'next/server';
import { reviewRequests } from '@ai-review/db';
import { issueToken } from '@ai-review/core';
import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { apiError } from '@/lib/api-error';
import { requireActiveTenant, requireTenant } from '@/lib/require-tenant';
import { readComposeBody } from './compose-request';
import {
  DEFAULT_TEMPLATE_TEXT,
  RENDERED_MESSAGE_MAX,
  buildTrackedRequestUrl,
  renderTemplate,
  unknownVariables,
} from './template';
import {
  advanceCustomerStatus,
  ensureDefaultTemplate,
  loadCustomer,
  loadTenantMessagingContext,
  recordPreparedEvent,
  whatsAppLinkFor,
} from './service';

/**
 * POST /api/v1/review-requests — Flow F step 5's "Message Prepared", and the only place a tracked
 * link is minted (OPEN-02).
 *
 * The platform sends nothing here and has no code path that could (D-017, ADR-004, REQ-01-02,
 * AC-022). There is no outbound HTTP in this handler: it renders text, stores it, and hands back a
 * wa.me deep link for the owner's own browser to open. The owner sends the message from their own
 * number.
 *
 * Why preparing is a step of its own rather than something Copy and Open WhatsApp do implicitly:
 * the message has to contain the tracked link before it is copied, or Flow F step 9 has nothing to
 * attribute; and a clipboard write or a window open that happens *after* an await has lost the
 * browser's user-activation and is blocked by Safari and by pop-up blockers. So the round trip
 * happens on its own button, and Copy / Open WhatsApp then act on text that already exists.
 * `review_request_prepared` in the taxonomy ("Manual message created") is that same step.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await requireTenant(request);
  if (!auth.ok) return auth.response;

  /*
   * Flow J's gate, and it is doing real work rather than being copied in.
   *
   * A tracked link points at the tenant's public review page. For a DRAFT tenant that page does not
   * resolve yet, and for a SUSPENDED one it deliberately shows an unavailable state — so preparing a
   * message would hand the owner something to send to a real customer that leads nowhere. Refusing
   * here is kinder than a link that fails in someone else's WhatsApp.
   *
   * The preview endpoint is deliberately *not* gated, so the message can still be drafted.
   */
  const inactive = requireActiveTenant(auth.context);
  if (inactive) return inactive;

  const body = await readComposeBody(request);
  if (!body.ok) return body.response;

  const database = db();
  const { businessId } = auth.context;

  const [customer, tenant] = await Promise.all([
    loadCustomer(database, businessId, body.input.customerId),
    loadTenantMessagingContext(database, businessId),
  ]);

  // Identical answer for "no such customer" and "not your customer" (AC-003).
  if (!customer) return apiError('RESOURCE_NOT_FOUND', 'We could not find that customer.');
  if (!tenant) return apiError('RESOURCE_NOT_FOUND', 'We could not find your business.');

  if (tenant.slug === null) {
    // Unreachable for an ACTIVE tenant — publishing requires an address — but a link built on an
    // empty slug would be a broken URL sent to a customer, so it fails loudly instead.
    return apiError(
      'BUSINESS_NOT_ACTIVE',
      'Your review page address is not set up yet, so there is no link to share.',
    );
  }

  const saved = await ensureDefaultTemplate(database, businessId);
  const templateText = body.input.templateText ?? saved?.templateText ?? DEFAULT_TEMPLATE_TEXT;

  /*
   * `template_id` is claimed only when the stored template is verbatim what was rendered.
   *
   * The column and the taxonomy's optional `template_id` both mean "this message came from that
   * template". Once the owner has edited the text (Flow F step 4 invites them to), it did not — and
   * an edited message filed against the saved template would make any later "which template
   * performs best" question answer itself wrongly. `rendered_message` is the record of what was
   * actually prepared; this is only the provenance.
   */
  const templateId = saved && saved.templateText === templateText ? saved.id : null;

  /*
   * The token is returned to nobody twice and stored nowhere in plaintext: only its SHA-256 goes
   * into `tracking_token_hash`, exactly as sessions, invites and reset links do (see
   * `packages/core/src/auth/tokens.ts`). The plaintext exists only inside the rendered message —
   * which is why re-copying an old request from the list still works, and why the platform cannot
   * regenerate a link for a request it has already prepared.
   *
   * No collision retry, unlike QR codes: this is 256 bits of randomness against a UNIQUE column,
   * so a collision is not a case that needs handling, whereas a 10-character QR alphabet is.
   */
  const { token, tokenHash } = issueToken();
  const baseUrl = env().APP_BASE_URL;
  const trackedUrl = buildTrackedRequestUrl(baseUrl, token);

  const renderedMessage = renderTemplate(templateText, {
    customer_name: customer.name,
    business_name: tenant.name,
    review_link: trackedUrl,
  });

  if (renderedMessage.length > RENDERED_MESSAGE_MAX) {
    // The tracked link is around ninety characters, so a template that fitted in the editor can
    // still overflow once it is resolved. Said plainly, with the number, rather than as a bare
    // "too long" the owner has to guess at.
    return apiError(
      'VALIDATION_FAILED',
      `That message comes to ${renderedMessage.length} characters once the name and link are ` +
        `filled in, and the limit is ${RENDERED_MESSAGE_MAX}. Please shorten it.`,
      { details: { fields: ['template_text'] } },
    );
  }

  const [created] = await database
    .insert(reviewRequests)
    .values({
      businessId,
      customerId: customer.id,
      templateId,
      trackingTokenHash: tokenHash,
      renderedMessage,
    })
    .returning({ id: reviewRequests.id, preparedAt: reviewRequests.preparedAt });

  if (!created) {
    // A returning insert that yields no row is a broken invariant, not a user error.
    return apiError('INTERNAL_ERROR', 'We could not prepare that message. Please try again.');
  }

  /*
   * Everything after the insert is best-effort, and deliberately not in a transaction with it.
   *
   * The request row is the artefact the owner is about to act on. If the derived status column or
   * the analytics event failed and took the response down with them, the owner would retry and
   * prepare a second tracked request for the same customer — a worse outcome than a status that is
   * one rung behind. `customers.status` is climbed monotonically, so a missed advance here is
   * corrected by the next action on that customer.
   */
  try {
    await advanceCustomerStatus(database, businessId, customer.id, 'MESSAGE_PREPARED');
  } catch (error) {
    console.warn('[review-requests] status advance failed after prepare', error);
  }

  await recordPreparedEvent(database, {
    businessId,
    customerId: customer.id,
    requestId: created.id,
    templateId,
  });

  return NextResponse.json(
    {
      id: created.id,
      prepared_at: created.preparedAt.toISOString(),
      // Never "sent": the platform has not sent anything and cannot (AC-023 wants the sent status to
      // read as the owner's own action, so it starts null and only Mark Message Sent fills it).
      marked_sent_at: null,
      rendered_message: renderedMessage,
      review_link: trackedUrl,
      review_link_is_tracked: true,
      // null when the stored mobile is not a number WhatsApp can open (REQ-01-01, "where valid").
      // The screen then offers Copy alone and says why.
      whatsapp_url: whatsAppLinkFor(customer.mobile, renderedMessage),
      unknown_variables: unknownVariables(templateText),
      customer: { id: customer.id, name: customer.name },
    },
    // 201, as 08_OpenAPI_v1.yaml declares for this operation.
    { status: 201 },
  );
}
