/**
 * The signup placeholder tenant, and how to recognise one.
 *
 * Deliberately free of server-only imports. These three are pure string predicates, but they
 * previously lived in lib/auth/helpers.ts alongside the Argon2 hasher — so a client component
 * reaching for isShell pulled a value import of PasswordHasher (and through it a native module)
 * toward the browser bundle. Keeping them here means the client can share the rule with the
 * server without sharing its dependencies.
 *
 * Signup creates a business row before the owner has entered anything, so every public surface
 * gates on status = 'ACTIVE' and the publish transaction uses isShell to refuse a tenant that is
 * still carrying its placeholders.
 */

export const SHELL_CATEGORY = 'PENDING';

export function shellBusinessName(fullName: string): string {
  return fullName.trim().slice(0, 160) || 'My business';
}

/** True while the tenant still carries its signup placeholders, i.e. onboarding is unfinished. */
export function isShell(name: string, category: string): boolean {
  return category === SHELL_CATEGORY || name.trim().length === 0;
}
