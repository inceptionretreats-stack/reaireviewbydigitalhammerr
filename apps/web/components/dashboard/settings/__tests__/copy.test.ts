import { describe, expect, it } from 'vitest';
import {
  describeOtherSessions,
  describePasswordChangeSessions,
  describeSignedOutSessions,
} from '../copy';

/**
 * SET-01-02 is satisfied by the sweep, but only *seen* to be satisfied by this sentence, so the
 * three cases each get a test: none, one, several. The zero case is the one worth pinning — a
 * message that claims sessions were signed out when none were is how an owner stops believing the
 * next confirmation, and it is the easy case to break while adding pluralisation.
 */
describe('describeOtherSessions', () => {
  it('says plainly when nothing else is signed in', () => {
    expect(describeOtherSessions(0)).toMatch(/no other sessions/i);
  });

  it('reads as English for one', () => {
    expect(describeOtherSessions(1)).toBe('One other session is signed in.');
  });

  it('counts several', () => {
    expect(describeOtherSessions(4)).toBe('4 other sessions are signed in.');
  });

  it('treats a negative count as none rather than printing it', () => {
    expect(describeOtherSessions(-2)).toBe(describeOtherSessions(0));
  });
});

describe('describeSignedOutSessions', () => {
  it('does not claim a sweep that had nothing to do', () => {
    expect(describeSignedOutSessions(0)).toBe('There were no other sessions to sign out.');
  });

  it('reads as English for one', () => {
    expect(describeSignedOutSessions(1)).toBe('One other session was signed out.');
  });

  it('counts several', () => {
    expect(describeSignedOutSessions(3)).toBe('3 other sessions were signed out.');
  });

  it('speaks in the past tense, because the sweep has already happened', () => {
    expect(describeSignedOutSessions(2)).toMatch(/were signed out/);
    expect(describeSignedOutSessions(2)).not.toMatch(/will/);
  });
});

/**
 * The half of POST /api/v1/account/password that an owner can see.
 *
 * The password is committed before the sweep and the rotation run, so those can fail with the
 * credential already replaced. The endpoint reports that as `sessions_swept: false` on a 200, and
 * these tests pin the only thing that must not happen next: the screen claiming a sweep, or claiming
 * this browser is still signed in, on a request where neither is known.
 */
describe('describePasswordChangeSessions', () => {
  it('reports the sweep and the kept session when the sweep completed', () => {
    expect(describePasswordChangeSessions(true, 2)).toBe(
      '2 other sessions were signed out. You are still signed in here.',
    );
  });

  it('is honest about a completed sweep that had nothing to sign out', () => {
    expect(describePasswordChangeSessions(true, 0)).toMatch(/no other sessions to sign out/i);
  });

  it('claims no sweep when the sweep did not finish', () => {
    const line = describePasswordChangeSessions(false, 0);
    expect(line).not.toMatch(/were signed out/i);
    expect(line).not.toMatch(/still signed in/i);
  });

  it('points at the retry when the sweep did not finish', () => {
    expect(describePasswordChangeSessions(false, 0)).toMatch(/Log out other sessions/);
  });

  it('never reports a count the failed path cannot vouch for', () => {
    // A count can survive in the payload while the sweep threw afterwards; it must not be read.
    expect(describePasswordChangeSessions(false, 3)).not.toMatch(/3/);
  });
});
