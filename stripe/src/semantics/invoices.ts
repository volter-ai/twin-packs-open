// Stripe's invoices operations (docs/contributing/architecture.md, "What an author writes"): each handler over the
// handler contract's context, computing with the engine (../engine/).
import type { HandlerContext } from '@volter/world-core';
import type { Row } from '../engine/common.ts';
import { INV, transitions } from '../engine/invoices.ts';
import { asBool, cardError, declineFor, nowUnix } from '../engine/stripe.ts';
import { resourceView, activatedByPayment, at, expanded, finalizeForPayment, finder, invoiceMissing, invoicesLoad, mintCharge, nothingToPayWith, send } from './shared.ts';
import { draft, prorationLines, sumLines } from '../engine/invoices.ts';
import { addBillingInterval, applyCouponDiscount, priceAmount } from '../engine/stripe.ts';
import { created, fail, newest, pendingPreviewLines, pullPendingItem } from './shared.ts';
export async function GetInvoicesInvoice(ctx: HandlerContext): Promise<Response> {
  const id = at(ctx, 'invoice');
  const inv = ctx.get(INV, id);
  return inv ? ctx.reply(expanded(ctx, INV, inv)) : invoiceMissing(ctx, id);
}

// paying charges a payment method (the one passed, the invoice's default, or the customer's) unless
// the payment is recorded out of band; a declining card answers 402 and leaves the invoice open. A
// paid invoice settles the PaymentIntent finalize opened, and names the charge that took the money.
export async function PostInvoicesInvoicePay(ctx: HandlerContext): Promise<Response> {
  const id = at(ctx, 'invoice');
  const found = ctx.get(INV, id);
  if (!found) return invoiceMissing(ctx, id);
  const refused = ctx.legal(INV, 'status', 'PostInvoicesInvoicePay', found.status, undefined, id);
  if (refused) return ctx.refuse(refused);
  // paying a draft finalizes it first, as its finalize does (its number, and the PaymentIntent it collects through)
  // source: https://docs.stripe.com/invoicing/integration "To finalize a draft invoice, use the Dashboard, send it to the customer, or pay it."
  const inv = found.status === 'draft' ? await finalizeForPayment(ctx, found, id) : found;
  const params = ctx.params;
  const paidOutOfBand = params.paid_out_of_band !== undefined && asBool(params.paid_out_of_band);
  const payer = ctx.get('customer', String(inv.customer ?? ''));
  const customerDefault = (payer?.invoice_settings as Row | undefined)?.default_payment_method || payer?.default_source;
  if (!paidOutOfBand && !params.payment_method && !params.source && !inv.default_payment_method && !inv.default_source && !customerDefault) return nothingToPayWith(ctx);
  // what it charges: the method passed, else the invoice's default, its subscription's, then its customer's
  // (docs.stripe.com/api/invoices/pay#pay_invoice-payment_method)
  const subscription = typeof inv.subscription === 'string' ? resourceView(ctx, 'subscription', inv.subscription) : undefined;
  const decline = declineFor(finder(ctx), params, { payment_method: inv.default_payment_method ?? subscription?.default_payment_method ?? customerDefault });
  const intent = typeof inv.payment_intent === 'string' ? ctx.get('payment_intent', inv.payment_intent) : undefined;
  if (decline) return send(ctx, cardError(decline, intent ? { payment_intent: intent } : {}));
  const amountPaid = Number(inv.total ?? inv.amount_due) || 0;
  let body = await ctx.write(INV, id, {
    // paid outside Stripe, the invoice counts it as such: `amount_paid_off_stripe`, "Amount, in cents (or local
    // equivalent), that was paid on the invoice outside of Stripe" (served spec, invoice), the only place the served
    // version shows it now that basil renders no `paid_out_of_band` (../engine/version.ts)
    status: 'paid', paid: true, paid_out_of_band: paidOutOfBand, amount_paid: amountPaid, amount_remaining: 0,
    ...(paidOutOfBand ? { amount_paid_off_stripe: amountPaid } : {}),
    status_transitions: { ...transitions(inv), paid_at: nowUnix(ctx.occurredAt) },
  }, 'invoice.pay');
  if (!paidOutOfBand && typeof inv.payment_intent === 'string' && inv.payment_intent) {
    const pi = ctx.get('payment_intent', inv.payment_intent);
    if (pi && pi.status !== 'succeeded' && !ctx.legal('payment_intent', 'status', 'PostInvoicesInvoicePay', pi.status)) {
      const chargeId = await mintCharge(ctx, inv.payment_intent, { ...pi, invoice: id, ...(typeof params.payment_method === 'string' ? { payment_method: params.payment_method } : {}) }, amountPaid);
      await ctx.write('payment_intent', inv.payment_intent, { status: 'succeeded', amount_received: amountPaid, amount_capturable: 0, next_action: null, latest_charge: chargeId }, 'payment_intent.succeeded');
      body = await ctx.write(INV, id, { charge: chargeId }, 'invoice.update');
    }
  }
  // a subscription waiting on this invoice (incomplete on its first, past_due on a failed renewal) is active once it is paid
  const subId = typeof inv.subscription === 'string' ? inv.subscription : undefined;
  const sub = subId ? resourceView(ctx, 'subscription', subId) : undefined;
  if (subId && sub && (sub.status === 'incomplete' || sub.status === 'past_due') && !ctx.legal('subscription', 'status', 'PostInvoicesInvoicePay', sub.status, 'active', subId)) await activatedByPayment(ctx, subId);
  return ctx.reply(expanded(ctx, INV, ctx.get(INV, id) ?? body));
}

// sending a draft finalizes it; any other invoice keeps its status and records the send

export async function PostInvoicesInvoiceVoid(ctx: HandlerContext): Promise<Response> {
  const loaded = invoicesLoad(ctx, 'PostInvoicesInvoiceVoid');
  if ('answer' in loaded) return loaded.answer;
  const inv = loaded.inv;
  const body = await ctx.write(INV, String(inv.id), { status: 'void', status_transitions: { ...transitions(inv), voided_at: nowUnix(ctx.occurredAt) } }, 'invoice.void');
  return ctx.reply(expanded(ctx, INV, body));
}



// the invoice's lines, a page at a time

// a new invoice pulls in the customer's pending items only when asked: pending_invoice_items_behavior "Defaults to
// `exclude` if the parameter is omitted" (docs.stripe.com/api/invoices/create)
export async function PostInvoices(ctx: HandlerContext): Promise<Response> {
  const params = ctx.params;
  const now = Number(nowUnix(ctx.occurredAt));
  // the lines list names where it can be read, "The URL where this list can be accessed" (served spec, invoice.lines.url)
  const newId = ctx.mint(INV);
  // a send_invoice invoice is due `days_until_due` days "from when the invoice is created" (the same page); the customer's
  // email and name are its own "Until the invoice is finalized, this field will equal customer.email" (served spec,
  // invoice.customer_email; .customer_name likewise)
  const days = Number(params.days_until_due);
  const due = params.collection_method === 'send_invoice' && params.due_date === undefined && Number.isFinite(days) && days > 0 ? { due_date: now + days * 86_400 } : {};
  const holder = typeof params.customer === 'string' ? ctx.get('customer', params.customer) : undefined;
  const snapshot = holder ? { customer_email: holder.email ?? null, customer_name: holder.name ?? null } : {};
  const inv = await created(ctx, INV, { ...params, id: newId }, { ...draft(now), ...due, ...snapshot, lines: { object: 'list', data: [], has_more: false, total_count: 0, url: `/v1/invoices/${newId}/lines` } });
  if (params.pending_invoice_items_behavior !== 'include') return ctx.reply(inv);
  const invoiceId = String(inv.id);
  const customerId = typeof inv.customer === 'string' ? inv.customer : '';
  const pending = customerId ? newest(ctx, 'invoiceitem', 'date').filter((it) => it.customer === customerId && !it.invoice).reverse() : [];
  for (const item of pending) await pullPendingItem(ctx, invoiceId, inv, item, now);
  return ctx.reply(pending.length > 0 ? (ctx.get(INV, invoiceId) ?? inv) : inv);
}



/**
 * A preview of the next invoice for a customer or subscription (create_preview), computed and never
 * stored: the subscription's items at their prices, the customer's pending items, the subscription's
 * discount, and an update's unused-time credit and remaining-time charge at the old and new prices.
 */
export async function PostInvoicesCreatePreview(ctx: HandlerContext): Promise<Response> {
  const params = ctx.params;
  const now = Number(nowUnix(ctx.occurredAt));
  let subId = typeof params.subscription === 'string' ? params.subscription : '';
  let customer = typeof params.customer === 'string' ? params.customer : '';
  let sub: Row | undefined;
  if (subId) {
    sub = resourceView(ctx, 'subscription', subId);
    if (!sub) return fail(ctx, `No such subscription: '${subId}'`, 404, 'resource_missing');
    customer = customer || String(sub.customer ?? '');
  } else if (customer) {
    // no subscription named: the customer's first live one
    sub = newest(ctx, 'subscription').find((s) => s.customer === customer && s.status !== 'canceled');
    subId = sub ? String(sub.id) : '';
  }
  if (!customer) return fail(ctx, 'Missing required param: customer (or subscription).', 400, 'parameter_missing');
  if (!ctx.get('customer', customer)) return fail(ctx, `No such customer: '${customer}'`, 404, 'resource_missing');
  const currency = String((sub?.currency as string) ?? 'usd');
  // the upcoming invoice bills the subscription's next period, its "subscription renewal charges"
  // (docs.stripe.com/api/invoices/create_preview): from the current period's end, one billing interval long
  const renewsAt = sub && Number(sub.current_period_end) > 0 ? Number(sub.current_period_end) : now;
  let itemRows = sub ? ctx.rows('subscription_item').filter((r) => r.subscription === subId) : [];
  const details = params.subscription_details as Row | undefined;
  const previousItems = itemRows;
  // source: https://docs.stripe.com/api/invoices/create_preview.md?query=subscription_details "The default value is"
  const behavior = details?.proration_behavior ?? 'create_prorations';
  // source: https://docs.stripe.com/billing/subscriptions/prorations "The prorated amount is calculated as soon as the API updates the subscription."
  // source: https://docs.stripe.com/api/invoices/create_preview.md?query=subscription_details "forces the proration to be calculated as though the update was done at the specified time."
  const prorationTime = details?.proration_date === undefined ? now : Number(details.proration_date);
  const periodStart = Number(sub?.current_period_start ?? now);
  const periodEnd = Number(sub?.current_period_end ?? now);
  // source: https://docs.stripe.com/api/invoices/create_preview.md?query=subscription_details "The time given must be within the current subscription period"
  // source: https://docs.stripe.com/api/invoices/create_preview.md?query=subscription_details "cannot be set to"
  if (details?.proration_date !== undefined && (behavior === 'none' || !sub || !Array.isArray(details.items) || prorationTime < periodStart || prorationTime > periodEnd)) return fail(ctx, 'Invalid subscription_details[proration_date] for this subscription preview.', 400, 'parameter_invalid_integer');
  // source: spec:/paths/~1v1~1invoices~1create_preview/post/requestBody/content/application~1x-www-form-urlencoded/schema/properties/subscription_details/description "The subscription creation or modification params to apply as a preview."
  // Preview changes are local to this calculation: the subscription and its stored items are never changed.
  if (Array.isArray(details?.items)) {
    itemRows = itemRows.map(item => ({ ...item }));
    for (const change of details.items as Row[]) {
      const index = change.id ? itemRows.findIndex(item => item.id === change.id) : -1;
      if (change.id && index < 0) return fail(ctx, `No such subscription_item: '${change.id}'`, 400, 'resource_missing');
      if (asBool(change.deleted)) { if (index >= 0) itemRows.splice(index, 1); continue; }
      const previous = index >= 0 ? itemRows[index]! : {};
      const priceId = typeof change.price === 'string' ? change.price : typeof previous.price === 'string' ? previous.price : (previous.price as Row | undefined)?.id;
      const price = typeof priceId === 'string' ? ctx.get('price', priceId) : undefined;
      if (!price) return fail(ctx, `No such price: '${priceId ?? ''}'`, 400, 'resource_missing');
      const quantity = change.quantity === undefined ? Number(previous.quantity ?? 1) : Number(change.quantity);
      const previewItem = { ...previous, price, quantity };
      if (index >= 0) itemRows[index] = previewItem; else itemRows.push(previewItem);
    }
  }
  const out: Row[] = [];
  let subtotal = 0;
  let period = now + 30 * 24 * 3600;
  if (sub) {
    for (const previewItem of itemRows) {
      const priceId = typeof previewItem.price === 'string' ? previewItem.price : String((previewItem.price as Row | undefined)?.id ?? '');
      const quantity = Number(previewItem.quantity) || 0;
      const price = ctx.get('price', priceId);
      const amount = priceAmount(price, quantity);
      const recurring = (price?.recurring as Row | undefined) ?? {};
      period = recurring.interval ? addBillingInterval(renewsAt, recurring.interval as Parameters<typeof addBillingInterval>[1], Number(recurring.interval_count) || 1) : period;
      const item = previewItem;
      subtotal += amount;
      out.push({
        id: `il_twin_${priceId}`, object: 'line_item', type: 'subscription', amount, currency,
        quantity, proration: false, price: price ?? priceId, subscription: subId || null, subscription_item: item?.id ?? null,
        period: { start: renewsAt, end: period }, description: `${quantity} × ${(price?.nickname as string) ?? priceId}`,
      });
    }
  }
  const subDiscount = Array.isArray(sub?.discounts) && sub!.discounts.length ? (sub!.discounts as Row[])[0] : undefined;
  const coupon = subDiscount && typeof subDiscount.coupon === 'object' ? (subDiscount.coupon as Row) : undefined;
  // source: https://docs.stripe.com/api/invoices/create_preview.md?query=subscription_details "Disable creating prorations in this request."
  // source: https://docs.stripe.com/billing/subscriptions/prorations "creates a non-proration debit, even when the debit covers a partial billing period."
  if (sub && Array.isArray(details?.items) && behavior !== 'none' && sub.status !== 'trialing') {
    const before = previousItems.map(item => {
      const priceId = typeof item.price === 'string' ? item.price : String((item.price as Row).id);
      const price = ctx.get('price', priceId);
      return { id: `il_twin_${priceId}`, object: 'line_item', type: 'subscription', amount: priceAmount(price, Number(item.quantity ?? 1)), currency,
        price: price ?? priceId, quantity: Number(item.quantity ?? 1), subscription: subId, subscription_item: item.id,
        period: { start: item.current_period_start ?? periodStart, end: item.current_period_end ?? periodEnd } };
    });
    const after = out.map(line => ({ ...line, period: { start: periodStart, end: periodEnd } }));
    const prorations = prorationLines(before, after, prorationTime, periodStart, periodEnd, coupon);
    // source: https://docs.stripe.com/api/invoices/create_preview.md?query=subscription_details "Always invoice immediately for prorations."
    if (behavior === 'always_invoice' && prorations.length) out.splice(0, out.length, ...prorations);
    else out.unshift(...prorations);
  }
  out.push(...pendingPreviewLines(ctx, customer, currency, now));
  subtotal = sumLines(out);
  // source: https://docs.stripe.com/billing/subscriptions/prorations "no additional discounts are applied to the proration line items themselves"
  const discountAmount = applyCouponDiscount(Math.max(0, sumLines(out.filter(line => !line.proration))), coupon);
  const total = subtotal - discountAmount;
  return ctx.reply({
    ...draft(now),
    // "For preview invoices created using the create preview endpoint, this id will be prefixed with `upcoming_in`"
    // (served spec, invoice.id; the create preview page's example answers "upcoming_in_1MtHbELkdIwHu7ixl4OzzPMv"). Where
    // the documentation stops and the twin decides: the rest of the id is a fresh invoice id's, minted for the preview.
    object: 'invoice', id: `upcoming_${ctx.mint(INV)}`, customer, subscription: subId || null, currency,
    billing_reason: subId ? 'upcoming' : 'manual',
    created: now, period_start: now, period_end: period,
    subtotal, total, amount_due: Math.max(0, total), amount_paid: 0, amount_remaining: Math.max(0, total),
    starting_balance: 0, ending_balance: null,
    discounts: discountAmount > 0 && subDiscount ? [subDiscount] : [],
    total_discount_amounts: discountAmount > 0 ? [{ amount: discountAmount, discount: subDiscount?.id ?? null }] : [],
    lines: { object: 'list', url: '/v1/invoices/create_preview/lines', has_more: false, total_count: out.length, data: out },
  });
}
