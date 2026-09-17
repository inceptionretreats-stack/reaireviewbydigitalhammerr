import { createHmac } from 'node:crypto';
import type { Page } from '@playwright/test';

/**
 * A minimal RFC 6238 implementation for the suite, independent of the one under test —
 * the point of the E2E is that a real authenticator app and the server agree, so the test
 * must not borrow the server's code.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32ToBytes(text: string): Buffer {
  const clean = text.toUpperCase().replace(/[\s-=]/g, '');
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const char of clean) {
    value = (value << 5) | ALPHABET.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function totpCode(secretBase32: string, timeMs = Date.now(), offsetSteps = 0): string {
  const step = BigInt(Math.floor(timeMs / 30_000)) + BigInt(offsetSteps);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(step);
  const mac = createHmac('sha1', base32ToBytes(secretBase32)).update(message).digest();
  const offset = mac[19]! & 0x0f;
  const binary =
    ((mac[offset]! & 0x7f) << 24) |
    (mac[offset + 1]! << 16) |
    (mac[offset + 2]! << 8) |
    mac[offset + 3]!;
  return String(binary % 1_000_000).padStart(6, '0');
}

/** The secret the suite arms on the demo admin with `create-admin --totp-secret`. */
export const E2E_ADMIN_TOTP_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

/**
 * A code is accepted once per 30-second step (replay protection), and a suite signs the admin
 * in several times a minute. Like a second device whose clock runs slightly ahead, the helper
 * uses the next step when the current one has already been spent — the server accepts one
 * step of drift — and waits for the clock when even that is gone.
 */
const spentSteps = new Map<string, bigint>();

export async function freshTotpCode(secretBase32: string): Promise<string> {
  for (;;) {
    const now = Date.now();
    const current = BigInt(Math.floor(now / 30_000));
    const spent = spentSteps.get(secretBase32) ?? -1n;
    const candidate = spent >= current ? spent + 1n : current;
    if (candidate <= current + 1n) {
      spentSteps.set(secretBase32, candidate);
      return totpCode(secretBase32, now, Number(candidate - current));
    }
    await new Promise((resolve) => setTimeout(resolve, 30_000 - (now % 30_000) + 200));
  }
}

/**
 * Signs an admin in through the password screen and the MFA challenge.
 *
 * `freshTotpCode` only knows the steps this process spent; another process (a probe, a
 * previous run) may have used the same step seconds ago, and the server then refuses the code
 * as a replay. When that happens the helper asks for the next step (or waits for the clock)
 * and tries again rather than failing on a clock accident.
 */
export async function signInAdmin(
  page: Page,
  who: { email: string; password: string; totpSecret?: string },
): Promise<void> {
  const secret = who.totpSecret ?? E2E_ADMIN_TOTP_SECRET;
  await page.goto('/login');
  await page.getByLabel(/email/i).fill(who.email);
  await page.getByLabel(/password/i).fill(who.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(/\/login\/mfa/);
  for (let attempt = 0; ; attempt += 1) {
    await page.getByLabel(/authenticator code/i).fill(await freshTotpCode(secret));
    const [response] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/v1/auth/mfa/challenge')),
      page.getByRole('button', { name: /^continue$/i }).click(),
    ]);
    if (response.ok()) break;
    if (attempt >= 2) throw new Error(`MFA challenge refused (${response.status()}) three times.`);
  }
  await page.waitForURL(/\/admin/);
}
