import type { HandlerContext } from '@volter/world-core';
import type { Row } from '../engine/common.ts';
import { newCustomer } from '../engine/customers.ts';
import { CS } from '../engine/checkout.ts';
import { applyCouponDiscount, nowUnix, resolveTrial } from '../engine/stripe.ts';
import { cardAnswer, parseExpiry } from './shared.tsx';
import { completeSession, discountOf, created } from '../semantics/shared.ts';

function amount(value: number, currency: string): Row {
  return { amount: new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(value / 100), minorUnitsAmount: value };
}

// source: archive:https://registry.npmjs.org/@stripe/stripe-js/-/stripe-js-8.6.0.tgz#sha256=13e61419e9076ab440cc636e34d3ea5df3fc62bbf2d6a80d3fd718e8cd47f0a2!/package/dist/stripe-js/checkout.d.ts "export interface StripeCheckoutSession"
// The SDK publishes its contract, not its private HTTP wire. This authored payment_pages wire uses the same session store and completion as hosted Checkout.
function view(ctx: HandlerContext, session: Row): Row {
  const currency = String(session.currency ?? 'usd');
  const lines = ((session.line_items as Row)?.data ?? []) as Row[];
  const stored = ctx.row(CS, String(session.id)) ?? session;
  const trial = session.mode === 'subscription' ? resolveTrial((stored._subscription_data as Row) ?? {}, nowUnix(ctx.occurredAt)) : undefined;
  const customer = typeof session.customer === 'string' ? ctx.get('customer', session.customer) : undefined;
  const discount = stored._discount as Row | undefined;
  const promotion = typeof discount?.promotion_code === 'string' ? ctx.get('promotion_code', discount.promotion_code) : undefined;
  const zero = amount(0, currency);
  return {
    id: session.id, billingAddress: null, businessName: null, canConfirm: session.status === 'open', currency,
    currencyOptions: null, discountAmounts: promotion ? [{ ...amount(Number((session.total_details as Row)?.amount_discount ?? 0), currency), promotionCode: promotion.code }] : [],
    email: customer?.email ?? session.customer_email ?? null, lastPaymentError: null,
    lineItems: lines.map(line => ({ id: line.id, name: line.description, quantity: line.quantity, unitAmount: amount(Number(line.amount_subtotal) / Number(line.quantity || 1), currency), total: amount(Number(line.amount_total), currency) })),
    livemode: false, minorUnitsAmountDivisor: 100, phoneNumber: null,
    recurring: session.mode === 'subscription' ? { trial: trial ? { trialEnd: trial.end, trialPeriodDays: Math.ceil((trial.end - trial.start) / 86400) } : null } : null,
    savedPaymentMethods: [], shipping: null, shippingAddress: null, shippingOptions: [],
    status: session.status === 'complete' ? { type: 'complete', paymentStatus: session.payment_status } : { type: session.status },
    tax: { status: 'ready' }, taxAmounts: [], taxIdInfo: null,
    total: { appliedBalance: zero, balanceAppliedToNextInvoice: false, discount: amount(Number((session.total_details as Row)?.amount_discount ?? 0), currency), shippingRate: zero, subtotal: amount(Number(session.amount_subtotal ?? 0), currency), taxExclusive: zero, taxInclusive: zero, total: amount(trial ? 0 : Number(session.amount_total ?? 0), currency) },
  };
}

const failed = (message: string, code: string | null = null): Response => Response.json({ type: 'error', error: { message, code } });

export async function screen(ctx: HandlerContext): Promise<Response> {
  const path = new URL(ctx.call.request.url).pathname;
  const id = path.split('/')[3]!;
  const action = path.split('/')[4];
  const params = ctx.params;
  const session = ctx.get(CS, id);
  // The private client secret is the browser's authority for this session; it never accepts a secret API key.
  if (!session || session.ui_mode !== 'custom' || params.client_secret !== session.client_secret) return failed('Invalid Checkout Session client secret.');
  if (action === 'init') return Response.json({ type: 'success', session: view(ctx, session) });
  if (session.status !== 'open') return failed('This Checkout Session is no longer active.');
  if (action === 'apply_promotion_code' || action === 'remove_promotion_code') {
    if (action === 'apply_promotion_code' && session.allow_promotion_codes !== true) return failed('Promotion codes are not enabled for this Checkout Session.');
    const promotion = action === 'apply_promotion_code' ? ctx.rows('promotion_code').find(p => p.code === params.promotion_code && p.active === true) : undefined;
    if (action === 'apply_promotion_code' && !promotion) return failed('This promotion code is invalid.', 'invalidPromotionCode');
    const discount = promotion ? discountOf(ctx, { discounts: [{ promotion_code: promotion.id }] }, nowUnix(ctx.occurredAt)) : undefined;
    if (discount instanceof Response) return failed('This promotion code is invalid.', 'invalidPromotionCode');
    const off = discount ? applyCouponDiscount(Number(session.amount_subtotal), discount.coupon) : 0;
    const fields = { amount_total: Number(session.amount_subtotal) - off, total_details: { ...(session.total_details as Row), amount_discount: off }, discounts: discount ? [{ coupon: discount.coupon.id, promotion_code: promotion!.id }] : [], _discount: discount ? { coupon: discount.coupon.id, promotion_code: promotion!.id } : null };
    const updated = await ctx.write(CS, id, fields, 'checkout.session.update');
    return Response.json({ type: 'success', session: view(ctx, updated) });
  }
  if (action !== 'confirm') return failed('Unrecognized Checkout action.');
  const values = (params.payment_details ?? {}) as Record<string, string>;
  const stored = ctx.row(CS, id) ?? session;
  const trial = session.mode === 'subscription' ? resolveTrial((stored._subscription_data as Row) ?? {}, nowUnix(ctx.occurredAt)) : undefined;
  const refusal = cardAnswer(values, nowUnix(ctx.occurredAt), !trial);
  if (refusal) return failed(refusal, 'paymentFailed');
  const customer = typeof session.customer === 'string' ? ctx.get('customer', session.customer) : undefined;
  const email = String(customer?.email ?? params.email ?? session.customer_email ?? '');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return failed('Your email address is incomplete.');
  let existing = session;
  if (!customer && session.mode === 'subscription') {
    const cid = ctx.mint('customer');
    const made = await created(ctx, 'customer', { id: cid, email }, { livemode: false, ...newCustomer(cid) });
    existing = { ...session, customer: made.id };
  }
  const expiry = parseExpiry(values.cardExpiry)!;
  const completed = await completeSession(ctx, id, existing, { customer: existing.customer, customer_details: { email, name: values.billingName ?? null, address: null, phone: null, tax_exempt: 'none', tax_ids: [] } }, { number: values.cardNumber.replace(/\D/g, ''), exp_month: expiry.month, exp_year: expiry.year });
  if (completed instanceof Response) return failed('This Checkout Session is no longer active.');
  return Response.json({ type: 'success', session: view(ctx, completed), return_url: session.return_url });
}
