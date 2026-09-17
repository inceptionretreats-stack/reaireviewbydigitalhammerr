import { describe, expect, it } from 'vitest';
import { nextPathAfterLogin } from '../session';

/**
 * Where a sign-in lands (AMENDMENT-027), with the switch passed explicitly so the test needs
 * no environment: an owner always to /app; an admin to enrolment, then the challenge, then
 * /admin — or straight to /admin when MFA is switched off.
 */
describe('nextPathAfterLogin', () => {
  const at = new Date();
  it('routes an admin through enrolment and the challenge when MFA is required', () => {
    expect(
      nextPathAfterLogin({ role: 'SUPER_ADMIN', mfaEnabledAt: null, mfaVerifiedAt: null }, true),
    ).toBe('/login/mfa/enrol');
    expect(
      nextPathAfterLogin({ role: 'SUPER_ADMIN', mfaEnabledAt: at, mfaVerifiedAt: null }, true),
    ).toBe('/login/mfa');
    expect(
      nextPathAfterLogin({ role: 'SUPER_ADMIN', mfaEnabledAt: at, mfaVerifiedAt: at }, true),
    ).toBe('/admin');
    expect(
      nextPathAfterLogin(
        { role: 'BUSINESS_SUPPORT_VIEWER', mfaEnabledAt: null, mfaVerifiedAt: null },
        true,
      ),
    ).toBe('/login/mfa/enrol');
  });

  it('sends an admin straight in when MFA is switched off, and an owner always to /app', () => {
    expect(
      nextPathAfterLogin({ role: 'SUPER_ADMIN', mfaEnabledAt: null, mfaVerifiedAt: null }, false),
    ).toBe('/admin');
    expect(
      nextPathAfterLogin({ role: 'SUPER_ADMIN', mfaEnabledAt: at, mfaVerifiedAt: null }, false),
    ).toBe('/admin');
    expect(
      nextPathAfterLogin({ role: 'BUSINESS_OWNER', mfaEnabledAt: null, mfaVerifiedAt: null }, true),
    ).toBe('/app');
    expect(
      nextPathAfterLogin(
        { role: 'BUSINESS_OWNER', mfaEnabledAt: null, mfaVerifiedAt: null },
        false,
      ),
    ).toBe('/app');
  });
});
