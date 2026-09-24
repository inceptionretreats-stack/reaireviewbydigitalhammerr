import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  verifyIdToken: vi.fn(),
  clientId: '123-test.apps.googleusercontent.com' as string | undefined,
}));

vi.mock('google-auth-library', () => ({
  OAuth2Client: class {
    verifyIdToken = mocks.verifyIdToken;
  },
}));
vi.mock('@/lib/infra/env', () => ({ env: () => ({ GOOGLE_CLIENT_ID: mocks.clientId }) }));

import { verifyGoogleCredential } from '../google-auth';

const CREDENTIAL = 'signed-google-id-token.'.repeat(8);
const NONCE = 'browser-bound-nonce';

function payload(overrides: Record<string, unknown> = {}) {
  return {
    sub: '12345678901234567890',
    email: 'owner@gmail.com',
    email_verified: true,
    name: 'Example Owner',
    nonce: NONCE,
    ...overrides,
  };
}

function returnPayload(value: Record<string, unknown> | null) {
  mocks.verifyIdToken.mockResolvedValue({ getPayload: () => value });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.clientId = '123-test.apps.googleusercontent.com';
  returnPayload(payload());
});

describe('Google ID-token verification boundary', () => {
  it('asks the Google library to verify the exact token for this web client', async () => {
    await expect(verifyGoogleCredential(CREDENTIAL, NONCE)).resolves.toMatchObject({
      sub: '12345678901234567890',
    });
    expect(mocks.verifyIdToken).toHaveBeenCalledExactlyOnceWith({
      idToken: CREDENTIAL,
      audience: '123-test.apps.googleusercontent.com',
    });
  });

  it('fails closed when Google rejects the signature, audience, issuer, or expiry', async () => {
    mocks.verifyIdToken.mockRejectedValueOnce(new Error('untrusted token'));
    await expect(verifyGoogleCredential(CREDENTIAL, NONCE)).resolves.toBeNull();
  });

  it('rejects an ID token issued for another browser nonce', async () => {
    returnPayload(payload({ nonce: 'different-browser-nonce' }));
    await expect(verifyGoogleCredential(CREDENTIAL, NONCE)).resolves.toBeNull();
  });

  it('rejects an unverified email and a missing subject', async () => {
    returnPayload(payload({ email_verified: false }));
    await expect(verifyGoogleCredential(CREDENTIAL, NONCE)).resolves.toBeNull();

    returnPayload(payload({ sub: undefined }));
    await expect(verifyGoogleCredential(CREDENTIAL, NONCE)).resolves.toBeNull();
  });

  it('uses Google sub as identity and normalizes an authoritative Gmail address', async () => {
    returnPayload(payload({ email: '  Owner@Gmail.Com  ', name: '  Example Owner  ' }));
    await expect(verifyGoogleCredential(CREDENTIAL, NONCE)).resolves.toEqual({
      sub: '12345678901234567890',
      email: 'owner@gmail.com',
      fullName: 'Example Owner',
      authoritativeEmail: true,
    });
  });

  it('treats a Google Workspace hosted address as authoritative', async () => {
    returnPayload(payload({ email: 'owner@business.example', hd: 'business.example' }));
    await expect(verifyGoogleCredential(CREDENTIAL, NONCE)).resolves.toMatchObject({
      email: 'owner@business.example',
      authoritativeEmail: true,
    });
  });

  it('does not treat a verified third-party email as currently authoritative', async () => {
    returnPayload(payload({ email: 'owner@external.example', hd: undefined }));
    await expect(verifyGoogleCredential(CREDENTIAL, NONCE)).resolves.toMatchObject({
      email: 'owner@external.example',
      authoritativeEmail: false,
    });
  });

  it('refuses to verify when the web client ID is not configured', async () => {
    mocks.clientId = undefined;
    await expect(verifyGoogleCredential(CREDENTIAL, NONCE)).resolves.toBeNull();
    expect(mocks.verifyIdToken).not.toHaveBeenCalled();
  });

  it('rejects malformed or oversized token input before calling Google', async () => {
    await expect(verifyGoogleCredential('short', NONCE)).resolves.toBeNull();
    await expect(verifyGoogleCredential('x'.repeat(8193), NONCE)).resolves.toBeNull();
    expect(mocks.verifyIdToken).not.toHaveBeenCalled();
  });
});
