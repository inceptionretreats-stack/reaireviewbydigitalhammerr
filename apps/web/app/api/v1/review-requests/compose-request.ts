import type { NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { TEMPLATE_TEXT_MAX } from './template';
import { isUuid } from './service';

/**
 * The body `POST /review-requests/preview` and `POST /review-requests` share.
 *
 * One parser for both, because the two must accept exactly the same input: a preview the owner
 * approves and a create that renders something else would make the preview worthless. Flow F steps
 * 3 and 4 are one loop — render, edit, render — and this is its entry point.
 *
 * Hand-rolled rather than a Zod DTO because `packages/contracts` has no CRM module yet and is
 * outside this module's write scope; the constraints below are taken from the columns the values
 * land in (`review_request_templates.template_text` is varchar(1200)). A
 * `reviewRequestComposeRequest` schema belongs in contracts — see concerns.
 */

export interface ComposeInput {
  customerId: string;
  /** Absent means "use my saved template", which is what the screen sends on first load. */
  templateText: string | undefined;
}

export type ComposeBodyResult =
  { ok: true; input: ComposeInput } | { ok: false; response: NextResponse };

export async function readComposeBody(request: Request): Promise<ComposeBodyResult> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return { ok: false, response: apiError('VALIDATION_FAILED', 'Malformed request body.') };
  }

  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, response: apiError('VALIDATION_FAILED', 'Malformed request body.') };
  }

  const body = raw as Record<string, unknown>;
  const customerId = typeof body.customer_id === 'string' ? body.customer_id.trim() : '';

  // Required rather than optional. Flow F step 1 selects a customer before step 3 renders anything,
  // and a preview rendered without one could only show a placeholder name — which is a fake message
  // the owner might approve, so it is refused instead.
  if (customerId === '' || !isUuid(customerId)) {
    return {
      ok: false,
      response: apiError('VALIDATION_FAILED', 'Choose the customer this message is for.', {
        details: { fields: ['customer_id'] },
      }),
    };
  }

  if (body.template_text === undefined || body.template_text === null) {
    return { ok: true, input: { customerId, templateText: undefined } };
  }

  if (typeof body.template_text !== 'string') {
    return {
      ok: false,
      response: apiError('VALIDATION_FAILED', 'The message template must be text.', {
        details: { fields: ['template_text'] },
      }),
    };
  }

  // Ends trimmed, the middle left exactly as typed: an owner who laid the message out over three
  // lines meant those line breaks, and WhatsApp preserves them.
  const templateText = body.template_text.trim();

  if (templateText === '') {
    return {
      ok: false,
      response: apiError('VALIDATION_FAILED', 'Write the message you want to send.', {
        details: { fields: ['template_text'] },
      }),
    };
  }

  if (templateText.length > TEMPLATE_TEXT_MAX) {
    return {
      ok: false,
      response: apiError(
        'VALIDATION_FAILED',
        `Keep the message to ${TEMPLATE_TEXT_MAX} characters or fewer.`,
        { details: { fields: ['template_text'] } },
      ),
    };
  }

  return { ok: true, input: { customerId, templateText } };
}
