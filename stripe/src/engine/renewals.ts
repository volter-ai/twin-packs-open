// A subscription's invoices over time: the first one Checkout pays, and each renewal. Time's moves are made
// as the twin's trial end already made them: caught up to the customer's clock (the World's, or its test
// clock) whenever the twin is asked anything (./front.ts), each checked against the machines in
// ../manifest.ts.
//
// - Checkout's subscription session pays the first invoice with the card the customer entered, which becomes the
//   subscription's default payment method (docs.stripe.com/payments/checkout/how-checkout-works); nothing is due
//   on a trial's.
// - At each period's end Stripe drafts a `subscription_cycle` invoice for the next period and advances the
//   period; a trial's end is the first such renewal, and the subscription is active from then
//   (docs.stripe.com/billing/subscriptions/overview#how-payments-work-subscriptions,
//   docs.stripe.com/billing/subscriptions/trials).
// - About an hour after, Stripe finalizes the draft and charges the subscription's default payment method,
//   else the customer's (docs.stripe.com/invoicing/integration/workflow-transitions#finalized,
//   docs.stripe.com/api/subscriptions/object#subscription_object-default_payment_method).
// - A declined renewal leaves the invoice open with its attempt counted and the subscription past_due
//   (docs.stripe.com/billing/subscriptions/overview#payment-status); paying the invoice later, through the API
//   (docs.stripe.com/api/invoices/pay) or on the customer portal (docs.stripe.com/customer-management), makes it
//   active again.
//
// Where the documentation stops and the twin decides: Stripe retries a failed renewal on its Smart Retries
// schedule and may then cancel or mark the subscription unpaid; the twin makes no retry (next_payment_attempt
// is null) and leaves it past_due until the invoice is paid. A paused subscription (pause_collection) is not renewed.
// - One set to cancel at its period's end is canceled when the period ends, with no renewal
//   (docs.stripe.com/billing/subscriptions/cancel#cancel-at-end-of-cycle).
import { priceAmount } from './stripe.ts';
import type { Row } from './common.ts';
export const SUB = 'subscription';
export const INV = 'invoice';
export const HOUR = 3600;
/** The statuses a subscription renews in. */
export const RENEWING = ['trialing', 'active', 'past_due'];

export const itemsOf = (sub: Row): Row[] => ((sub.items as { data?: Row[] } | undefined)?.data) ?? [];

/** An item's quantity as it bills: 1 when none is set, and 0 when 0 is (a quantity of 0 bills nothing). */
export function itemQuantity(it: Row): number {
  return it.quantity === undefined || it.quantity === null ? 1 : Math.max(0, Math.trunc(Number(it.quantity) || 0));
}

/** The subscription's discounts with a `once` coupon's spent: "When a subscription uses a coupon with `duration=once`, the
 *  coupon is considered used after the invoice finalizes and is removed from the subscription's `discounts` array"
 *  (docs.stripe.com/billing/subscriptions/coupons#coupon-duration). */
export function unspentDiscounts(discounts: unknown): Row[] {
  return ((discounts as Row[] | undefined) ?? []).filter((d) => !(d && typeof d === 'object' && (d.coupon as Row | undefined)?.duration === 'once'));
}

/** The coupon ids an invoice's discounts name. */
export const couponsOf = (discounts: unknown): Set<string> => new Set(((discounts as Row[] | undefined) ?? []).map((d) => {
  const c = d && typeof d === 'object' ? d.coupon : undefined;
  return typeof c === 'string' ? c : c && typeof c === 'object' ? String((c as Row).id ?? '') : '';
}).filter(Boolean));

/** A subscription's discounts after `invoice` finalizes: less the `once` coupons it took. */
export function keptAfter(discounts: Row[], invoice: Row): Row[] {
  const taken = couponsOf(invoice.discounts);
  return discounts.filter((d) => !(unspentDiscounts([d]).length === 0 && [...couponsOf([d])].some((c) => taken.has(c))));
}

/** A Checkout session's one-time line items as lines of its subscription's first invoice, numbered after its `after` lines. */
export function oneTimeLines(invoiceId: string, sub: Row, items: Row[], after: number, at: number, currency: string) {
  return items.map((it, i) => {
    const price = it.price && typeof it.price === 'object' ? (it.price as Row) : null;
    const quantity = itemQuantity(it);
    return {
      id: `il_twin_${invoiceId}_${after + i + 1}`, object: 'line_item', type: 'subscription',
      amount: priceAmount(price ?? undefined, quantity), currency, quantity, proration: false,
      price, subscription: sub.id, subscription_item: null, invoice_item: null,
      period: { start: at, end: at }, description: typeof it.description === 'string' ? it.description : null,
    };
  });
}
