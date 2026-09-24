import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import { cookies } from 'next/headers';
import { env } from './env';

const CHALLENGE_COOKIE = 'dh_google_challenge';
const PENDING_COOKIE = 'dh_google_pending';
const CHALLENGE_TTL_SECONDS = 5 * 60;
const PENDING_TTL_SECONDS = 10 * 60;

interface Challenge {
  nonce: string;
  expiresAt: number;
}

export interface GooglePending {
  flowId: string;
  sub: string;
  email: string;
  fullName: string;
  flow: 'signup' | 'link';
  authoritativeEmail: boolean;
  expiresAt: number;
}

export interface VerifiedGoogleIdentity {
  sub: string;
  email: string;
  fullName: string;
  /** Google is authoritative for current ownership only for Gmail or hosted Workspace email. */
  authoritativeEmail: boolean;
}

function cookieOptions(maxAge: number) {
  return {
    httpOnly: true as const,
    secure: env().NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge,
  };
}

function signature(payload: string, purpose: string): Buffer {
  return createHmac('sha256', env().SESSION_SECRET)
    .update(`google-auth-v1:${purpose}:${payload}`)
    .digest();
}

function encodeSigned(value: Challenge | GooglePending, purpose: string): string {
  const payload = Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${payload}.${signature(payload, purpose).toString('base64url')}`;
}

function decodeSigned(value: string | undefined, purpose: string): unknown {
  if (!value || value.length > 4096) return null;
  const parts = value.split('.');
  if (parts.length !== 2) return null;
  const [payload, supplied] = parts as [string, string];
  if (!/^[A-Za-z0-9_-]+$/.test(payload) || !/^[A-Za-z0-9_-]+$/.test(supplied)) return null;
  const expected = signature(payload, purpose);
  const actual = Buffer.from(supplied, 'base64url');
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as unknown;
  } catch {
    return null;
  }
}

function activeExpiry(value: unknown): value is { expiresAt: number } {
  return (
    value !== null &&
    typeof value === 'object' &&
    Number.isFinite(Reflect.get(value, 'expiresAt')) &&
    Reflect.get(value, 'expiresAt') > Date.now()
  );
}

/** A browser-bound challenge nonce to pass to google.accounts.id.initialize({nonce}). */
export async function issueGoogleChallenge(): Promise<string> {
  const nonce = randomBytes(32).toString('base64url');
  const jar = await cookies();
  jar.set(
    CHALLENGE_COOKIE,
    encodeSigned({ nonce, expiresAt: Date.now() + CHALLENGE_TTL_SECONDS * 1000 }, 'challenge'),
    cookieOptions(CHALLENGE_TTL_SECONDS),
  );
  // A new Google attempt supersedes an older, incomplete registration/link attempt.
  jar.set(PENDING_COOKIE, '', cookieOptions(0));
  return nonce;
}

/** Single-use challenge: remove it before token verification, including on invalid tokens. */
export async function consumeGoogleChallenge(): Promise<string | null> {
  const jar = await cookies();
  const decoded = decodeSigned(jar.get(CHALLENGE_COOKIE)?.value, 'challenge');
  jar.set(CHALLENGE_COOKIE, '', cookieOptions(0));
  if (!activeExpiry(decoded)) return null;
  const nonce = Reflect.get(decoded, 'nonce');
  return typeof nonce === 'string' && /^[A-Za-z0-9_-]{43}$/.test(nonce) ? nonce : null;
}

export async function setGooglePending(
  input: Omit<GooglePending, 'flowId' | 'expiresAt'>,
): Promise<void> {
  const jar = await cookies();
  jar.set(
    PENDING_COOKIE,
    encodeSigned(
      {
        ...input,
        flowId: randomBytes(24).toString('base64url'),
        expiresAt: Date.now() + PENDING_TTL_SECONDS * 1000,
      },
      'pending',
    ),
    cookieOptions(PENDING_TTL_SECONDS),
  );
}

export async function readGooglePending(): Promise<GooglePending | null> {
  const jar = await cookies();
  const decoded = decodeSigned(jar.get(PENDING_COOKIE)?.value, 'pending');
  if (!activeExpiry(decoded)) return null;
  const flowId = Reflect.get(decoded, 'flowId');
  const sub = Reflect.get(decoded, 'sub');
  const email = Reflect.get(decoded, 'email');
  const fullName = Reflect.get(decoded, 'fullName');
  const flow = Reflect.get(decoded, 'flow');
  const authoritativeEmail = Reflect.get(decoded, 'authoritativeEmail');
  if (
    typeof flowId !== 'string' ||
    !/^[A-Za-z0-9_-]{32}$/.test(flowId) ||
    typeof sub !== 'string' ||
    !/^[0-9]{1,255}$/.test(sub) ||
    typeof email !== 'string' ||
    email.length > 320 ||
    typeof fullName !== 'string' ||
    fullName.length > 120 ||
    (flow !== 'signup' && flow !== 'link') ||
    typeof authoritativeEmail !== 'boolean'
  ) {
    return null;
  }
  return { flowId, sub, email, fullName, flow, authoritativeEmail, expiresAt: decoded.expiresAt };
}

export async function clearGooglePending(): Promise<void> {
  (await cookies()).set(PENDING_COOKIE, '', cookieOptions(0));
}

/** The Google library checks signature, issuer, audience and expiry using rotating Google keys. */
export async function verifyGoogleCredential(
  credential: string,
  nonce: string,
): Promise<VerifiedGoogleIdentity | null> {
  const clientId = env().GOOGLE_CLIENT_ID;
  if (!clientId || credential.length > 8192 || credential.length < 100) return null;
  try {
    const ticket = await new OAuth2Client().verifyIdToken({
      idToken: credential,
      audience: clientId,
    });
    const payload = ticket.getPayload();
    if (
      !payload ||
      payload.nonce !== nonce ||
      typeof payload.sub !== 'string' ||
      !/^[0-9]{1,255}$/.test(payload.sub) ||
      typeof payload.email !== 'string' ||
      !payload.email_verified
    ) {
      return null;
    }
    const email = payload.email.trim().toLowerCase();
    if (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
    const fullName = (typeof payload.name === 'string' ? payload.name.trim() : '').slice(0, 80);
    return {
      sub: payload.sub,
      email,
      fullName,
      authoritativeEmail: email.endsWith('@gmail.com') || Boolean(payload.hd),
    };
  } catch {
    // Never log an ID token or Google library error; either can disclose private claims.
    return null;
  }
}
