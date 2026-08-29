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
