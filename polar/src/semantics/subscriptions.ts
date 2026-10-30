// Subscriptions: started when a checkout of a recurring product is paid (./checkouts.ts), read back by the application,
// set to end with their period or set to renew again (`cancel_at_period_end`); the period's end is ./clock.ts's.
import type { HandlerContext } from '@volter/world-core';
import { among, bodyOf, customerBy, fail, missing, newest, rowOf, rowsOf, notFound, SUBSCRIPTION, subscriptionView } from './shared.ts';

/** The organization is the request's environment; Subscription does not expose organization_id. */
// source: spec:subscriptions:get "Get a subscription by ID."
export async function subscriptions_get(ctx: HandlerContext): Promise<Response> {
  const subscription = rowOf(ctx, SUBSCRIPTION, String(ctx.call.params.id));
  return subscription ? Response.json(subscriptionView(ctx, subscription)) : notFound('Subscription');
}

/** `GET /v1/subscriptions/`: the organization's subscriptions, the latest started first, by customer (Polar's id or the
 *  application's), product or status. */
// source: spec:subscriptions:list "List subscriptions."
export async function subscriptions_list(ctx: HandlerContext): Promise<Response> {
  const external = ctx.params.external_customer_id === undefined ? undefined : ([] as unknown[]).concat(ctx.params.external_customer_id).map((x) => String(customerBy(ctx, { external: String(x) })?.id));
  // source: spec:subscriptions:list "Filter by active or inactive subscription."
  const active = ctx.params.active === undefined ? undefined : String(ctx.params.active) === 'true';
  const rows = rowsOf(ctx, SUBSCRIPTION)
    .filter((s) => among(ctx, 'customer_id', s.customer_id) && among(ctx, 'product_id', s.product_id) && among(ctx, 'status', s.status))
    .filter((s) => external === undefined || external.includes(String(s.customer_id)))
    .filter((s) => active === undefined || ['trialing', 'active', 'past_due'].includes(String(s.status)) === active)
    .sort(newest('started_at'));
  return ctx.list('Subscription', rows.map((s) => subscriptionView(ctx, s)));
}

/** `PATCH /v1/subscriptions/{id}` in its cancellation form: `cancel_at_period_end: true` ends an active subscription with
 *  its period instead of renewing it; `false` undoes that while the period runs. The update's other forms (seats, billing
 *  period, revoke, pause, resume, discount) stay the gap: a body without `cancel_at_period_end` is answered as that form's
 *  missing field. */
// source: spec:/components/schemas/SubscriptionCancel/properties/cancel_at_period_end "Cancel an active subscription once the current period ends."
export async function subscriptions_update(ctx: HandlerContext): Promise<Response> {
  const subscription = rowOf(ctx, SUBSCRIPTION, String(ctx.call.params.id));
  if (!subscription) return notFound('Subscription');
  const body = bodyOf(ctx);
  if (typeof body.cancel_at_period_end !== 'boolean') return missing('cancel_at_period_end');
  const cancel = body.cancel_at_period_end;
  // source: spec:subscriptions:update "Subscription is already canceled or will be at the end of the period, or is not active."
  const refused = ctx.legal('Subscription', 'status', 'subscriptions:update', subscription.status, undefined, String(subscription.id), 'api');
  if (refused) return ctx.refuse(refused);
  if (cancel && subscription.cancel_at_period_end === true) return fail(403, 'AlreadyCanceledSubscription', 'Subscription is already canceled or will be at the end of the period, or is not active.');
  const at = ctx.occurredAt;
  // source: spec:/components/schemas/Subscription/properties/canceled_at "The subscription might still be active if `cancel_at_period_end` is `true`."
  await ctx.write(SUBSCRIPTION, String(subscription.id), cancel
    ? { cancel_at_period_end: true, canceled_at: at, ends_at: subscription.current_period_end, modified_at: at }
    : { cancel_at_period_end: false, canceled_at: null, ends_at: null, modified_at: at }, 'subscription.update');
  return Response.json(subscriptionView(ctx, rowOf(ctx, SUBSCRIPTION, String(subscription.id))!));
}
