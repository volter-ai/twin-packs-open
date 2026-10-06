// Stripe's checkout operations (docs/contributing/architecture.md, "What an author writes"): each handler over the
// handler contract's context, computing with the engine (../engine/).
import type { HandlerContext } from '@volter/world-core';
import { CS, sessionMethodTypes } from '../engine/checkout.ts';
import type { Row } from '../engine/common.ts';
import { applyCouponDiscount, lineItemEntries, nowUnix, paginate, resolveLineItem } from '../engine/stripe.ts';
import { actingAccount, at, checkoutNoDestination, created, discountOf, fail, finder, noLineItems, path, sessionMissing, sessionTrialRefused } from './shared.ts';

export async function GetCheckoutSessionsSessionLineItems(ctx: HandlerContext): Promise<Response> {
  const s = ctx.get(CS, at(ctx, 'session'));
  if (!s) return sessionMissing(ctx, at(ctx, 'session'));
  // source: spec:GetCheckoutSessionsSessionLineItems "There is also a URL where you can retrieve the full (paginated) list of line items."
  const li = s.line_items as { data?: Row[] } | undefined;
  const { page, hasMore } = paginate(Array.isArray(li?.data) ? li!.data! : [], ctx.params);
  return ctx.reply({ object: 'list', url: path(ctx), has_more: hasMore, data: page });
}

export async function PostCheckoutSessions(ctx: HandlerContext): Promise<Response> {
  const params = ctx.params;
  const mode = typeof params.mode === 'string' ? params.mode : 'payment';
  if (!['payment', 'subscription', 'setup'].includes(mode)) return fail(ctx, 'Invalid mode: must be one of payment, subscription, or setup.', 400, 'parameter_invalid_string_enum');
  const entries = lineItemEntries(params);
  if (mode !== 'setup' && entries.length === 0) return noLineItems(ctx);
  // source: spec:/paths/~1v1~1checkout~1sessions/post/requestBody/content/application~1x-www-form-urlencoded/schema/properties/ui_mode "The UI mode of the Session."
  const custom = params.ui_mode === 'custom';
  if (!custom && (params.success_url === undefined || params.success_url === '')) return fail(ctx, 'Missing required param: success_url.', 400, 'parameter_missing');
  const sessionCurrency = typeof params.currency === 'string' ? params.currency : 'usd';
  const resolved = entries.map((e, i) => resolveLineItem(e, i, sessionCurrency, finder(ctx)));
  const missing = resolved.find((r) => r.priceMissing);
  if (missing) return fail(ctx, `No such price: '${missing.priceMissing}'`, 400, 'resource_missing');
  const items = resolved.map((r) => r.item);
  const now = Number(nowUnix(ctx.occurredAt));
  const trialRefused = sessionTrialRefused(ctx, params.subscription_data, now);
  if (trialRefused) return trialRefused;
  const discount = discountOf(ctx, params, now);
  if (discount instanceof Response) return discount;
  const subtotal = items.reduce((n, it) => n + it.amount_subtotal, 0);
  const off = discount ? applyCouponDiscount(subtotal, discount.coupon) : 0;
  // the hosted page is at Stripe's own host (the World routes it to src/screens/checkout.tsx)
  const id = ctx.mint(CS);
  const fields: Row = {
    mode, status: 'open',
    payment_status: mode === 'setup' ? 'no_payment_required' : 'unpaid',
    ui_mode: custom ? 'custom' : 'hosted',
    ...(custom ? { client_secret: `${id}_secret_${await ctx.secret(`checkout-secret:${id}`)}`, return_url: params.return_url ?? null } : {}),
    allow_promotion_codes: params.allow_promotion_codes === true || params.allow_promotion_codes === 'true',
    url: custom ? null : `https://checkout.stripe.com/c/pay/${id}`, success_url: params.success_url ?? null, cancel_url: params.cancel_url ?? null,
    customer: params.customer ?? null, client_reference_id: params.client_reference_id ?? null,
    customer_email: params.customer_email ?? null,
    // whether paying makes a customer: in payment mode only when asked (`always`), `if_required` by default
    customer_creation: mode === 'payment' ? (params.customer_creation === 'always' ? 'always' : 'if_required') : null,
    amount_subtotal: entries.length ? items.reduce((s, it) => s + it.amount_subtotal, 0) : null,
    amount_total: entries.length ? items.reduce((s, it) => s + it.amount_total, 0) - off : null,
    currency: items[0]?.currency ?? (entries.length ? sessionCurrency : null), line_items: { object: 'list', data: items, has_more: false, url: `/v1/checkout/sessions/${id}/line_items` }, payment_intent: null, subscription: null, setup_intent: null, invoice: null, payment_method_types: sessionMethodTypes(params), expires_at: now + 24 * 3600, custom_fields: [], shipping_options: [], custom_text: { after_submit: null, shipping_address: null, submit: null, terms_of_service_acceptance: null }, automatic_tax: { enabled: false, liability: null, status: null, provider: null }, total_details: { amount_discount: off, amount_shipping: 0, amount_tax: 0 },
    discounts: discount ? [{ coupon: String(discount.coupon.id), promotion_code: discount.promotion ?? null }] : [],
    ...(Array.isArray(params.allowed_payment_method_types) ? { allowed_payment_method_types: params.allowed_payment_method_types.map(String) } : {}),
    metadata: params.metadata && typeof params.metadata === 'object' ? params.metadata : {}, livemode: false,
    // "Details on the state of phone number collection for the session" (docs.stripe.com/api/checkout/sessions/object),
    // off unless the create enables it
    phone_number_collection: { enabled: (params.phone_number_collection as Row | undefined)?.enabled === true || (params.phone_number_collection as Row | undefined)?.enabled === 'true' },
  };
  if (params.subscription_data && typeof params.subscription_data === 'object') fields._subscription_data = params.subscription_data;
  // each line's inline price_data, kept for what the session's line cannot carry: whether it recurs (isOneTime) and the
  // Price a subscription's item is made from at completion (sessionPrices)
  if (mode === 'subscription' && entries.some((e) => e.price_data && typeof e.price_data === 'object')) fields._price_data = entries.map((e) => (e.price_data && typeof e.price_data === 'object' ? e.price_data : null));
  // the hosted page's brand name for this session (screens/checkout.tsx, merchantOf), and the account the session was
  // made on (Stripe-Account: a direct charge), whose name the page shows. Kept apart from `_account`, the books a row is
  // kept on: paying on the hosted page still makes the PaymentIntent and charge on the platform's books (a gap of the
  // twin's direct-charge Checkout), so the session's events stay with them.
  if (params.branding_settings && typeof params.branding_settings === 'object') fields._branding_settings = params.branding_settings;
  if (actingAccount(ctx)) fields._brand_account = actingAccount(ctx);
  // a payment session's payment_intent_data shapes the PaymentIntent paying makes: a destination charge's transfer and
  // the platform's application fee (docs.stripe.com/connect/destination-charges?platform=web&ui=stripe-hosted)
  const pid = params.payment_intent_data && typeof params.payment_intent_data === 'object' ? (params.payment_intent_data as Row) : undefined;
  if (pid && mode === 'payment') {
    const destination = (pid.transfer_data as Row | undefined)?.destination;
    if (destination !== undefined && (typeof destination !== 'string' || !ctx.get('account', destination))) return checkoutNoDestination(ctx, destination);
    fields._payment_intent_data = pid;
  }
  if (discount) fields._discount = { coupon: String(discount.coupon.id), promotion_code: discount.promotion ?? null };
  return ctx.reply(await created(ctx, CS, { id, ...fields }, {}));
}
