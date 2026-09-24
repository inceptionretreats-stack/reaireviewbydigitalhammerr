import { describe, expect, it } from 'vitest';
import { isShell, SHELL_CATEGORY, shellBusinessName } from '../tenant-shell';

/**
 * The signup shell (AUTH-01-01).
 *
 * businesses.name and .category are NOT NULL but signup collects neither, so the shell carries
 * placeholders until ONB-01. These are safe only because the row is DRAFT and every public
 * surface gates on status = 'ACTIVE' — isShell is what lets the publish transaction refuse to
 * make a placeholder tenant live.
 */
describe('signup business shell', () => {
  it('seeds the business name from the owner name', () => {
    expect(shellBusinessName('Asha Sharma')).toBe('Asha Sharma');
  });

  it('trims and truncates to the column width', () => {
    expect(shellBusinessName('  Asha  ')).toBe('Asha');
    expect(shellBusinessName('x'.repeat(300))).toHaveLength(160);
  });

  it('never yields an empty name, since the column is NOT NULL', () => {
    expect(shellBusinessName('   ')).toBe('My business');
    expect(shellBusinessName('')).toBe('My business');
  });

  it('recognises an unfinished tenant', () => {
    expect(isShell('Asha Sharma', SHELL_CATEGORY)).toBe(true);
    expect(isShell('   ', 'Restaurant')).toBe(true);
  });

  it('recognises a completed tenant', () => {
    expect(isShell('Demo South Cafe', 'Restaurant')).toBe(false);
  });
});
