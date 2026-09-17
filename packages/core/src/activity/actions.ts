/**
 * Every action the activity log can hold (AMENDMENT-028).
 *
 * A closed list rather than free text, so a filter on the admin screen can offer every action
 * that exists and a typo in a route cannot invent a new one. Names are `area.object.verb`;
 * the outcome (SUCCESS / FAILURE / DENIED) is a separate column, so `auth.login` with
 * outcome FAILURE is a failed sign-in, not a different action.
 */
export const ACTIVITY_ACTIONS = [
  'auth.signup',
  'auth.login',
  'auth.logout',
  'auth.password.change',
  'auth.password.reset.request',
  'auth.password.reset.complete',
  'auth.sessions.revoke_others',
  'auth.mfa.enrolled',
  'auth.mfa.challenge',
  'auth.mfa.recovery_used',
  'auth.mfa.recovery_codes.regenerated',
  'auth.invite.accept',
  'account.update',
  'business.update',
  'business.publish',
  'business.links.replace',
  'business.link.create',
  'business.link.update',
  'business.link.delete',
  'business.links.reorder',
  'business.review_destination.update',
  'business.billing.update',
  'ai.context.update',
  'ai.mode.create',
  'ai.mode.update',
  'ai.mode.activate',
  'ai.test_preview',
  'qr.create',
  'qr.update',
  'qr.download',
  'customer.create',
  'customer.update',
  'customer.delete',
  'review_request.create',
  'review_request.mark_sent',
  'feedback.update',
  'subscription.checkout.start',
  'subscription.checkout.verify',
] as const;

export type ActivityAction = (typeof ACTIVITY_ACTIONS)[number];

const ACTION_SET: ReadonlySet<string> = new Set(ACTIVITY_ACTIONS);

export function isActivityAction(value: string): value is ActivityAction {
  return ACTION_SET.has(value);
}

export type ActivityOutcome = 'SUCCESS' | 'FAILURE' | 'DENIED';
