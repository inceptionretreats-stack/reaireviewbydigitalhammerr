import { describe, expect, it } from 'vitest';
import { reportableRevoked } from '../session-count';

/**
 * SET-01-02 asks that session revocation work and, on this screen, that it be seen to work. The
 * figure the owner reads is the whole visible effect, so what it is allowed to claim matters.
 *
 * `SessionService.revokeAllForUser` revokes every row that is not already revoked, which includes
 * sessions that had expired — unusable, but never marked. Reporting its raw count would describe
 * dead rows as devices, and an owner who reads "3 other sessions" on a laptop they used once starts
 * looking for an intruder who is not there.
 */
describe('reportableRevoked', () => {
  it('reports the live count when the sweep found exactly those sessions', () => {
    expect(reportableRevoked(2, 2)).toBe(2);
  });

  it('ignores expired rows the sweep also revoked', () => {
    // Two live devices, plus three rows that had already expired without being revoked.
    expect(reportableRevoked(2, 5)).toBe(2);
  });

  it('never claims more than the sweep actually revoked', () => {
    // A session that expired between the count and the sweep: counted as live, revoked anyway,
    // but the smaller figure is the one that is definitely true.
    expect(reportableRevoked(3, 2)).toBe(2);
  });

  it('reports nothing when there was nothing else signed in', () => {
    expect(reportableRevoked(0, 0)).toBe(0);
  });

  it('cannot report a negative number', () => {
    expect(reportableRevoked(-1, 0)).toBe(0);
  });
});
