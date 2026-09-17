import { z } from 'zod';

/** AUTH-01. Mirrors SignupRequest in 08_OpenAPI_v1.yaml, with the pack's stated field rules. */
export const signupRequest = z.object({
  full_name: z.string().min(2).max(80),
  email: z.email(),
  mobile: z.string().min(8).max(20),
  password: z.string().min(12).max(256),
  // Literal true, not boolean: an unchecked box is not a valid signup (AUTH-01).
  accept_terms: z.literal(true),
});
export type SignupRequest = z.infer<typeof signupRequest>;

export const loginRequest = z.object({
  email: z.email(),
  password: z.string().min(1).max(256),
  remember_me: z.boolean().optional(),
});
export type LoginRequest = z.infer<typeof loginRequest>;

export const forgotPasswordRequest = z.object({ email: z.email() });
export type ForgotPasswordRequest = z.infer<typeof forgotPasswordRequest>;

export const resetPasswordRequest = z.object({
  token: z.string().min(20),
  password: z.string().min(12).max(256),
});
export type ResetPasswordRequest = z.infer<typeof resetPasswordRequest>;

/**
 * AMENDMENT-027 — admin MFA. A code is six digits, spaces tolerated; a recovery code is two
 * groups of five from the unambiguous alphabet the service generates, hyphen optional.
 */
export const mfaCode = z
  .string()
  .trim()
  .transform((value) => value.replace(/\s/g, ''))
  .pipe(z.string().regex(/^\d{6}$/, 'Enter the 6-digit code from your authenticator app.'));
export const mfaChallengeRequest = z.object({ code: mfaCode });
export type MfaChallengeRequest = z.infer<typeof mfaChallengeRequest>;
export const mfaEnrolConfirmRequest = z.object({ code: mfaCode });
export const mfaRecoveryRequest = z.object({
  recovery_code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z2-9]{5}-?[A-Z2-9]{5}$/, 'Enter one of your recovery codes.'),
});
export type MfaRecoveryRequest = z.infer<typeof mfaRecoveryRequest>;

/** AMENDMENT-027 — accepting an admin or support-viewer invitation (Flow B link). */
export const inviteAcceptRequest = z.object({
  token: z.string().min(20),
  password: z.string().min(12).max(256),
});
export type InviteAcceptRequest = z.infer<typeof inviteAcceptRequest>;
