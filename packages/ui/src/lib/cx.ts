/**
 * Conditional class-name joining.
 *
 * Deliberately not `clsx` or `tailwind-merge`: the kit ships a fixed set of variants, so there
 * is nothing to de-duplicate, and a dependency-free helper keeps `@ai-review/ui` importable by
 * the worker-side render paths without pulling a runtime package in.
 */
export type ClassValue = string | false | null | undefined;

export function cx(...values: readonly ClassValue[]): string {
  return values
    .filter((value): value is string => typeof value === 'string' && value !== '')
    .join(' ');
}
