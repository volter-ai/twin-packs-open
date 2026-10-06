// Subscription and SubscriptionItem semantics. A subscription is created with its items, its
// billing period and, under payment_behavior=default_incomplete, its first invoice and that
// invoice's PaymentIntent; canceling it is the machine's move in ../manifest.ts. Retrieve of a
// subscription and of an item are the derived core's.
import type { Row } from './common.ts';
export const SUB = 'subscription';

// pause_collection pauses billing (the subscription stays active; the paused event fires) and
// clearing it resumes; cancel_at_period_end schedules or withdraws a cancel; a coupon replaces the
// discount and an empty one clears it
/** pause_collection pauses billing (the paused event fires) and clearing it resumes
 *  (docs.stripe.com/billing/subscriptions/pause-payment); answers the event, or nothing for a value it does not take. */
export function pauseCollection(pc: unknown, fields: Row): string | undefined {
  const isClear = pc === '' || pc === null || (typeof pc === 'object' && pc !== null && Object.keys(pc as object).length === 0);
  if (isClear) {
    fields.pause_collection = null;
    return 'customer.subscription.resumed';
  }
  if (!pc || typeof pc !== 'object') return undefined;
  const p = pc as Row;
  fields.pause_collection = { behavior: typeof p.behavior === 'string' ? p.behavior : 'void', resumes_at: p.resumes_at !== undefined ? Number(p.resumes_at) : null };
  return 'customer.subscription.paused';
}

/** The longest trial Stripe takes: `trial_end` "Can be at most two years from `billing_cycle_anchor`"
 *  (docs.stripe.com/api/subscriptions/update#update_subscription-trial_end); "The trial period must be 730 days (2 years)
 *  or less" (docs.stripe.com/billing/subscriptions/trials/free-trials). */
export const MAX_TRIAL = 730 * 86400;

/** A trial moved to end at `end`, or a new one to `end` on a subscription out of its trial (applyTrialEnd). */
export function movedTrial(sub: Row, fields: Row, end: number, now: number): undefined {
  Object.assign(fields, {
    status: 'trialing', trial_end: end, trial_start: sub.trial_start ?? now, billing_cycle_anchor: end,
    current_period_end: end, ...(sub.status !== 'trialing' ? { current_period_start: now } : {}),
  });
  return undefined;
}
