import { describe, expect, it } from 'vitest';
import { claimGoogleCredential, type GoogleSubmissionPhase } from '../google-submission-guard';

describe('Google credential callback guard', () => {
  it('accepts only the first callback while a credential is being submitted', () => {
    const phase: { current: GoogleSubmissionPhase } = { current: 'ready' };
    expect(claimGoogleCredential(phase)).toBe(true);
    expect(phase.current).toBe('submitting');
    expect(claimGoogleCredential(phase)).toBe(false);
  });

  it('accepts a retry only after a new challenge is prepared', () => {
    const phase: { current: GoogleSubmissionPhase } = { current: 'preparing' };
    expect(claimGoogleCredential(phase)).toBe(false);
    phase.current = 'ready';
    expect(claimGoogleCredential(phase)).toBe(true);
  });

  it('never resubmits after sign-in completes', () => {
    const phase: { current: GoogleSubmissionPhase } = { current: 'complete' };
    expect(claimGoogleCredential(phase)).toBe(false);
  });
});
