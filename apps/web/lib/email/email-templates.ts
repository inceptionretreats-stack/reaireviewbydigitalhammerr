import type { Email } from './mailer';

/**
 * Every email the platform sends, as plain text with an HTML twin.
 *
 * Text first: the text part is what a screen reader, a plain client and the console transport
 * see, and it is the part that must stand on its own. The HTML is the same words in a
 * single-column layout that renders the same in Gmail, Outlook and Apple Mail — no images, no
 * external CSS, inline styles only.
 *
 * Nothing here invents a claim: a receipt says what was paid and for what period; a reminder
 * says when the year ends and where to renew. Product copy rules apply (D-009: no star
 * ratings; AC-025: the platform never says a review was submitted).
 */

const BRAND = 'Ai Review by Digital Hammerr';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function layout(title: string, bodyHtml: string): string {
  return `<!doctype html><html><body style="margin:0;background:#eef3fb;font-family:Arial,Helvetica,sans-serif;color:#0b1f33">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef3fb;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;padding:32px">
<tr><td style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#52627a;padding-bottom:12px">${escapeHtml(BRAND)}</td></tr>
<tr><td style="font-size:22px;font-weight:700;padding-bottom:16px">${escapeHtml(title)}</td></tr>
<tr><td style="font-size:15px;line-height:1.55">${bodyHtml}</td></tr>
<tr><td style="font-size:12px;color:#5f6368;padding-top:24px;border-top:1px solid #d2e3fc;margin-top:24px">${escapeHtml(BRAND)} · This is an automated message.</td></tr>
</table></td></tr></table></body></html>`;
}

function paragraphs(lines: string[]): string {
  return lines.map((line) => `<p style="margin:0 0 12px">${escapeHtml(line)}</p>`).join('');
}

function button(label: string, href: string): string {
  return `<p style="margin:20px 0"><a href="${escapeHtml(href)}" style="display:inline-block;background:#1a56db;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:10px">${escapeHtml(label)}</a></p><p style="margin:0 0 12px;font-size:13px;color:#5f6368">Or open this link: ${escapeHtml(href)}</p>`;
}

export function passwordResetEmail(to: string, resetUrl: string): Email {
  const lines = [
    'Someone asked to reset the password for this email address.',
    'The link works once and expires in one hour.',
    'If this was not you, you can ignore this email — nothing has changed.',
  ];
  return {
    to,
    subject: 'Reset your Ai Review password',
    text: [
      lines[0],
      '',
      `Open this link to choose a new password: ${resetUrl}`,
      '',
      lines[1],
      lines[2],
    ].join('\n'),
    html: layout(
      'Reset your password',
      paragraphs([lines[0]!]) +
        button('Choose a new password', resetUrl) +
        paragraphs([lines[1]!, lines[2]!]),
    ),
  };
}

export function adminInviteEmail(
  to: string,
  input: {
    inviterName: string;
    role: 'SUPER_ADMIN' | 'BUSINESS_SUPPORT_VIEWER';
    inviteUrl: string;
    expiresAt: Date;
  },
): Email {
  const roleLabel =
    input.role === 'SUPER_ADMIN' ? 'platform administrator' : 'support viewer (read-only)';
  const lines = [
    `${input.inviterName} has invited you to the Ai Review platform admin as a ${roleLabel}.`,
    `The link expires on ${formatDate(input.expiresAt)} and works once. You will set a password and then enrol an authenticator app — admin sign-in always needs both.`,
    'If you were not expecting this, ignore it and nothing happens.',
  ];
  return {
    to,
    subject: 'Your Ai Review admin invitation',
    text: [lines[0], '', `Accept the invitation: ${input.inviteUrl}`, '', lines[1], lines[2]].join(
      '\n',
    ),
    html: layout(
      'You have been invited',
      paragraphs([lines[0]!]) +
        button('Accept invitation', input.inviteUrl) +
        paragraphs([lines[1]!, lines[2]!]),
    ),
  };
}

export interface ReceiptEmailInput {
  businessName: string;
  invoiceNumber: string | null;
  amountLabel: string;
  paidOn: string;
  periodLabel: string | null;
  receiptUrl: string;
}

export function receiptEmail(to: string, input: ReceiptEmailInput): Email {
  const title = input.invoiceNumber ? `Invoice ${input.invoiceNumber}` : 'Your payment receipt';
  const lines = [
    `Thank you. We received ${input.amountLabel} from ${input.businessName} on ${input.paidOn} for Ai Review Pro — one year.`,
    ...(input.periodLabel ? [`Your Pro year runs ${input.periodLabel}.`] : []),
    'Open the invoice to download or print it. Keep it for your records.',
  ];
  return {
    to,
    subject: `${title} — Ai Review Pro`,
    text: [...lines, '', `Invoice: ${input.receiptUrl}`].join('\n'),
    html: layout(title, paragraphs(lines) + button('Open invoice', input.receiptUrl)),
  };
}

export function renewalReminderEmail(
  to: string,
  input: {
    businessName: string;
    expiresAt: Date;
    daysLeft: number;
    renewUrl: string;
    amountLabel: string;
  },
): Email {
  const when =
    input.daysLeft <= 1
      ? 'tomorrow'
      : input.daysLeft <= 7
        ? `in ${input.daysLeft} days`
        : `on ${formatDate(input.expiresAt)}`;
  const lines = [
    `The Ai Review Pro year for ${input.businessName} ends ${when} (${formatDate(input.expiresAt)}).`,
    `Renew for ${input.amountLabel} to keep 2,000 Ai drafts a year. Renewing early adds a year from the current end date, so no time is lost.`,
    'If you do nothing, the plan returns to the free allowance and every QR code keeps working.',
  ];
  return {
    to,
    subject: `Your Ai Review Pro year ends ${when}`,
    text: [...lines, '', `Renew: ${input.renewUrl}`].join('\n'),
    html: layout('Time to renew', paragraphs(lines) + button('Renew now', input.renewUrl)),
  };
}

export function subscriptionExpiredEmail(
  to: string,
  input: { businessName: string; renewUrl: string; amountLabel: string },
): Email {
  const lines = [
    `The Ai Review Pro year for ${input.businessName} has ended. Your page and QR codes keep working on the free allowance.`,
    `Renew for ${input.amountLabel} whenever you are ready to bring back 2,000 Ai drafts a year.`,
  ];
  return {
    to,
    subject: 'Your Ai Review Pro year has ended',
    text: [...lines, '', `Renew: ${input.renewUrl}`].join('\n'),
    html: layout('Your Pro year has ended', paragraphs(lines) + button('Renew', input.renewUrl)),
  };
}

export function abuseWarningEmail(
  to: string,
  input: { businessName: string; message: string; supportEmail: string },
): Email {
  const lines = [
    `A note from Digital Hammerr about ${input.businessName} on Ai Review:`,
    input.message,
    `Reply to ${input.supportEmail} if you think this is a mistake.`,
  ];
  return {
    to,
    subject: `About ${input.businessName} on Ai Review`,
    text: lines.join('\n\n'),
    html: layout('A note from Digital Hammerr', paragraphs(lines)),
  };
}

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeZone: 'Asia/Kolkata' }).format(
    value,
  );
}
