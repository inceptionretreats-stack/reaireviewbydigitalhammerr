import { MfaService, SecretBox } from '@ai-review/core';
import { db } from '@/lib/infra/db';
import { env } from '@/lib/infra/env';
import { qrDataUri } from '@/lib/qr/qr-image';

/**
 * Admin MFA composition (AMENDMENT-027). The seal key is `APP_ENCRYPTION_KEY`, which the
 * environment contract has required since day one and nothing had used until now.
 */

let box: SecretBox | undefined;

export function mfaService(): MfaService {
  const e = env();
  box ??= new SecretBox(e.APP_ENCRYPTION_KEY);
  return new MfaService(db(), { box, pepper: e.HASH_PEPPER, issuer: e.MFA_ISSUER });
}

/** The enrolment QR, as a data URI the page can put straight into an <img>. */
export function mfaQrDataUri(otpauthUri: string): Promise<string> {
  return qrDataUri(otpauthUri);
}
