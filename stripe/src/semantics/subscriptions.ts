// Stripe's subscriptions operations (docs/contributing/architecture.md, "What an author writes"): each handler over the
// handler contract's context, computing with the engine (../engine/).
import type { HandlerContext } from '@volter/world-core';
import { type Row } from '../engine/common.ts';
import { keptAfter } from '../engine/renewals.ts';
import { asBool, nowUnix, subscriptionCouponParam, subscriptionHasPrice, subscriptionItemEntries } from '../engine/stripe.ts';
import { pauseCollection, SUB } from '../engine/subscriptions.ts';
import { resourceView, advanceBilling, applyItemChanges, applyTrialEnd, at, clockNow, collectSubscriptionInvoice, expanded, itemChangesRefused, list, newest, redeemCoupon, replacedDiscounts, subMissing, trialEndBlocked, trialEndRefused, where } from './shared.ts';
import { deletedDiscount } from '../engine/common.ts';
import { fail } from './shared.ts';
// canceling keeps the subscription, now canceled, stamped with when it was canceled and ended
// (https://docs.stripe.com/api/subscriptions/object#subscription_object-canceled_at, #subscription_object-ended_at)
export async function DeleteSubscriptionsSubscriptionExposedId(ctx: HandlerContext): Promise<Response> {
  const id = at(ctx, 'subscription_exposed_id');
  const sub = resourceView(ctx, SUB, id);
  if (!sub) return subMissing(ctx, id);
  const refused = ctx.legal(SUB, 'status', 'DeleteSubscriptionsSubscriptionExposedId', sub.status, undefined, id);
  if (refused) return ctx.refuse(refused);
  const now = nowUnix(ctx.occurredAt);
  // why it was canceled: the request's `cancellation_details` ("Details about why this subscription was cancelled"), and
  // the reason Stripe records for a cancel asked through the API, as the cancel page's example answers it:
  // `"reason": "cancellation_requested"` (docs.stripe.com/api/subscriptions/cancel)
  const given = ctx.params.cancellation_details && typeof ctx.params.cancellation_details === 'object' ? (ctx.params.cancellation_details as Row) : {};
  const cancellation_details = { comment: given.comment ?? null, feedback: given.feedback ?? null, reason: 'cancellation_requested' };
  return ctx.reply(ctx.expand(SUB, await ctx.write(SUB, id, { status: 'canceled', canceled_at: now, ended_at: now, cancellation_details }, 'subscription.cancel')));
}

export async function GetSubscriptions(ctx: HandlerContext): Promise<Response> {
  await advanceBilling(ctx);
  return list(ctx, SUB, where(ctx, newest(ctx, SUB), {
    customer: (s, v) => s.customer === v,
    status: (s, v) => (v === 'all' ? true : s.status === v),
    price: (s, v) => subscriptionHasPrice(s, String(v)),
  }));
}

export async function GetSubscriptionsSubscriptionExposedId(ctx: HandlerContext): Promise<Response> {
  const id = at(ctx, 'subscription_exposed_id');
  await advanceBilling(ctx, (sub) => sub.id === id);
  const sub = resourceView(ctx, SUB, id);
  return sub ? ctx.reply(expanded(ctx, SUB, sub)) : subMissing(ctx, id);
}

export async function PostSubscriptionsSubscriptionExposedId(ctx: HandlerContext): Promise<Response> {
  const id = at(ctx, 'subscription_exposed_id');
  // a period that has already ended renews (or a trial that has, ends) before the update applies (renewals.ts)
  await advanceBilling(ctx, (s) => s.id === id);
  const sub = resourceView(ctx, SUB, id);
  if (!sub) return subMissing(ctx, id);
  const params = ctx.params;
  const now = clockNow(ctx, sub.customer);
  const badTrial = trialEndRefused(ctx, params.trial_end, now);
  if (badTrial) return badTrial;
  // the update's instructions are no attributes of the subscription (docs.stripe.com/api/subscriptions/object lists none)
  const { payment_behavior: _pb, proration_behavior: _prb, proration_date: _pd, trial_from_plan: _tfp, ...attributes } = params;
  const fields: Row = { ...attributes };
  let op = 'subscription.update';
  if ('pause_collection' in params) op = pauseCollection(params.pause_collection, fields) ?? op;
  const couponId = subscriptionCouponParam(params);
  const discounts = couponId !== undefined ? replacedDiscounts(ctx, couponId, sub) : undefined;
  if (discounts instanceof Response) return discounts;
  // `items` changes the subscription's items, never replaces the list with the request (applyItemChanges); every
  // entry is checked before a trial's end is judged payable
  const itemsRefused = 'items' in params ? itemChangesRefused(ctx, id, subscriptionItemEntries(params.items)) : undefined;
  if (itemsRefused) return itemsRefused;
  const blocked = 'trial_end' in params ? trialEndBlocked(ctx, sub, discounts) : undefined;
  if (blocked) return blocked;
  if ('items' in params) {
    await applyItemChanges(ctx, id, subscriptionItemEntries(params.items));
    delete fields.items;
  }
  if (discounts) fields.discounts = discounts;
  if (discounts && discounts.length) await redeemCoupon(ctx, couponId);
  delete fields.coupon;
  // `trial_end`: the trial ended now (its period's invoice made, to collect below) or moved (applyTrialEnd)
  const trial = 'trial_end' in params ? await applyTrialEnd(ctx, sub, fields, now) : undefined;
  // scheduling a cancel at the period's end sets when it will be canceled (the period's end as this update leaves it),
  // and withdrawing it clears that (docs.stripe.com/api/subscriptions/object#subscription_object-cancel_at); a
  // scheduled cancel follows a period this update moves
  if ('cancel_at_period_end' in params) {
    fields.cancel_at_period_end = asBool(params.cancel_at_period_end);
    Object.assign(fields, fields.cancel_at_period_end ? { cancel_at: fields.current_period_end ?? sub.current_period_end ?? null, canceled_at: Number(nowUnix(ctx.occurredAt)) } : { cancel_at: null, canceled_at: null });
  } else if (sub.cancel_at_period_end === true && fields.current_period_end !== undefined) fields.cancel_at = fields.current_period_end;
  if (trial?.invoice) {
    // the trial's end is charged at once: paid (or nothing due), the subscription is active; not, past_due
    // (applyTrialEnd; the move was asked in trialEndBlocked). Finalizing the invoice spends a `once` coupon, this
    // update's own among them.
    const pays = await collectSubscriptionInvoice(ctx, trial.invoice, now, 'api', { ...(trial.payer ? { payer: trial.payer } : {}), attempt: trial.attempt });
    fields.status = pays ? 'active' : 'past_due';
    if (fields.discounts !== undefined) fields.discounts = keptAfter(fields.discounts as Row[], ctx.get('invoice', trial.invoice) ?? {});
  }
  return ctx.reply(ctx.expand(SUB, await ctx.write(SUB, id, fields, op)));
}



export async function DeleteSubscriptionsSubscriptionExposedIdDiscount(ctx: HandlerContext): Promise<Response> {
  const id = at(ctx, 'subscription_exposed_id');
  const sub = resourceView(ctx, SUB, id);
  if (!sub) return subMissing(ctx, id);
  // source: spec:DeleteSubscriptionsSubscriptionExposedIdDiscount "Removes the currently applied discount on a subscription."
  const current = ((sub.discounts as unknown[] | undefined) ?? [])[0] ?? sub.discount;
  // Where the documentation stops and the twin decides: a subscription with no discount answers its absence as a missing resource.
  if (!current) return fail(ctx, `No active discount for subscription: '${id}'`, 404, 'resource_missing');
  await ctx.write(SUB, id, { discounts: [] }, 'subscription.update');
  return ctx.reply(deletedDiscount(typeof current === 'string' ? { id: current } : { ...(current as Row), subscription: id }, nowUnix(ctx.occurredAt)));
}
