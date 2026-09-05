import { env } from './env';

/**
 * Transactional email.
 *
 * Deliberately an interface with a logging transport behind it. A real provider (SES per
 * 02_System_Architecture.md) needs production access that has not been requested yet — it starts
 * sandboxed and only sends to verified addresses — so wiring one now would make local
 * development depend on an approval that has not happened.
 *
 * The important property is that the call sites are already correct: they send through this
 * port, so swapping the transport is a composition change and not a rewrite. E13 owns that.
 *
 * What must NOT drift: 13_Security_Privacy_Compliance.md requires PII-redacted logs, so the dev
 * transport logs the recipient and subject but never the body. A password-reset body contains a
 * live single-use credential, and logging it would put that credential in the log aggregator.
 */

export interface Email {
  to: string;
  subject: string;
  text: string;
}

export interface MailTransport {
  send(email: Email): Promise<void>;
}

/**
 * Development transport. Prints enough to follow the flow and no more; the reset URL is printed
 * because a developer cannot complete the flow without it and there is no inbox locally.
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

/**
 * Production placeholder. Fails loudly rather than silently dropping mail: a reset email that
 * vanishes looks to the user exactly like a reset email that was never requested, and that is
 * the hardest class of support ticket to diagnose.
 */
class UnconfiguredMailTransport implements MailTransport {
  send(email: Email): Promise<void> {
    console.error(`[mail] NO TRANSPORT CONFIGURED — dropped "${email.subject}" to ${email.to}`);
    return Promise.reject(new Error('No mail transport is configured for this environment'));
  }
}

let transport: MailTransport | undefined;

export function mailer(): MailTransport {
  transport ??=
    env().NODE_ENV === 'production' ? new UnconfiguredMailTransport() : new ConsoleMailTransport();
  return transport;
}

/** Overrides the transport. Tests use this; nothing in the app should. */
export function setMailTransport(next: MailTransport | undefined): void {
  transport = next;
}

export function passwordResetEmail(to: string, resetUrl: string): Email {
  return {
    to,
    subject: 'Reset your AI Review password',
    text: [
      'Someone asked to reset the password for this email address.',
      '',
      `Open this link to choose a new password: ${resetUrl}`,
      '',
      'The link works once and expires in one hour.',
      'If this was not you, you can ignore this email — nothing has changed.',
    ].join('\n'),
  };
}
