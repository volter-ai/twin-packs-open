// Calendar renewals and checkout expiry caught up before each request on the World clock.
import type { HandlerContext } from '@volter/world-core';
import { addInterval, CHECKOUT, makeOrder, rowsOf, SUBSCRIPTION } from './shared.ts';

export async function clock(ctx: HandlerContext): Promise<void> {
  // source: spec:checkouts:client_confirm "The checkout session is expired."
  for (const c of rowsOf(ctx, CHECKOUT).filter((c) => c.status === 'open' && String(c.expires_at) <= ctx.occurredAt)) {
    const due = await ctx.at(String(c.expires_at));
    due.legal('Checkout', 'status', 'checkout.update', 'open', 'expired', String(c.id), 'time');
    await due.write(CHECKOUT, String(c.id), { status: 'expired', modified_at: due.occurredAt }, 'checkout.update');
  }
  // source: https://polar.sh/docs/features/subscriptions/introduction "At the end of each billing period, Polar advances the subscription to the next cycle and creates a new order"
  for (const s of rowsOf(ctx, SUBSCRIPTION).filter((s) => ['trialing', 'active'].includes(String(s.status)))) {
    let end = String(s.current_period_end);
    while (end <= ctx.occurredAt) {
      const due = await ctx.at(end);
      // source: spec:/components/schemas/SubscriptionCancel/properties/cancel_at_period_end "Cancel an active subscription once the current period ends."
      if (s.cancel_at_period_end === true) {
        due.legal('Subscription', 'status', 'subscription.update', String(s.status), 'canceled', String(s.id), 'time');
        await due.write(SUBSCRIPTION, String(s.id), { status: 'canceled', ended_at: end, ends_at: end, modified_at: end }, 'subscription.update');
        break;
      }
      const next = addInterval(end, String(s.recurring_interval), Number(s.recurring_interval_count ?? 1));
      // source: https://polar.sh/docs/features/subscriptions/trials "Once the trial period ends, the customer will be automatically charged for the subscription, and their billing cycle will begin."
      due.legal('Subscription', 'status', 'subscription.update', 'trialing', 'active', String(s.id), 'time');
      await due.write(SUBSCRIPTION, String(s.id), { status: 'active', current_period_start: end, current_period_end: next, modified_at: end }, 'subscription.update');
      await makeOrder(due, { ...s, subscription_id: s.id }, s.status === 'trialing' ? 'subscription_create' : 'subscription_cycle', s.status === 'trialing' ? undefined : { start: String(s.current_period_start), end });
      s.current_period_start = end; s.status = 'active';
      end = next;
    }
  }
}
