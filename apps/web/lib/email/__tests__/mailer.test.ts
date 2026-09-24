import { afterEach, describe, expect, it, vi } from 'vitest';
import { MailError, ResendTransport, mailer, setMailTransport } from '../mailer';
import { receiptEmail, renewalReminderEmail } from '../email-templates';

const mocks = vi.hoisted(() => ({ env: vi.fn(() => ({ NODE_ENV: 'production' })) }));
vi.mock('../../infra/env', () => ({ env: mocks.env }));

afterEach(() => {
  vi.restoreAllMocks();
  setMailTransport(undefined);
});

/**
 * AMENDMENT-029. The Resend transport is one POST; what matters is the request shape, that a
 * failure is reported with the status only, and that nothing logs a body.
 */
describe('ResendTransport', () => {
  it('posts the email with a bearer key and both text and html parts', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200 }));
    const transport = new ResendTransport({
      apiKey: 're_test_key',
      from: 'no-reply@example.com',
      fetchImpl,
    });
    await transport.send({
      to: 'owner@example.com',
      subject: 'Hi',
      text: 'Body',
      html: '<p>Body</p>',
    });

    const [url, init] = fetchImpl.mock.calls[0]! as unknown as [
      string,
      { headers: Record<string, string>; body: string },
    ];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.headers['Authorization']).toBe('Bearer re_test_key');
    expect(JSON.parse(init.body)).toEqual({
      from: 'no-reply@example.com',
      to: ['owner@example.com'],
      subject: 'Hi',
      text: 'Body',
      html: '<p>Body</p>',
    });
  });

  it('reports a provider failure by status only, never recipient, subject, body or credentials', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 422 }));
    const transport = new ResendTransport({ apiKey: 'private-api-key', from: 'a@b.c', fetchImpl });
    const failure = transport.send({
      to: 'x@y.z',
      subject: 'Private name invoice 123',
      text: 'https://secret-link',
    });
    await expect(failure).rejects.toMatchObject({
      status: 422,
      message: 'mail provider answered 422',
    });
    const logged = error.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(logged).toContain('422');
    expect(logged).not.toContain('secret-link');
    expect(logged).not.toContain('x@y.z');
    expect(logged).not.toContain('Private name');
    expect(logged).not.toContain('private-api-key');
    error.mockRestore();
  });

  it('fails safely when production email is unconfigured', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(
      mailer().send({
        to: 'private-person@example.com',
        subject: 'Private name invoice 456',
        text: 'https://secret-reset-token',
      }),
    ).rejects.toThrow('No mail transport is configured');
    expect(error).toHaveBeenCalledExactlyOnceWith(
      '[mail] NO TRANSPORT CONFIGURED — email was not sent',
    );
  });

  it('turns a network failure into a MailError rather than an unhandled rejection', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNRESET');
    });
    const transport = new ResendTransport({ apiKey: 'k', from: 'a@b.c', fetchImpl });
    await expect(transport.send({ to: 'x@y.z', subject: 's', text: 't' })).rejects.toBeInstanceOf(
      MailError,
    );
    vi.restoreAllMocks();
  });
});

describe('email templates', () => {
  it('escapes business copy in the html twin and keeps the text part self-contained', () => {
    const email = receiptEmail('o@x.com', {
      businessName: 'A&B <Cafe>',
      invoiceNumber: 'DH/2026-27/000001',
      amountLabel: '₹999',
      paidOn: '16 Sept 2026',
      periodLabel: '16 Sept 2026 to 16 Sept 2027',
      receiptUrl: 'https://ai-review-dh.vercel.app/app/subscription/receipts/abc',
    });
    expect(email.subject).toContain('DH/2026-27/000001');
    expect(email.text).toContain('A&B <Cafe>');
    expect(email.text).toContain('receipts/abc');
    expect(email.html).toContain('A&amp;B &lt;Cafe&gt;');
    expect(email.html).not.toContain('<Cafe>');
  });

  it('words a reminder by how soon the year ends, without a star rating or a submission claim', () => {
    const soon = renewalReminderEmail('o@x.com', {
      businessName: 'Cafe',
      expiresAt: new Date('2026-10-01T00:00:00Z'),
      daysLeft: 1,
      renewUrl: 'https://x/app/subscription',
      amountLabel: '₹999',
    });
    expect(soon.subject).toBe('Your Ai Review Pro year ends tomorrow');
    expect(soon.text).not.toMatch(/star|submitted/i);
  });
});
