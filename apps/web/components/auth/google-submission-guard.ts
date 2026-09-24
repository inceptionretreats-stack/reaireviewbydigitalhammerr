export type GoogleSubmissionPhase = 'preparing' | 'ready' | 'submitting' | 'complete';

/** Claim synchronously: two GIS callbacks in the same tick cannot both submit one nonce. */
export function claimGoogleCredential(phase: { current: GoogleSubmissionPhase }): boolean {
  if (phase.current !== 'ready') return false;
  phase.current = 'submitting';
  return true;
}
