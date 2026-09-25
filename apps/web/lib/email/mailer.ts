import { env } from '@/lib/infra/env';

/**
 * Transactional email.
 *
 * An interface with three transports behind it. `ResendTransport` is the real one
 * (AMENDMENT-029): Resend's REST API over `fetch`, chosen because it needs one key and one DNS
 * record set to send from digitalhammerr.com, where SES starts sandboxed behind an approval.
 * Without `RESEND_API_KEY`, development prints to the console and production fails loudly —
 * a receipt or reset email that vanishes silently is the hardest support ticket to diagnose.
 *
 * What must NOT drift: 13_Security_Privacy_Compliance.md requires PII-redacted logs, so no
 * transport ever logs a body. A password-reset body carries a live single-use credential; a
 * receipt carries a customer's legal name and GSTIN.
 */

export interface Email {
  to: string;
  subject: string;
  text: string;
  /** Optional HTML alternative; the text part is always sent too. */
  html?: string;
}

export interface MailTransport {
  send(email: Email): Promise<void>;
}

export class MailError extends Error {
  constructor(readonly status: number) {
    super(`mail provider answered ${status}`);
    this.name = 'MailError';
  }
}

/**
 * Development transport. Prints enough to follow the flow and no more; the first link is
 * printed because a developer cannot complete a reset or an invite without it and there is no
 * inbox locally.
 */
class ConsoleMailTransport implements MailTransport {
  send(email: Email): Promise<void> {
    console.warn(`[mail] -> ${email.to} | ${email.subject}`);
    if (env().NODE_ENV === 'development') {
      const link = /https?:\/\/\S+/.exec(email.text)?.[0];
      if (link) console.warn(`[mail] dev link: ${link}`);
    }
    return Promise.resolve();
  }
}

/** Production without a key. Fails loudly rather than silently dropping mail. */
class UnconfiguredMailTransport implements MailTransport {
  send(_email: Email): Promise<void> {
    console.error('[mail] NO TRANSPORT CONFIGURED — email was not sent');
    return Promise.reject(new Error('No mail transport is configured for this environment'));
  }
}

export type MailFetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal },
) => Promise<{ ok: boolean; status: number }>;

/**
 * Resend. One POST per email; a non-2xx answer surfaces as `MailError` with the status and the
 * status only — subjects can contain personal information, and response bodies can echo requests.
 */
export class ResendTransport implements MailTransport {
  constructor(
    private readonly options: {
      apiKey: string;
      from: string;
      fetchImpl?: MailFetchLike;
      timeoutMs?: number;
    },
  ) {}

  async send(email: Email): Promise<void> {
    const fetchImpl: MailFetchLike =
      this.options.fetchImpl ??
      ((url, init) => fetch(url, init) as Promise<{ ok: boolean; status: number }>);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 10_000);
    try {
      const response = await fetchImpl('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.options.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: this.options.from,
          to: [email.to],
          subject: email.subject,
          text: email.text,
          ...(email.html ? { html: email.html } : {}),
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        console.error(`[mail] resend answered ${response.status}`);
        throw new MailError(response.status);
      }
    } catch (error) {
      if (error instanceof MailError) throw error;
      const status = controller.signal.aborted ? 504 : 502;
      console.error(`[mail] resend request failed (${status})`);
      throw new MailError(status);
    } finally {
      clearTimeout(timer);
    }
  }
}

let transport: MailTransport | undefined;

export function mailer(): MailTransport {
  if (!transport) {
    const e = env();
    if (e.RESEND_API_KEY) {
      transport = new ResendTransport({ apiKey: e.RESEND_API_KEY, from: e.EMAIL_FROM });
    } else if (e.NODE_ENV === 'production') {
      transport = new UnconfiguredMailTransport();
    } else {
      transport = new ConsoleMailTransport();
    }
  }
  return transport;
}

/** Whether a real provider is configured — screens say "not sent" instead of pretending. */
export function mailConfigured(): boolean {
  return Boolean(env().RESEND_API_KEY);
}

/** Overrides the transport. Tests use this; nothing in the app should. */
export function setMailTransport(next: MailTransport | undefined): void {
  transport = next;
}

export { passwordResetEmail } from './email-templates';
