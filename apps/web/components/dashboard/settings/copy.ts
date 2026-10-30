/**
 * Session wording for SET-01.
 *
 * Separated from the components because it is the part with a decision in it rather than markup,
 * and because it is the sentence that makes SET-01-02 ("session revocation works") visible — a
 * count that reads wrong is the difference between an owner trusting the button and re-clicking it.
 *
 * "Session", never "device" or "person". A session is one browser signed in: the same laptop in two
 * browser profiles is two sessions, and one browser across two people is still one. Calling them
 * devices would be a claim the data cannot support — the same discipline AN-01-02 applies to unique
 * visitors.
 */

/** How many other sessions are currently signed in, for the card's resting state. */
export function describeOtherSessions(count: number): string {
  if (count <= 0) return 'No other sessions are signed in right now.';
  if (count === 1) return 'One other session is signed in.';
  return `${count} other sessions are signed in.`;
}

/**
 * What the sweep did, for the confirmation after it runs.
 *
 * The zero case says so plainly instead of claiming a success. An owner who reads "signed out" when
 * there was nothing to sign out learns not to believe the next message.
 */
export function describeSignedOutSessions(count: number): string {
  if (count <= 0) return 'There were no other sessions to sign out.';
  if (count === 1) return 'One other session was signed out.';
  return `${count} other sessions were signed out.`;
}

/**
 * The sentence under "Your password has been changed".
 *
 * `swept` and `retained` reflect the response from POST /api/v1/account/password. Durable writes
 * now commit together; cookie delivery happens afterward and can still fail. Never claim this
 * browser stayed signed in when it did not receive the rotated token.
 */
export function describePasswordChangeSessions(
  swept: boolean,
  signedOut: number,
  retained = true,
): string {
  if (!swept) {
    return 'We could not sign out your other sessions — use “Log out other sessions” below.';
  }
  if (!retained) {
    return `${describeSignedOutSessions(signedOut)} Please sign in again with your new password.`;
  }
  return `${describeSignedOutSessions(signedOut)} You are still signed in here.`;
}
