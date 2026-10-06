import type { EventsDecl, Handler, HandlerContext, TwinResource } from '@volter/world-core';
import { NAMED_EVENTS, readDecision, STRIPE_EVENT_TYPES, STRIPE_REALTIME_AUTH_TIMEOUT_MS, type StripeAuthRequestOutcome, stripeSignature } from '../engine/webhooks.ts';
import { redactKey, requestKey } from '../engine/oauth.ts';
import { HOUR, INV, itemQuantity, itemsOf, keptAfter, oneTimeLines, RENEWING, SUB } from '../engine/renewals.ts';
import { DAY, payoutDay } from '../engine/balance.ts';
import { AFTER_SUCCESS_CARDS, BY_NUMBER, type Outcome } from '../engine/after-payment.ts';
import { accountSettings, addBillingInterval, applyCouponDiscount, asBool, buildDiscount, buildSubscriptionItemsList, cardError, chargeDefaults, declineFor, disputeEvidence, microdepositsNextAction, mintClientSecret, nowUnix, OBJECT_NAME, paginate, paymentMethodSubObject, PLATFORM_ACCOUNT_ID, priceAmount, requiresAuthentication, requiresMicrodeposits, resolveSubscriptionBillingInterval, resolveTrial, searchOver, type StripeResponse, subscriptionItemEntries, subscriptionItemPrice, TEST_TOKEN_DECLINES, threeDsNextAction, view } from '../engine/stripe.ts';
import { SECRET } from '../engine/apps-secrets.ts';
import { collectsThroughIntent, invoicePrefix, transitions } from '../engine/invoices.ts';
import { CS, type EnteredCard, isOneTime, nestedMetadata } from '../engine/checkout.ts';
import { externalList, type Find, type Row, SPEC_FIELDS } from '../engine/common.ts';
import { noBilling, PM, TEST_PM_CARDS, testCardOf } from '../engine/payment-methods.ts';
import { intentCarries, PI, TYPES_GIVEN } from '../engine/payment-intents.ts';
import { BT, BYPASS_NUMBERS, feeOf, onAccount, UNSENT } from '../engine/ledger.ts';
import { MAX_TRIAL, movedTrial } from '../engine/subscriptions.ts';
import { VL, VLI } from '../engine/radar.ts';
import { AUTH, historyEntry, merchantData, REALTIME_WINDOW_SECONDS, TXN } from '../engine/issuing.ts';
import { BYPASS_PENDING_CARDS } from '../engine/test-cards.ts';
import { customRequirements } from '../engine/connect.ts';
import { expandOf, render, SERVED_VERSION, servesCurrent, withoutEndpointSecret } from '../engine/version.ts';
import { CHECKOUT_METHOD_TYPES, DOCUMENTED, methodTypesRemoved, oneOf, OPS, PAYMENT_METHOD_TYPES, REMOVED_TYPES, TYPED, TYPES_DOC } from '../engine/params.ts';
import { linesOf, sumLines } from '../engine/invoices.ts';
import { refundDestination } from '../engine/common.ts';
import { REFUND_REASONS } from '../engine/refunds.ts';
/** Stripe's events: `Stripe-Signature: t=…,v1=…` over `${t}.${body}` keyed by the endpoint's secret
 *  (docs.stripe.com/webhooks#verify-manually); the Event object (docs.stripe.com/api/events/object) kept as the account's
 *  own (`GET /v1/events`), whether or not an endpoint takes it; an endpoint live while `enabled`, taking the types its
 *  `enabled_events` names (`*` all, `<family>.*` a family), and a Connect endpoint (`connect: true`) its connected
 *  accounts' events ("Connected accounts" scope, docs.stripe.com/connect/webhooks), any other the account's own. */
export const STRIPE_EVENTS: EventsDecl = {
  scheme: { kind: 'timestamp-v1', header: 'Stripe-Signature' },
  types: NAMED_EVENTS,
  known: STRIPE_EVENT_TYPES,
  store: 'event',
  envelope: {
    id: '$id', object: 'event', account: '$account', api_version: '$version', created: '$time.s', data: '$data', livemode: false,
    pending_webhooks: 0, request: { id: null, idempotency_key: null }, type: '$type',
  },
  endpoints: { storedAs: 'webhook_endpoint', url: 'url', secret: 'secret', filter: 'enabled_events', status: { field: 'status', live: 'enabled' }, scope: { field: 'connect', value: '$account' } },
};

/** A customer's now: its test clock's frozen time when it is on one (docs.stripe.com/billing/testing/test-clocks), the
 *  World's otherwise. */
export function clockNow(ctx: HandlerContext, customer: unknown): number {
  const clock = typeof customer === 'string' ? ctx.get('customer', customer)?.test_clock : undefined;
  const frozen = typeof clock === 'string' ? ctx.get('test_helpers.test_clock', clock)?.frozen_time : undefined;
  return frozen !== undefined ? Number(frozen) : Number(nowUnix(ctx.occurredAt));
}

/** What a subscription's invoices charge: its own default payment method, else its customer's. */
export function payerOf(ctx: HandlerContext, sub: Row): string | undefined {
  return typeof sub.default_payment_method === 'string' && sub.default_payment_method ? sub.default_payment_method : customerDefault(ctx, sub);
}

/** The customer's default for invoices, charged when the subscription names none of its own. */
export function customerDefault(ctx: HandlerContext, sub: Row): string | undefined {
  const customer = typeof sub.customer === 'string' ? ctx.get('customer', sub.customer) : undefined;
  const settings = customer?.invoice_settings as Row | undefined;
  return typeof settings?.default_payment_method === 'string' && settings.default_payment_method ? settings.default_payment_method : undefined;
}

/** A subscription whose invoice has just been finalized: the `once` coupon that invoice took is spent, and a once coupon
 *  it did not take (added after it was drafted) stays for the next (unspentDiscounts). */
export async function spendOnceCoupon(ctx: HandlerContext, invoice: Row): Promise<void> {
  const subId = typeof invoice.subscription === 'string' ? invoice.subscription : undefined;
  const sub = subId ? resourceView(ctx, SUB, subId) : undefined;
  if (!sub || !subId) return;
  const all = (sub.discounts as Row[] | undefined) ?? [];
  const kept = keptAfter(all, invoice);
  if (kept.length !== all.length) await ctx.write(SUB, subId, { discounts: kept }, 'subscription.discount_spent');
}

/** A draft invoice for one period of a subscription, its lines the subscription's items and any one-time lines `once`
 *  gives it (a Checkout session's one-time prices, "on the initial invoice only", docs.stripe.com/api/checkout/sessions/
 *  create#create_checkout_session-line_items), under the subscription's discount. Answers the invoice id. */
export async function draftSubscriptionInvoice(ctx: HandlerContext, sub: Row, o: { start: number; end: number; reason: 'subscription_create' | 'subscription_cycle' | 'subscription_update'; trial?: boolean; once?: Row[]; id?: string }): Promise<string> {
  const id = o.id ?? ctx.mint(INV);
  const currency = String(sub.currency ?? 'usd');
  const lines = itemsOf(sub).map((it, i) => {
    const price = it.price && typeof it.price === 'object' ? (it.price as Row) : ctx.get('price', String(it.price ?? ''));
    const quantity = itemQuantity(it);
    return {
      id: `il_twin_${id}_${i + 1}`, object: 'line_item', type: 'subscription',
      // a trial's first invoice bills nothing for the trial period (docs.stripe.com/billing/subscriptions/trials)
      amount: o.trial ? 0 : priceAmount(price, quantity), currency, quantity, proration: false,
      price: price ?? null, subscription: sub.id, subscription_item: it.id ?? null, invoice_item: null,
      period: { start: o.start, end: o.end }, description: o.trial ? `Trial period for ${String(ctx.get('product', String(price?.product ?? ''))?.name ?? 'the plan')}` : null,
    };
  });
  if (o.once?.length) lines.push(...oneTimeLines(id, sub, o.once, lines.length, o.start, currency));
  const subtotal = lines.reduce((s, l) => s + l.amount, 0);
  // a discount the subscription still carries applies; a `once` coupon is removed once an invoice finalizes
  // (spendOnceCoupon), so it discounts one invoice (docs.stripe.com/billing/subscriptions/coupons#coupon-duration)
  const discount = ((sub.discounts as Row[] | undefined) ?? [])[0];
  const coupon = discount && typeof discount === 'object' ? (discount.coupon as Row | undefined) : undefined;
  const off = coupon ? applyCouponDiscount(subtotal, coupon) : 0;
  const total = Math.max(0, subtotal - off);
  await created(ctx, INV, { id, customer: sub.customer, subscription: sub.id }, {
    created: o.start, status: 'draft', livemode: false, currency, collection_method: 'charge_automatically',
    billing_reason: o.reason, auto_advance: true, attempt_count: 0, attempted: false, next_payment_attempt: null,
    amount_due: total, amount_paid: 0, amount_remaining: total, amount_overpaid: 0, amount_paid_off_stripe: 0, amount_shipping: 0,
    subtotal, total, starting_balance: 0, post_payment_credit_notes_amount: 0, pre_payment_credit_notes_amount: 0,
    // "The invoice that consumed the coupon still shows the applied discount" (docs.stripe.com/billing/subscriptions/coupons)
    period_start: o.start, period_end: o.end, default_tax_rates: [], discounts: coupon && discount ? [discount] : [],
    lines: { object: 'list', data: lines, has_more: false, total_count: lines.length, url: `/v1/invoices/${id}/lines` },
    automatic_tax: { enabled: false, liability: null, status: null },
    status_transitions: { finalized_at: null, marked_uncollectible_at: null, paid_at: null, voided_at: null },
    issuer: { type: 'self' }, payment_settings: { default_mandate: null, payment_method_options: null, payment_method_types: null },
    payment_intent: null, charge: null,
  });
  return id;
}

/** Finalize a subscription's draft invoice at `at` and charge what its subscription pays with. The move is time's (a
 *  renewal), the customer's (the Checkout page they paid on) or the API's (an update that ends a trial, which names the
 *  payer, may ask for no attempt, and moves the subscription itself: semantics/subscriptions.ts applyTrialEnd). Answers
 *  whether it was paid. */
export async function collectSubscriptionInvoice(ctx: HandlerContext, invoiceId: string, at: number, actor: 'time' | 'external' | 'api', opts: { payer?: string; attempt?: boolean } = {}): Promise<boolean> {
  const inv = ctx.get(INV, invoiceId);
  const sub = inv && typeof inv.subscription === 'string' ? resourceView(ctx, SUB, inv.subscription) : undefined;
  if (!inv || !sub || inv.status !== 'draft') return false;
  const total = Number(inv.total) || 0;
  const numbered = { ...finalizedFields(ctx, inv, at), status_transitions: { ...(inv.status_transitions as Row), finalized_at: at } };
  const op = ctx.call.operation.id;
  // nothing due (a trial's first invoice) is paid as it is finalized; finalizing spends a `once` coupon
  if (total <= 0) {
    if (ctx.legal(INV, 'status', op, 'draft', 'paid', invoiceId, actor)) return false;
    await spendOnceCoupon(ctx, inv);
    await ctx.write(INV, invoiceId, { ...numbered, status: 'paid', paid: true, auto_advance: false, status_transitions: { ...numbered.status_transitions, paid_at: at } }, 'invoice.paid');
    return true;
  }
  const payer = actor === 'api' ? opts.payer : payerOf(ctx, sub);
  // default_incomplete finalizes the invoice without attempting payment (docs.stripe.com/api/subscriptions/update#update_subscription-payment_behavior)
  const attempt = opts.attempt !== false;
  const decline = payer && attempt ? declineFor(finder(ctx), { payment_method: payer }) : undefined;
  const pays = attempt && !!payer && !decline;
  if (ctx.legal(INV, 'status', op, 'draft', pays ? 'paid' : 'open', invoiceId, actor)) return false;
  await spendOnceCoupon(ctx, inv);
  const piId = ctx.mint('payment_intent');
  const currency = String(inv.currency ?? 'usd');
  const chargeId = pays ? await mintCharge(ctx, piId, { currency, customer: inv.customer, payment_method: payer, invoice: invoiceId }, total) : null;
  const intent = await created(ctx, 'payment_intent', { id: piId, amount: total, currency, customer: inv.customer, invoice: invoiceId, payment_method: pays ? payer : null }, {
    status: pays ? 'succeeded' : 'requires_payment_method', client_secret: mintClientSecret(piId, await ctx.secret(`client-secret:${piId}`)), livemode: false,
    capture_method: 'automatic', amount_capturable: 0, amount_received: pays ? total : 0, next_action: null, latest_charge: chargeId,
    last_payment_error: decline ? { type: 'card_error', code: decline.code, decline_code: decline.decline_code ?? null, message: decline.message, payment_method: { id: payer } } : null,
    automatic_payment_methods: null, payment_method_types: ['card'], payment_method_options: {},
  });
  await ctx.write(INV, invoiceId, {
    ...numbered, status: pays ? 'paid' : 'open', paid: pays, attempt_count: attempt ? 1 : 0, attempted: attempt, payment_intent: piId, charge: chargeId,
    // source: spec:/components/schemas/invoice/properties/confirmation_secret/description "client_secret of the PaymentIntent"
    confirmation_secret: { type: 'payment_intent', client_secret: intent.client_secret },
    amount_paid: pays ? total : 0, amount_remaining: pays ? 0 : total, auto_advance: attempt && !pays, next_payment_attempt: null,
    status_transitions: { ...numbered.status_transitions, paid_at: pays ? at : null },
  }, pays ? 'invoice.paid' : attempt ? 'invoice.payment_failed' : 'invoice.finalized');
  if (actor !== 'api' && !pays && sub.status !== 'past_due' && !ctx.legal(SUB, 'status', op, sub.status, 'past_due', String(sub.id), 'time')) {
    await ctx.write(SUB, String(sub.id), { status: 'past_due' }, 'customer.subscription.updated');
  }
  return pays;
}

/** Pay a subscription's open invoice with `paymentMethod` (the customer on the portal, `external`): the charge on the
 *  invoice's PaymentIntent, the invoice paid, a past_due subscription active. Answers the decline, if the card is refused. */
export async function payOpenInvoice(ctx: HandlerContext, invoiceId: string, paymentMethod: string): Promise<{ code: string; message: string } | undefined> {
  const inv = ctx.get(INV, invoiceId);
  if (!inv || inv.status !== 'open') return { code: 'invoice_not_open', message: 'This invoice is no longer open.' };
  const decline = declineFor(finder(ctx), { payment_method: paymentMethod });
  if (decline) return decline;
  const op = ctx.call.operation.id;
  const refused = ctx.legal(INV, 'status', op, 'open', 'paid', invoiceId, 'external');
  if (refused) return { code: String(refused.code ?? 'invoice_not_open'), message: refused.message };
  const total = Number(inv.amount_remaining ?? inv.total) || 0;
  const now = Number(nowUnix(ctx.occurredAt));
  const piId = typeof inv.payment_intent === 'string' ? inv.payment_intent : undefined;
  let chargeId: string | null = null;
  const pi = piId ? ctx.get('payment_intent', piId) : undefined;
  if (piId && pi && !ctx.legal('payment_intent', 'status', op, pi.status, 'succeeded', piId, 'external')) {
    chargeId = await mintCharge(ctx, piId, { ...pi, payment_method: paymentMethod, invoice: invoiceId }, total);
    await ctx.write('payment_intent', piId, { status: 'succeeded', payment_method: paymentMethod, amount_received: total, last_payment_error: null, latest_charge: chargeId }, 'payment_intent.succeeded');
  }
  await ctx.write(INV, invoiceId, {
    status: 'paid', paid: true, amount_paid: total, amount_remaining: 0, charge: chargeId, auto_advance: false,
    attempt_count: (Number(inv.attempt_count) || 0) + 1, attempted: true,
    status_transitions: { ...(inv.status_transitions as Row), paid_at: now },
  }, 'invoice.paid');
  const sub = typeof inv.subscription === 'string' ? resourceView(ctx, SUB, inv.subscription) : undefined;
  if (sub && sub.status === 'past_due' && !ctx.legal(SUB, 'status', op, 'past_due', 'active', String(sub.id), 'external')) {
    await ctx.write(SUB, String(sub.id), { status: 'active' }, 'customer.subscription.updated');
  }
  return undefined;
}

/** Time's moves on subscriptions, caught up to each customer's clock in the order they fell due, each made at the
 *  moment it was due: a period that ended renews (a trial's end among them) or, set to cancel, cancels; a renewal
 *  drafted an hour or more ago is finalized and charged. */
export async function advanceBilling(ctx: HandlerContext, only?: (sub: Row) => boolean): Promise<void> {
  // Stripe's own move wherever a handler reaches it: a read that catches a renewal up records it with no caller
  await ctx.asVendor(async () => {
    const at = at_(ctx);
    for (let guard = 0; guard < 10_000 && (await billingStep(ctx, at, only)); guard++);
  });
}

/** The earliest move that has come due, made at its moment; false when none has. */
export async function billingStep(ctx: HandlerContext, at: (t: number) => Promise<HandlerContext>, only?: (sub: Row) => boolean): Promise<boolean> {
    // the earliest move that has come due, of any subscription
    let next: { t: number; kind: 'period' | 'collect'; id: string } | undefined;
    for (const sub of ctx.rows(SUB).map((s) => ctx.expand(SUB, s))) {
      if (only && !only(sub)) continue;
      if (!RENEWING.includes(String(sub.status)) || typeof sub.current_period_end !== 'number' || sub.pause_collection) continue;
      if (sub.current_period_end <= clockNow(ctx, sub.customer) && (!next || sub.current_period_end < next.t)) next = { t: sub.current_period_end, kind: 'period', id: String(sub.id) };
    }
    for (const inv of ctx.rows(INV)) {
      if (inv.status !== 'draft' || inv.billing_reason !== 'subscription_cycle' || inv.auto_advance !== true) continue;
      const sub = typeof inv.subscription === 'string' ? resourceView(ctx, SUB, inv.subscription) : undefined;
      if (!sub || (only && !only(sub))) continue;
      const t = Number(inv.created) + HOUR;
      if (t <= clockNow(ctx, sub.customer) && (!next || t < next.t)) next = { t, kind: 'collect', id: String(inv.id) };
    }
    if (!next) return false;
    const c = await at(next.t);
    if (next.kind === 'collect') {
      await collectSubscriptionInvoice(c, next.id, next.t, 'time');
      return true;
    }
    const id = next.id;
    const sub = resourceView(c, SUB, id)!;
    const op = c.call.operation.id;
    // one set to cancel at its period's end is canceled then, with no renewal
    // (docs.stripe.com/billing/subscriptions/cancel#cancel-at-end-of-cycle)
    if (sub.cancel_at_period_end === true) {
      if (c.legal(SUB, 'status', op, sub.status, 'canceled', id, 'time')) return false;
      await c.write(SUB, id, { status: 'canceled', ended_at: next.t, canceled_at: sub.canceled_at ?? next.t }, 'customer.subscription.deleted');
      return true;
    }
    const start = next.t;
    const { interval, interval_count } = resolveSubscriptionBillingInterval(itemsOf(sub), finder(c));
    const end = addBillingInterval(start, interval, interval_count);
    const trialEnds = sub.status === 'trialing';
    if (trialEnds && c.legal(SUB, 'status', op, 'trialing', 'active', id, 'time')) return false;
    const invoiceId = await draftSubscriptionInvoice(c, sub, { start, end, reason: 'subscription_cycle' });
    await c.write(SUB, id, { current_period_start: start, current_period_end: end, latest_invoice: invoiceId, ...(trialEnds ? { status: 'active' } : {}) }, 'customer.subscription.updated');
    return true;
}

export const account = (ctx: HandlerContext): string | undefined => actingAccount(ctx);

/** The acting account's Balance object (docs.stripe.com/api/balance/balance_object). */
export function balanceBody(ctx: HandlerContext, acct: string | undefined = account(ctx)): Row {
  const { available, pending, issuing } = balanceOf(ctx, acct);
  const toArr = (m: Map<string, number>) => {
    const out = [...m.entries()].map(([currency, amount]) => ({ amount, currency, source_types: { card: amount } }));
    return out.length ? out : [{ amount: 0, currency: 'usd', source_types: { card: 0 } }];
  };
  // a platform's balance holds its connected accounts' reserve, "Funds held due to negative balances on connected accounts
  // where account.controller.requirement_collection is `application`" (docs.stripe.com/api/balance/balance_object, whose
  // example answers `[{"amount": 0, "currency": "usd"}]`); the twin models no such reserve, so it is zero in each currency
  const reserved = acct ? {} : { connect_reserved: toArr(available).map((b) => ({ amount: 0, currency: b.currency })) };
  return {
    object: 'balance', available: toArr(available), pending: toArr(pending), ...reserved, livemode: false,
    ...(issuing.size ? { issuing: { available: [...issuing.entries()].map(([currency, amount]) => ({ amount, currency, source_types: { card: amount } })) } } : {}),
  };
}

/** Time's arrivals, written: each of the acting account's payouts whose arrival date has come moves pending → paid
 *  (the clock's move, as asOf reads it), written as `payout.paid`, the event Stripe sends for it. Answers their ids. */
export async function payDuePayouts(ctx: HandlerContext, acct: string | undefined = account(ctx)): Promise<string[]> {
  const now = Number(nowUnix(ctx.occurredAt));
  const paid: string[] = [];
  for (const p of newest(ctx, 'payout')) {
    if ((acct ? kept(ctx, 'payout', p, '_account') !== acct : !!kept(ctx, 'payout', p, '_account')) || p.status !== 'pending' || Number(p.arrival_date) > now) continue;
    if (ctx.legal('payout', 'status', ctx.call.operation.id, 'pending', 'paid', String(p.id), 'time')) continue;
    await ctx.write('payout', String(p.id), { status: 'paid' }, 'payout.paid');
    paid.push(String(p.id));
  }
  return paid;
}

/** Where a connected account's payout goes: "ID of the bank account or card the payout is sent to" (served spec,
 *  payout.destination), its default external account for the currency, "When multiple accounts are available for a given
 *  currency, Stripe uses the one set as `default_for_currency`" (docs.stripe.com/connect/payouts-bank-accounts), the
 *  newest such. Where the documentation stops and the twin decides: the platform's own bank account is not modelled, so
 *  its payouts name none. */
export function payoutBank(ctx: HandlerContext, account: string, currency: string): string | null {
  const banks = newest(ctx, 'external_account').filter((e) => e.account === account && String(e.currency ?? currency) === currency);
  return String((banks.find((e) => e.default_for_currency === true) ?? banks[0])?.id ?? '') || null;
}

export const payoutDefaults = (ctx: HandlerContext): Row => ({
  method: 'standard', type: 'bank_account', source_type: 'card', automatic: false,
  reconciliation_status: 'not_applicable', arrival_date: Number(nowUnix(ctx.occurredAt)) + 2 * DAY, livemode: false, metadata: {},
});

/** A payout as the clock reads it: paid once its arrival date has come, the clock's move, asked of the
 *  machine as a write asks it. */
export function asOf(ctx: HandlerContext, p: Row): Row {
  if (p.status !== 'pending' || Number(p.arrival_date) > Number(nowUnix(ctx.occurredAt))) return p;
  ctx.legal('payout', 'status', ctx.call.operation.id, 'pending', 'paid', String(p.id), 'time');
  return { ...p, status: 'paid' };
}

/** A connected account's payout in a currency none of its bank accounts takes. */
export function noExternalAccount(ctx: HandlerContext, currency: string): Response {
  return fail(ctx, `Sorry, you don't have any external accounts in that currency (${currency}).`, 400);
}

/** Time's payouts, caught up to the World's clock: each account on an automatic schedule is paid out, on each of its
 *  scheduled days that has come, what became available by then. */
export async function advancePayouts(ctx: HandlerContext): Promise<void> {
  const now = Number(nowUnix(ctx.occurredAt));
  const platform = ctx.get('account', PLATFORM_ACCOUNT_ID);
  const accounts: Array<{ id: string | undefined; settings: unknown }> = [{ id: undefined, settings: platform?.settings }];
  for (const a of ctx.rows('account')) {
    if (a.id === PLATFORM_ACCOUNT_ID || a.payouts_enabled !== true) continue;
    if (!ctx.rows('external_account').some((e) => e.account === a.id)) continue;
    accounts.push({ id: String(a.id), settings: a.settings });
  }
  for (const acct of accounts) {
    const schedule = ((accountSettings(acct.settings, (acct.settings as Row | undefined) ?? undefined).payouts as Row).schedule ?? {}) as Row;
    if (schedule.interval === 'manual') continue;
    const unpaid = unpaidEntries(ctx, acct.id);
    const days = [...new Set(unpaid.map((t) => payoutDay(Number(t.available_on) || 0, schedule)))].filter((d) => d <= now).sort((x, y) => x - y);
    const paid = new Set<unknown>();
    for (const day of days) {
      const due = unpaid.filter((t) => !paid.has(t.id) && (Number(t.available_on) || 0) <= day);
      const byCurrency = new Map<string, Row[]>();
      for (const t of due) byCurrency.set(String(t.currency ?? 'usd'), [...(byCurrency.get(String(t.currency ?? 'usd')) ?? []), t]);
      for (const [currency, entries] of byCurrency) {
        const amount = entries.reduce((n, t) => n + (Number(t.net) || 0), 0);
        // nothing to pay yet: what came due is carried to the next payout
        if (amount <= 0) continue;
        // made on its day, as Stripe makes it, whenever the request that catches it up comes
        const c = await at_(ctx)(day);
        const id = c.mint('payout');
        const bt = await settleAutomaticPayout(c, id, amount, currency, acct.id, day, entries);
        await created(c, 'payout', { id, amount, currency }, {
          status: 'pending', ...payoutDefaults(c), arrival_date: day + 2 * DAY, automatic: true, balance_transaction: bt, destination: acct.id ? payoutBank(c, String(acct.id), currency) : null,
          description: 'STRIPE PAYOUT', ...(acct.id ? { _account: acct.id } : {}),
        });
        for (const t of entries) paid.add(t.id);
      }
    }
  }
}

/** What Stripe does after a card succeeds: from a raw number, a test name (pm_card_* or tok_*), or a stored
 *  PaymentMethod that recorded it when it was made. */
export function afterSuccessOf(ctx: HandlerContext, ref: unknown): Outcome | undefined {
  // a card given as a token (card[token], payment_method_data[card][token]) is the card the token names
  if (ref && typeof ref === 'object' && typeof (ref as Row).token === 'string') return afterSuccessOf(ctx, (ref as Row).token);
  if (ref && typeof ref === 'object') return BY_NUMBER[String((ref as Row).number ?? '').replace(/\D/g, '')];
  if (typeof ref !== 'string' || !ref) return undefined;
  const stored = ctx.row('payment_method', ref);
  if (stored) return (stored._afterSuccess as Outcome | undefined) ?? undefined;
  return AFTER_SUCCESS_CARDS[ref.replace(/^tok_/, 'pm_card_')]?.outcome ?? BY_NUMBER[ref.replace(/\D/g, '')];
}

/** Stripe's acts on a charge that just succeeded: a dispute or a review its card brings, and the platform's fee. */
export async function afterCharge(ctx: HandlerContext, chargeId: string, charge: { amount: number; currency: string; payment_intent?: string | undefined; application_fee_amount?: unknown; destination?: unknown }, ref: unknown): Promise<void> {
  const outcome = afterSuccessOf(ctx, ref);
  const pi = charge.payment_intent ? { payment_intent: charge.payment_intent } : { payment_intent: null };
  const now = Number(nowUnix(ctx.occurredAt));
  if (outcome === 'dispute' || outcome === 'dispute_not_received' || outcome === 'inquiry') {
    const dispute = await created(ctx, 'dispute', { charge: chargeId, ...pi, amount: charge.amount, currency: charge.currency }, {
      reason: outcome === 'dispute_not_received' ? 'product_not_received' : 'fraudulent', status: outcome === 'inquiry' ? 'warning_needs_response' : 'needs_response', is_charge_refundable: false,
      evidence: disputeEvidence(), evidence_details: { due_by: now + 7 * DAY, has_evidence: false, past_due: false, submission_count: 0, enhanced_eligibility: {} },
      balance_transactions: [], livemode: false, metadata: {}, enhanced_eligibility_types: [],
    });
    // an inquiry moves no money; a dispute takes the amount and its fee until it is decided
    if (outcome !== 'inquiry') {
      const bt = await settleDispute(ctx, String(dispute.id), charge.amount, charge.currency);
      await ctx.write('dispute', String(dispute.id), { balance_transactions: [ctx.get('balance_transaction', bt) ?? bt] }, 'dispute.funds_withdrawn');
    }
    await ctx.write('charge', chargeId, { disputed: true }, 'charge.dispute.created');
  }
  if (outcome === 'review') await openReview(ctx, chargeId, pi);
  const feeAmount = Math.trunc(Number(charge.application_fee_amount) || 0);
  const destination = typeof charge.destination === 'string' && charge.destination ? charge.destination : undefined;
  const direct = actingAccount(ctx);
  const account = destination ?? direct;
  // a destination charge transfers what it collected, less the platform's fee, available when the charge's funds are
  if (destination) {
    const amount = charge.amount - feeAmount;
    const chargeBt = ctx.get('charge', chargeId)?.balance_transaction;
    const availableOn = Number(ctx.get('balance_transaction', String(chargeBt))?.available_on ?? nowUnix(ctx.occurredAt));
    const tr = await created(ctx, 'transfer', { amount, currency: charge.currency, destination }, {
      amount_reversed: 0, balance_transaction: null, livemode: false, metadata: {}, reversed: false, source_type: 'card', source_transaction: chargeId,
      reversals: { object: 'list', data: [], has_more: false, total_count: 0, url: '' },
    });
    const bt = await settleTransfer(ctx, String(tr.id), amount, charge.currency, destination, availableOn);
    await ctx.write('transfer', String(tr.id), { balance_transaction: bt, destination_payment: `py_${String(tr.id).replace(/^tr_/, '')}`, reversals: { object: 'list', data: [], has_more: false, total_count: 0, url: `/v1/transfers/${String(tr.id)}/reversals` } }, 'transfer.created');
    await ctx.write('charge', chargeId, { transfer: tr.id }, 'charge.updated');
  }
  if (feeAmount > 0 && account) {
    const fee = await created(ctx, 'application_fee', { account, amount: feeAmount, charge: chargeId, currency: charge.currency }, {
      amount_refunded: 0, application: 'ca_twin', balance_transaction: null, originating_transaction: null, refunded: false, livemode: false,
    });
    // a direct charge's fee moves from the connected account to the platform (a destination charge kept it back)
    const bt = !destination && direct ? await settleApplicationFee(ctx, String(fee.id), feeAmount, charge.currency, direct) : null;
    await ctx.write('application_fee', String(fee.id), { balance_transaction: bt, refunds: { object: 'list', data: [], has_more: false, total_count: 0, url: `/v1/application_fees/${String(fee.id)}/refunds` } }, 'application_fee.created');
    await ctx.write('charge', chargeId, { application_fee: fee.id, application_fee_amount: feeAmount }, 'charge.updated');
  }
}

/** Radar places an elevated-risk card's charge in review (docs.stripe.com/radar/reviews). */
export async function openReview(ctx: HandlerContext, chargeId: string, pi: { payment_intent: string | null }): Promise<void> {
  const review = await created(ctx, 'review', { charge: chargeId, ...pi }, {
    open: true, opened_reason: 'rule', reason: 'rule', closed_reason: null, billing_zip: null, ip_address: null, ip_address_location: null, session: null, livemode: false,
  });
  const existing = (ctx.get('charge', chargeId)?.outcome as Row | undefined) ?? {};
  await ctx.write('charge', chargeId, {
    review: review.id,
    outcome: { ...existing, type: 'manual_review', risk_level: 'elevated', risk_score: 67, seller_message: 'Stripe evaluated this payment as having elevated risk, and placed it in review.' },
  }, 'review.opened');
}

export const customerMissing = (ctx: HandlerContext, id: string): Response => fail(ctx, `No such customer: '${id}'`, 404, 'resource_missing');

/** The request event asked of the endpoint, signed with its secret and rendered in the event's API version, and its
 *  answer read as the decision. */
export async function askForAuthorization(ctx: HandlerContext, url: string, event: Record<string, unknown>, secret: string): Promise<StripeAuthRequestOutcome> {
  const payload = JSON.stringify(render(event, typeof event.api_version === 'string' ? event.api_version : undefined));
  const signature = stripeSignature(payload, secret, Math.floor(Date.parse(ctx.occurredAt) / 1000));
  const answer = await ctx.ask(url, { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': signature }, body: payload }, STRIPE_REALTIME_AUTH_TIMEOUT_MS);
  if (answer.missed === 'timeout') return { kind: 'timeout', message: 'Webhook endpoint did not respond within the real-time authorization window.' };
  if (answer.missed === 'unreachable') return { kind: 'timeout', message: 'Webhook endpoint was unreachable within the real-time authorization window.' };
  return readDecision(answer);
}

/** Stripe's refusal of a call a publishable key may not make, or undefined when the key may make it. */
export function publishableKeyRefused(ctx: HandlerContext): Response | undefined {
  // the key however it is sent, Bearer or Basic's user (requestKey): a publishable key is public, and sent as Basic it
  // is still one
  if (!requestKey(ctx.call.request).startsWith('pk_')) return undefined;
  return ctx.refuse({ status: 403, code: 'secret_key_required', message: 'The API key provided is a publishable key, but a secret key is required.' });
}

/** The platform's own keys, as the dashboard's API keys page makes them (the `appCredentials` door): a secret key and a
 *  publishable key, held by their SHA-256. A request with no key is refused, as is a platform key Stripe never issued
 *  ("Invalid API Key provided"). */
// source: https://docs.stripe.com/api/authentication "API requests without authentication also fail."
export function platformKeyRefused(ctx: HandlerContext, request: Request): Response | undefined {
  const key = requestKey(request);
  if (!key) return ctx.refuse({ status: 401, message: "You did not provide an API key. You need to provide your API key in the Authorization header, using Bearer auth (e.g. 'Authorization: Bearer YOUR_SECRET_KEY'). See https://stripe.com/docs/api#authentication for details, or we can help at https://support.stripe.com/." });
  const held = ctx.rowsRaw('_platform_key').some((k) => k._sha256 === ctx.crypto.sha256(key) && k.deleted !== true);
  return held ? undefined : ctx.refuse({ status: 401, message: `Invalid API Key provided: ${redactKey(key)}` });
}

// ── metadata ──
// "This parameter uses a merge mechanism, which allows you to add new key-value pairs to an object in an update call
// without affecting any existing metadata"; "Pass in the key with an empty string as the value to remove the key from the
// metadata"; "Pass an empty string as the value for the metadata attribute to delete all of the keys simultaneously"
// (docs.stripe.com/metadata), and "Individual keys can be unset by posting an empty value to them" holds on a create
// too: an object never holds a key set to "" (stripe-node encodes a `null` value as `metadata[key]=`). The derived core
// merges a nested hash on an update (dropping keys set to ""), so for it only a clear-all is rewritten; where a handler
// stores the request's metadata whole, the request carries the merged hash, its removed keys as "". The rewritten
// request is JSON.
export function withMetadata(ctx: HandlerContext, request: Request): Request {
  if (request.method !== 'POST' || (request.headers.get('content-type') ?? '').includes('multipart')) return request;
  if (!('metadata' in ctx.params)) return request;
  const op = ctx.call.operation;
  const given = ctx.params.metadata;
  let metadata: Row;
  if (op.class === 'create') {
    if (given === '') metadata = {};
    else if (given && typeof given === 'object' && !Array.isArray(given) && Object.values(given).includes('')) metadata = Object.fromEntries(Object.entries(given as Row).filter(([, v]) => v !== ''));
    else return request;
  } else if (op.class === 'update' && op.resource) {
    const resource = op.resource;
    const id = Object.values(ctx.call.params).at(-1) ?? '';
    const held = ctx.get(resource, id)?.metadata;
    const prior = held && typeof held === 'object' ? (held as Row) : {};
    // the merged hash, a key removed carried as "" so a merging update (the derived core's) drops it too; an object
    // never answers a key set to "" (../engine/version.ts render)
    if (given === '') metadata = Object.fromEntries(Object.keys(prior).map((k) => [k, '']));
    else if (given && typeof given === 'object' && !Array.isArray(given)) metadata = { ...prior, ...(given as Row) };
    else return request;
  } else return request;
  const headers = new Headers(request.headers);
  headers.set('content-type', 'application/json');
  return new Request(request.url, { method: request.method, headers, body: JSON.stringify({ ...ctx.params, metadata }) });
}

export function scopeKeyOf(ctx: HandlerContext): string {
  const scope = ctx.params.scope && typeof ctx.params.scope === 'object' ? (ctx.params.scope as Row) : undefined;
  const scopeType = scope && typeof scope.type === 'string' ? scope.type : 'account';
  return scopeType === 'user' ? `user:${String(scope!.user)}` : 'account';
}

export const named = (ctx: HandlerContext, name: string): Row | undefined => ctx.rows(SECRET).find((s) => s.name === name && kept(ctx, SECRET, s, '_scope_key') === scopeKeyOf(ctx));

export const invoiceMissing = (ctx: HandlerContext, id: string): Response => fail(ctx, `No such invoice: '${id}'`, 404, 'resource_missing');

/** Paying an invoice with nothing to pay it: "If not set, defaults to the subscription's default payment method, if any,
 *  or to the default payment method in the customer's invoice settings" (docs.stripe.com/api/invoices/object,
 *  default_payment_method), and none of them is set. */
export function nothingToPayWith(ctx: HandlerContext): Response {
  return fail(ctx, 'This customer has no attached payment source or default payment method. Please consider adding a default payment method.', 400, 'missing');
}

/** A subscription waiting on the invoice paid through the invoice's own pay (incomplete on its first, past_due on a
 *  failed renewal) is active again. */
export async function activatedByPayment(ctx: HandlerContext, subId: string): Promise<void> {
  await ctx.write('subscription', subId, { status: 'active' }, 'subscription.update');
}

/** The invoice the path names, and the machine's refusal when this operation may not move it. */
export function invoicesLoad(ctx: HandlerContext, operationId: string): { inv: Row } | { answer: Response } {
  const id = at(ctx, 'invoice');
  const inv = ctx.get(INV, id);
  if (!inv) return { answer: invoiceMissing(ctx, id) };
  const refused = ctx.legal(INV, 'status', operationId, inv.status, undefined, id);
  return refused ? { answer: ctx.refuse(refused) } : { inv };
}

/** A draft finalized on its way to being paid: numbered, open, its PaymentIntent opened (PostInvoicesInvoiceFinalize). */
export async function finalizeForPayment(ctx: HandlerContext, inv: Row, id: string): Promise<Row> {
  const piId = collectsThroughIntent(inv) ? ctx.mint('payment_intent') : null;
  const now = nowUnix(ctx.occurredAt);
  ctx.legal(INV, 'status', 'PostInvoicesInvoicePay', 'draft', 'open', id);
  const body = await ctx.write(INV, id, { ...finalizedFields(ctx, inv, Number(now)), status: 'open', status_transitions: { ...transitions(inv), finalized_at: now }, payment_intent: piId }, 'invoice.finalize');
  if (piId) await openPaymentIntent(ctx, piId, inv, id);
  await spendOnceCoupon(ctx, inv);
  return ctx.get(INV, id) ?? body;
}

/** The PaymentIntent a charge_automatically invoice with a balance gets when it is finalized; it
 *  waits for confirmation when the invoice already names a default payment method. */
export async function openPaymentIntent(ctx: HandlerContext, piId: string, inv: Row, invoiceId: string): Promise<void> {
  const defaultPaymentMethod = typeof inv.default_payment_method === 'string' ? inv.default_payment_method : undefined;
  const intent = await created(ctx, 'payment_intent', {
    id: piId, amount: Number(inv.amount_due) || 0, currency: String(inv.currency ?? 'usd'), customer: inv.customer, invoice: invoiceId,
    ...(defaultPaymentMethod ? { payment_method: defaultPaymentMethod } : {}),
  }, {
    status: defaultPaymentMethod ? 'requires_confirmation' : 'requires_payment_method',
    client_secret: mintClientSecret(piId, await ctx.secret(`client-secret:${piId}`)), livemode: false,
    capture_method: 'automatic', amount_capturable: 0, amount_received: 0, next_action: null,
    automatic_payment_methods: null, payment_method_types: ['card', 'link'], payment_method_options: {},
  });
  // source: spec:/components/schemas/invoice/properties/confirmation_secret/description "client_secret of the PaymentIntent"
  await ctx.write(INV, invoiceId, { confirmation_secret: { type: 'payment_intent', client_secret: intent.client_secret } }, 'invoice.updated');
}

export function finalizedFields(ctx: HandlerContext, inv: Row, now: number): Row {
  const customerId = typeof inv.customer === 'string' ? inv.customer : '';
  const customer = customerId ? ctx.get('customer', customerId) : undefined;
  const prefix = typeof customer?.invoice_prefix === 'string' && customer.invoice_prefix
    ? customer.invoice_prefix
    : invoicePrefix(customerId);
  const numbered = ctx.rows(INV).filter((i) => i.customer === customerId && typeof i.number === 'string' && i.id !== inv.id).length;
  const fields: Row = { number: typeof inv.number === 'string' && inv.number ? inv.number : `${prefix}-${String(numbered + 1).padStart(4, '0')}` };
  const days = Number(inv.days_until_due);
  if (inv.collection_method === 'send_invoice' && inv.due_date == null && Number.isFinite(days) && days > 0) fields.due_date = now + days * 86400;
  return fields;
}

/** A coupon for a fixed amount off, in its currency (docs.stripe.com/api/coupons/create#create_coupon-amount_off). */
export function amountOffOf(ctx: HandlerContext, params: Record<string, unknown>): number | Response {
  const amountOff = Number(params.amount_off);
  if (!Number.isInteger(amountOff) || amountOff <= 0) return fail(ctx, 'Invalid integer: amount_off must be a positive integer.', 400, 'parameter_invalid_integer');
  if (params.currency === undefined || params.currency === '') return fail(ctx, 'Missing required param: currency.', 400, 'parameter_missing');
  return amountOff;
}

/** Time's lapsing of coupons, caught up to the World's clock: a valid coupon whose redeem_by has passed is no longer
 *  valid from that moment (manifest.ts). Where the documentation stops and the twin decides: the lapse sends no event
 *  (the events page names none for it). */
export async function lapseCoupons(ctx: HandlerContext): Promise<void> {
  const now = Number(nowUnix(ctx.occurredAt));
  for (const c of ctx.rowsRaw('coupon')) {
    if (c.valid !== true || typeof c.redeem_by !== 'number' || c.redeem_by > now) continue;
    const t = await at_(ctx)(c.redeem_by);
    t.legal('coupon', 'valid', ctx.call.operation.id, 'true', 'false', String(c.id), 'time');
    await t.write('coupon', String(c.id), { valid: false }, 'coupon.lapsed');
  }
}

export const sessionMissing = (ctx: HandlerContext, id: string): Response => fail(ctx, `No such checkout.session: '${id}'`, 404, 'resource_missing');

// Stripe normalizes the create input into the Session: line_items become the list envelope, and
// subscription_data (create-only) is kept aside for completion to copy onto the subscription
/** The discount a session is created with (discounts[0][promotion_code] or [coupon]), or Stripe's refusal: an unknown
 *  code or coupon, and one that has expired or been deactivated, are refused at create
 *  (docs.stripe.com/api/checkout/sessions/create#create_checkout_session-discounts, docs.stripe.com/error-codes#coupon-expired).
 *  Where the documentation stops and the twin decides: the refusals' wording. */
export function discountOf(ctx: HandlerContext, params: Row, now: number): { coupon: Row; promotion?: string } | Response | undefined {
  const first = Array.isArray(params.discounts) ? (params.discounts[0] as Row | undefined) : undefined;
  if (!first || typeof first !== 'object') return undefined;
  const expired = (what: string) => ctx.refuse({ status: 400, code: 'coupon_expired', param: 'discounts', message: `This ${what} has expired.` });
  let promotion: string | undefined;
  let couponId = typeof first.coupon === 'string' ? first.coupon : undefined;
  if (typeof first.promotion_code === 'string') {
    const pc = ctx.get('promotion_code', first.promotion_code);
    if (!pc) return ctx.refuse({ status: 400, code: 'resource_missing', param: 'discounts[0][promotion_code]', message: `No such promotion code: '${first.promotion_code}'` });
    if (typeof pc.expires_at === 'number' && pc.expires_at <= now) return expired('promotion code');
    if (pc.active === false) return ctx.refuse({ status: 400, param: 'discounts[0][promotion_code]', message: 'This promotion code is inactive.' });
    promotion = String(pc.id);
    couponId = typeof pc.coupon === 'string' ? pc.coupon : String((pc.coupon as Row | undefined)?.id ?? '');
  }
  const coupon = couponId ? ctx.get('coupon', couponId) : undefined;
  if (!coupon) return ctx.refuse({ status: 400, code: 'resource_missing', param: 'discounts[0][coupon]', message: `No such coupon: '${couponId ?? ''}'` });
  if (coupon.valid === false || (typeof coupon.redeem_by === 'number' && coupon.redeem_by <= now)) return expired('coupon');
  return { coupon, ...(promotion ? { promotion } : {}) };
}

/** A payment or subscription session with nothing to sell (docs.stripe.com/api/checkout/sessions/create#create_checkout_session-line_items). */
export function noLineItems(ctx: HandlerContext): Response {
  return fail(ctx, 'You must provide at least one recurring price in `subscription` mode when not using `line_items[].price_data` or a Price with `recurring`, and at least one `line_items` for `payment` mode.', 400, 'parameter_missing');
}

/** A destination charge to an account the platform does not have (docs.stripe.com/connect/destination-charges). */
export function checkoutNoDestination(ctx: HandlerContext, destination: unknown): Response {
  return ctx.refuse({ status: 400, code: 'resource_missing', param: 'payment_intent_data[transfer_data][destination]', message: `No such destination: '${String(destination)}'` });
}

/** A session's trial Stripe refuses: `subscription_data.trial_end` "Has to be at least 48 hours in the future", and
 *  `subscription_data.trial_period_days` "Has to be at least 1" (docs.stripe.com/api/checkout/sessions/create). Where the
 *  documentation stops and the twin decides: the refusals' wording. */
export function sessionTrialRefused(ctx: HandlerContext, data: unknown, now: number): Response | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const { trial_end: end, trial_period_days: days } = data as Row;
  const endRefused = end !== undefined && !(Number.isInteger(Number(end)) && Number(end) >= now + 48 * 3600);
  const daysRefused = days !== undefined && !(Number.isInteger(Number(days)) && Number(days) >= 1);
  return endRefused || daysRefused ? sessionTrialRefusal(ctx, endRefused ? 'trial_end' : 'trial_period_days') : undefined;
}

export function sessionTrialRefusal(ctx: HandlerContext, param: 'trial_end' | 'trial_period_days'): Response {
  const message = param === 'trial_end' ? 'The `subscription_data[trial_end]` timestamp has to be at least 48 hours in the future.' : 'The `subscription_data[trial_period_days]` has to be at least 1.';
  return ctx.refuse({ status: 400, param: `subscription_data[${param}]`, message });
}

/** What completing a session makes, by its mode, as the fields that link it: a payment is a PaymentIntent paid with
 *  the entered card, its charge in the ledger as any payment's is. */
export async function complete(ctx: HandlerContext, id: string, existing: Row, card?: EnteredCard): Promise<Row> {
  const link: Row = { status: 'complete' };
  const customer = typeof existing.customer === 'string' ? existing.customer : undefined;
  const currency = typeof existing.currency === 'string' ? existing.currency : 'usd';
  // the entered card becomes a PaymentMethod carrying what a later charge to it answers and what Stripe does after it
  // succeeds (docs.stripe.com/testing#declined-payments, #disputes)
  const made = card ? await created(ctx, 'payment_method', {}, { type: 'card', customer: null, livemode: false, billing_details: { address: null, email: null, name: null, phone: null }, ...paymentMethodSubObject('card', { card }), _declineOutcome: declineFor(() => undefined, { card }) ?? null, ...(afterSuccessOf(ctx, card) ? { _afterSuccess: afterSuccessOf(ctx, card) } : {}) }) : undefined;
  // and Checkout attaches it to the customer when it saves it: a subscription's card ("If your Checkout Session uses
  // subscription mode, Stripe saves the payment method by default", docs.stripe.com/payments/checkout/how-checkout-works),
  // a setup session's (it exists to save one), and a payment's only under payment_intent_data.setup_future_usage ("to have
  // Checkout automatically attach the payment method to the Customer you pass in", docs.stripe.com/api/checkout/sessions/
  // create#create_checkout_session-customer). Attaching is its own write, so payment_method.attached is delivered ("Occurs
  // whenever a new payment method is attached to a customer", docs.stripe.com/api/events/types) before what the card then
  // pays for. Where the documentation stops and the twin decides: the order of the events, which Stripe does not
  // guarantee (docs.stripe.com/webhooks#event-ordering). A gap: the customer's own opt-in to save a payment's card
  // (saved_payment_method_options.payment_method_save) is not modelled; the page offers no such box.
  const saves = existing.mode !== 'payment' || !!((ctx.row(CS, id)?._payment_intent_data ?? {}) as Row).setup_future_usage;
  const pm = made && customer && saves ? await ctx.write('payment_method', String(made.id), { customer }, 'payment_method.attach') : made;
  if (existing.mode === 'payment') {
    const amount = Number(existing.amount_total) || 0;
    const piId = ctx.mint('payment_intent');
    const pid = (ctx.row(CS, id)?._payment_intent_data ?? {}) as Row;
    const connect = {
      ...(pid.application_fee_amount !== undefined ? { application_fee_amount: Math.trunc(Number(pid.application_fee_amount) || 0) } : {}),
      ...(pid.transfer_data && typeof pid.transfer_data === 'object' ? { transfer_data: { destination: (pid.transfer_data as Row).destination } } : {}),
      ...(typeof pid.description === 'string' ? { description: pid.description } : {}),
      // the session's setup_future_usage is its PaymentIntent's (payment_intent_data: "A subset of parameters to be passed to PaymentIntent creation")
      ...(typeof pid.setup_future_usage === 'string' ? { setup_future_usage: pid.setup_future_usage } : {}),
      ...(nestedMetadata(pid.metadata) ? { metadata: nestedMetadata(pid.metadata) } : {}),
    };
    const fields = { amount, currency, id: piId, ...(customer ? { customer } : {}), ...(pm ? { payment_method: pm.id } : {}), ...connect };
    await created(ctx, 'payment_intent', fields, { status: 'succeeded', amount_received: amount, client_secret: mintClientSecret(piId, await ctx.secret(`client-secret:${piId}`)), livemode: false, payment_method_types: Array.isArray(existing.payment_method_types) ? existing.payment_method_types : ['card'] });
    const charge = await mintCharge(ctx, piId, fields, amount);
    await ctx.write('payment_intent', piId, { latest_charge: charge }, 'payment_intent.succeeded');
    link.payment_intent = piId;
    link.payment_status = 'paid';
  } else if (existing.mode === 'subscription') {
    if (customer) {
      // the subscription bills the session's own (already resolved) line items, and takes the
      // session's subscription_data: metadata, description, and a trial as its first period
      const now = Number(nowUnix(ctx.occurredAt));
      // "Line items with one-time Prices will be on the initial invoice only" (docs.stripe.com/api/checkout/sessions/
      // create#create_checkout_session-line_items): the subscription's items are the recurring ones
      const inline = (ctx.row(CS, id)?._price_data as Array<Row | null> | undefined) ?? [];
      const lines = ((existing.line_items as { data?: unknown } | undefined)?.data as Row[] | undefined) ?? [];
      const allLineItems = inline.some(Boolean) ? await sessionPrices(ctx, lines, inline) : lines;
      const sessionLineItems = allLineItems.filter((it) => !isOneTime(it));
      const oneTime = allLineItems.filter((it) => isOneTime(it));
      const { interval, interval_count } = resolveSubscriptionBillingInterval(sessionLineItems, finder(ctx));
      const subId = ctx.mint('subscription');
      // the session's view never carries its create-only subscription_data: read the stored row
      const raw = ctx.row(CS, id)?._subscription_data;
      const subData = (raw && typeof raw === 'object' ? raw : {}) as Row;
      const subMetadata = nestedMetadata(subData.metadata) ?? {};
      // a trial of `trial_period_days` from now, or to `trial_end` (docs.stripe.com/payments/checkout/free-trials)
      const trialEnd = resolveTrial(subData, now)?.end ?? null;
      const sub = await created(ctx, 'subscription', { customer, id: subId }, {
        status: trialEnd === null ? 'active' : 'trialing', livemode: false, currency, collection_method: 'charge_automatically',
        // a trial's end is the billing anchor (docs.stripe.com/api/subscriptions/create#create_subscription-trial_end)
        cancel_at_period_end: false, start_date: now, billing_cycle_anchor: trialEnd ?? now, metadata: subMetadata,
        description: typeof subData.description === 'string' ? subData.description : null,
        // the session's discount is the subscription's (docs.stripe.com/payments/checkout/discounts)
        discounts: sessionDiscount(ctx, id, customer, now), billing_schedules: [],
        trial_start: trialEnd === null ? null : now, trial_end: trialEnd,
        current_period_start: now, current_period_end: trialEnd ?? addBillingInterval(now, interval, interval_count),
        // Checkout saves the card as the subscription's default payment method (docs.stripe.com/payments/checkout/how-checkout-works)
        default_payment_method: pm?.id ?? null,
        items: buildSubscriptionItemsList(sessionLineItems, subId, now, finder(ctx)),
        automatic_tax: { enabled: false, liability: null }, billing_mode: { type: 'classic' },
        invoice_settings: { issuer: { type: 'self' } },
      });
      await storeItems(ctx, subId, ((sub.items as Row | undefined)?.data as Row[] | undefined) ?? []);
      // its first invoice, paid on the page by the card just entered (nothing is due on a trial's)
      // (docs.stripe.com/billing/subscriptions/overview#how-payments-work-subscriptions)
      const invoice = await draftSubscriptionInvoice(ctx, sub, { start: now, end: Number(sub.current_period_end), reason: 'subscription_create', trial: trialEnd !== null, once: oneTime });
      await collectSubscriptionInvoice(ctx, invoice, now, 'external');
      await ctx.write('subscription', subId, { latest_invoice: invoice }, 'subscription.update');
      link.subscription = sub.id;
      link.invoice = invoice;
    }
    link.payment_status = 'paid';
  } else link.setup_intent = await completeSetup(ctx, customer, pm);
  return link;
}

/** A subscription session's lines at completion, each inline `price_data` made the Price it generates ("Data used to
 *  generate a new Price object inline", the same page), under the product it names or one made from its product_data,
 *  so the subscription's items bill it. Where the documentation stops and the twin decides: such a Price is archived
 *  (active=false), as a subscription item's price_data makes one (docs.stripe.com/products-prices/manage-prices). */
export async function sessionPrices(ctx: HandlerContext, lines: Row[], inline: Array<Row | null>): Promise<Row[]> {
  const out: Row[] = [];
  for (const [i, line] of lines.entries()) {
    const d = inline[i];
    if (!d) { out.push(line); continue; }
    const pd = d.product_data && typeof d.product_data === 'object' ? (d.product_data as Row) : undefined;
    const product = typeof d.product === 'string' ? d.product : String((await created(ctx, 'product', { name: pd?.name ?? 'Item' }, { active: true, livemode: false, images: [], marketing_features: [], metadata: {}, updated: nowUnix(ctx.occurredAt) })).id);
    const r = d.recurring && typeof d.recurring === 'object' ? (d.recurring as Row) : undefined;
    const price = await created(ctx, 'price', {
      product, currency: String(d.currency ?? line.currency ?? 'usd').toLowerCase(),
      unit_amount: d.unit_amount_decimal !== undefined ? null : Math.trunc(Number(d.unit_amount) || 0),
      unit_amount_decimal: d.unit_amount_decimal !== undefined ? String(d.unit_amount_decimal) : String(Math.trunc(Number(d.unit_amount) || 0)),
      ...(r ? { recurring: { interval: r.interval, interval_count: Math.max(1, Math.trunc(Number(r.interval_count ?? 1)) || 1), usage_type: 'licensed', trial_period_days: null, meter: null } } : { recurring: null }),
    }, { active: false, livemode: false, billing_scheme: 'per_unit', type: r ? 'recurring' : 'one_time', metadata: {}, lookup_key: null, nickname: null, tax_behavior: 'unspecified' });
    out.push({ ...line, price });
  }
  return out;
}

/** A setup session saves the card through a succeeded SetupIntent (docs.stripe.com/payments/save-and-reuse?platform=checkout). */
export async function completeSetup(ctx: HandlerContext, customer: string | undefined, pm: Row | undefined): Promise<unknown> {
  const siId = ctx.mint('setup_intent');
  const si = await created(ctx, 'setup_intent', { id: siId, ...(customer ? { customer } : {}), ...(pm ? { payment_method: pm.id } : {}) }, { status: 'succeeded', usage: 'off_session', client_secret: mintClientSecret(siId, await ctx.secret(`client-secret:${siId}`)), payment_method_types: ['card'], livemode: false });
  return si.id;
}

/** The discount a completed subscription session gives its subscription. */
export function sessionDiscount(ctx: HandlerContext, id: string, customer: string, now: number): Row[] {
  const d = ctx.row(CS, id)?._discount as Row | undefined;
  const coupon = d && typeof d.coupon === 'string' ? ctx.get('coupon', d.coupon) : undefined;
  return coupon ? [{ ...buildDiscount(coupon, customer, now), promotion_code: d?.promotion_code ?? null, checkout_session: id }] : [];
}

/** The customer paying on the hosted page (src/screens/checkout.tsx): the external actor's move on the
 *  session's machine, then what the payment made, linked, and the session stored complete. */
export async function completeSession(ctx: HandlerContext, id: string, existing: Row, details: Row = {}, card?: EnteredCard): Promise<Row | Response> {
  const refused = ctx.legal(CS, 'status', 'PostCheckoutSessionsSession', existing.status, 'complete', id, 'external');
  if (refused) return ctx.refuse(refused);
  const link = await complete(ctx, id, existing, card);
  // the discount the buyer took is redeemed (shared.ts redeemCoupon)
  const d = ctx.row(CS, id)?._discount as Row | undefined;
  if (d) await redeemCoupon(ctx, d.coupon, d.promotion_code);
  // the session's url "is only present when the session is active" (docs.stripe.com/api/checkout/sessions/object)
  if (link.payment_status !== undefined) ctx.legal(CS, 'payment_status', 'PostCheckoutSessionsSession', existing.payment_status, String(link.payment_status), id, 'external');
  return ctx.write(CS, id, { ...details, ...link, url: null }, 'checkout.session.completed');
}

export const send = (ctx: HandlerContext, r: StripeResponse): Response => ctx.reply(r.body, r.status);

/** Stripe's error body: an invalid_request_error with the message, and the code when there is one. */
export const fail = (ctx: HandlerContext, message: string, status = 404, code?: string): Response => ctx.refuse({ status, message, ...(code ? { code } : {}) });

/** The request's path, as the list envelope's `url` carries it. */
export const path = (ctx: HandlerContext): string => new URL(ctx.call.request.url).pathname.replace(/\/+$/, '') || '/';

/** A path parameter, by the name the spec gives it. */
export const at = (ctx: HandlerContext, name: string): string => ctx.call.params[name] ?? '';

/** A resource's rows in Stripe's list order: newest first by `timeField`, ties by mint order (as the derived core breaks them). */
/** A subject's bookkeeping field (`_…`): kept on the stored row, never in the wire view ctx.get and ctx.rows answer. */
export const kept = (ctx: HandlerContext, resource: string, row: Row, key: string): unknown => ctx.row(resource, String(row.id), { withDeleted: true })?.[key];

/** A create's parameter that describes a confirmation, sent without confirm=true: the served spec gives each "This
 *  parameter can only be used with `confirm=true`" (off_session: "can only be used when confirm=true"); the message's
 *  wording is the twin's. Answers the refusal, or undefined. */
export function confirmOnly(ctx: HandlerContext, names: string[], confirm: boolean): Response | undefined {
  const sent = confirm ? undefined : names.find((n) => ctx.params[n] !== undefined);
  return sent ? fail(ctx, `\`${sent}\` can only be used when \`confirm\` is set to \`true\`.`, 400, 'parameter_invalid') : undefined;
}

/** A coupon applied (and the promotion code it came by): its times_redeemed, "Number of times this coupon has been
 *  applied to a customer" (the served spec's coupon), counts it, as the code's "Number of times this promotion code
 *  has been used" (its promotion_code). Where the documentation stops and the twin decides: reaching max_redemptions
 *  does not yet lapse the coupon. */
export async function redeemCoupon(ctx: HandlerContext, couponId: unknown, promotionCode?: unknown): Promise<void> {
  const coupon = typeof couponId === 'string' ? ctx.get('coupon', couponId) : undefined;
  if (coupon) await ctx.write('coupon', couponId as string, { times_redeemed: (Number(coupon.times_redeemed) || 0) + 1 }, 'coupon.redeemed');
  const code = typeof promotionCode === 'string' ? ctx.get('promotion_code', promotionCode) : undefined;
  if (code) await ctx.write('promotion_code', promotionCode as string, { times_redeemed: (Number(code.times_redeemed) || 0) + 1 }, 'promotion_code.redeemed');
}

export function newest(ctx: HandlerContext, resource: string, timeField = 'created'): Row[] {
  // an object Stripe gives no creation time is ordered by the one the twin keeps for it
  const raw = new Map(ctx.rowsRaw(resource).map((r) => [String(r.id), r]));
  const when = (r: Row): number => Number(r[timeField] ?? raw.get(String(r.id))?._created ?? 0);
  // ties by the order the World made them (an event's id is a digest, not a count)
  const rows = ctx.rows(resource);
  const made = new Map(rows.map((r, i) => [r, i]));
  return rows.sort((a, b) => {
    const ta = when(a), tb = when(b);
    if (tb !== ta) return tb - ta;
    return made.get(b)! - made.get(a)!;
  }).map((r) => ctx.expand(resource, r));
}

/** A context at the moment Stripe would have made a move time makes (a renewal, a payout on its schedule), so what
 *  the move writes carries that moment (its events' occurredAt, `created`, a charge's funds' available_on), not the
 *  moment a later request caught it up. */
export function at_(ctx: HandlerContext): (t: number) => Promise<HandlerContext> {
  return (t) => ctx.at(new Date(t * 1000).toISOString());
}

export function where(ctx: HandlerContext, items: Row[], spec: Record<string, (item: Row, value: unknown) => boolean>): Row[] {
  let out = items;
  for (const [key, pred] of Object.entries(spec)) {
    const value = ctx.params[key];
    if (value !== undefined) out = out.filter((item) => pred(item, value));
  }
  return out;
}

export function expandPaths(ctx: HandlerContext): string[][] {
  const expand = ctx.params.expand;
  return Array.isArray(expand) ? expand.map((p) => String(p).split('.')) : [];
}

/** A balance transaction as the clock reads it: available once its available_on has passed, the clock's move,
 *  asked of the machine as a write asks it (./ledger.ts). */
export function commonAsOf(ctx: HandlerContext, t: Row): Row {
  const due = Number(t.available_on);
  if (t.status !== 'pending' || !Number.isFinite(due) || due > Number(nowUnix(ctx.occurredAt))) return t;
  ctx.legal('balance_transaction', 'status', ctx.call.operation.id, 'pending', 'available', String(t.id), 'time');
  return { ...t, status: 'available' };
}

/** Stripe's expand walk (the kernel's, over the manifest's `embeds`): each dotted path replaces an id with the resource
 *  it holds, one segment at a time; an id the tree lacks stays an id. An embedded balance transaction reads as the clock
 *  has it (asOf), as its own retrieve does. */
export function expandRow(ctx: HandlerContext, resource: string, body: Row, paths: string[][]): Row {
  const asOf = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(asOf);
    if (!v || typeof v !== 'object') return v;
    const o = Object.fromEntries(Object.entries(v as Row).map(([k, x]) => [k, asOf(x)]));
    return o.object === 'balance_transaction' ? commonAsOf(ctx, o) : o;
  };
  const out = ctx.expand(resource, body, paths.map((p) => p.join('.')));
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, asOf(v)]));
}

/** One resource with the request's `expand[]` applied. */
export const expanded = (ctx: HandlerContext, resource: string, body: Row): Row => expandRow(ctx, resource, body, expandPaths(ctx));

export const resourceView = (ctx: HandlerContext, resource: string, id: string): Row | undefined => {
  const row = ctx.get(resource, id);
  return row ? ctx.expand(resource, row) : undefined;
};

/** Stripe's list envelope over rows already in list order: a page, `has_more`, and `expand[]=data.*`. */
export function list(ctx: HandlerContext, resource: string, items: Row[]): Response {
  const { page, hasMore } = paginate(items, ctx.params);
  const paths = expandPaths(ctx).filter((p) => p[0] === 'data').map((p) => p.slice(1)).filter((p) => p.length > 0);
  return ctx.reply({ object: 'list', url: path(ctx), has_more: hasMore, data: page.map((r) => expandRow(ctx, resource, r, paths)) });
}

/** Stripe's search over a resource's rows (`query` in its search language). */
export const search = (ctx: HandlerContext, resource: string, timeField = 'created'): Response => send(ctx, searchOver(newest(ctx, resource, timeField), ctx.params, path(ctx)));

/** A create as Stripe stamps it: the caller's id when it gave one (seeding uses real ids), else a
 *  minted one; `object`, the creation time, the defaults, then the request's own fields. An object
 *  Stripe gives no creation time keeps the twin's as `_created`, for ordering. (A request parameter the
 *  object has no field for stays on the row, where the rules read it; the wire answer leaves it out,
 *  ./version.ts.) */
export async function created(ctx: HandlerContext, resource: string, params: Row, defaults: Row, opts: { timeField?: string; operation?: string } = {}): Promise<Row> {
  const { id: provided, ...rest } = params;
  const type = ctx.storedType(resource);
  const id = typeof provided === 'string' && provided ? provided : ctx.mint(resource);
  const known = SPEC_FIELDS.get(resource);
  const timeField = opts.timeField ?? 'created';
  const stamped = !known || known.has(timeField) || timeField in defaults || timeField in rest ? timeField : '_created';
  const fields = { object: OBJECT_NAME[type] ?? type, [stamped]: nowUnix(ctx.occurredAt), ...defaults, ...rest };
  // source: spec:/components/schemas/subscription/properties/items/description "List of subscription items, each with an attached price."
  const children = resource === SUB ? ((fields.items as { data?: Row[] } | undefined)?.data ?? []) : [];
  if (resource === SUB) delete (fields as Row).items;
  // source: spec:/components/schemas/subscription_item/properties/price "price"
  if (resource === 'subscription_item') {
    const item = fields as Row;
    if (item.price && typeof item.price === 'object') item.price = (item.price as Row).id;
    delete item.plan; // the served subscription_item schema has no plan field
  }
  // source: spec:/components/schemas/account/properties/individual "person"
  if (resource === 'account' && (fields as Row).individual && typeof (fields as Row).individual === 'object') {
    const person = await created(ctx, 'person', { ...((fields as Row).individual as Row), account: id }, { metadata: {}, relationship: { representative: true } });
    (fields as Row).individual = person.id;
  }
  const row = await ctx.write(resource, id, fields, opts.operation ?? `${type}.create`);
  if (children.length) await storeItems(ctx, id, children);
  return ctx.expand(resource, row);
}

export const finder = (ctx: Pick<HandlerContext, 'rowsRaw'>): Find => (storedType, id) => {
  const r = ctx.rowsRaw(storedType, { withDeleted: true }).find((x) => x.id === id);
  // source: https://docs.stripe.com/testing "Generic decline 4000 0000 0000 0002"
  // Private test-card behavior is used for subsequent charges, never sent as a vendor field.
  return r ? { ...view(storedType, r as TwinResource), ...(r._declineOutcome !== undefined ? { _declineOutcome: r._declineOutcome } : {}) } : undefined;
};

/** The account's external_accounts list, rewritten from its external accounts after one is added or removed. */
export async function syncExternals(ctx: HandlerContext, account: string): Promise<void> {
  if (!ctx.get('account', account)) return;
  await ctx.write('account', account, { external_accounts: externalList(account, newest(ctx, 'external_account').filter((e) => e.account === account)) }, 'account.external_accounts');
}

export const pmMissing = (ctx: HandlerContext, id: string): Response => fail(ctx, `No such payment_method: '${id}'`, 404, 'resource_missing');

/** The card a charge was paid with, as its payment_method_details reports it
 *  (docs.stripe.com/api/charges/object#charge_object-payment_method_details): a stored PaymentMethod's card, a
 *  documented test name (pm_card_* or tok_*, the same cards), or a raw card; undefined for anything else. */
export function paymentMethodDetails(ctx: HandlerContext, ref: unknown): Row | undefined {
  let card: Row | undefined;
  // a payment method of another kind (a US bank account) is described by its own block, as the charge reports it
  const stored = typeof ref === 'string' && ref ? ctx.get(PM, ref) : undefined;
  // Stripe's US bank account test methods (pm_us_bank_account, pm_usBankAccount_*) are its test bank's account
  const pm = stored ?? (typeof ref === 'string' && /^pm_us_?bank_?account/i.test(ref) ? { type: 'us_bank_account', ...paymentMethodSubObject('us_bank_account', {}) } : undefined);
  if (pm && typeof pm.type === 'string' && pm.type !== 'card') {
    const own = (pm[pm.type] as Row | undefined) ?? {};
    const pick = ['account_holder_type', 'account_type', 'bank_name', 'fingerprint', 'last4', 'routing_number'];
    return { type: pm.type, [pm.type]: Object.fromEntries(pick.filter((k) => own[k] !== undefined).map((k) => [k, own[k]])) };
  }
  if (typeof ref === 'string' && ref) {
    const stored = ctx.get(PM, ref)?.card as Row | undefined;
    if (stored) card = stored;
    else card = testCardOf(ref);
  } else if (ref && typeof ref === 'object') card = paymentMethodSubObject('card', { card: ref }).card as Row;
  if (!card) return undefined;
  return {
    type: 'card',
    card: {
      brand: card.brand, last4: card.last4, exp_month: card.exp_month, exp_year: card.exp_year, funding: card.funding ?? 'credit',
      country: card.country ?? 'US', network: card.brand, fingerprint: card.fingerprint ?? null,
      checks: card.checks ?? { address_line1_check: null, address_postal_code_check: null, cvc_check: 'pass' },
      three_d_secure: null, wallet: null, installments: null, mandate: null,
    },
  };
}

// attaching needs an existing customer; a well-known test token (pm_card_visa, …) is a template:
// attaching it mints a new PaymentMethod on the customer carrying that card's outcome
/** Whether a payment method can be attached: a stored one, or a documented test name that attaching mints. */
export const attachable = (ctx: HandlerContext, id: string): boolean => !!ctx.get(PM, id) || (id.startsWith('pm_card_') && (id in TEST_TOKEN_DECLINES || id in AFTER_SUCCESS_CARDS));

export async function attachPaymentMethod(ctx: HandlerContext, id: string, customer: string): Promise<Row> {
  if (!ctx.get(PM, id)) return materializeTestMethod(ctx, id, customer);
  return ctx.write(PM, id, { customer }, 'payment_method.attach');
}

/** A documented test name (pm_card_visa, pm_card_visa_chargeDeclined, …) made a real PaymentMethod, as Stripe
 *  does when one is used: the brand and number it stands for (docs.stripe.com/testing#cards) and its outcome. */
export async function materializeTestMethod(ctx: HandlerContext, id: string, customer: string | null): Promise<Row> {
  const card = TEST_PM_CARDS[id] ?? { brand: 'visa', number: '4242424242424242' };
  const sub = paymentMethodSubObject('card', { card: { number: card.number } });
  (sub.card as Record<string, unknown>).brand = card.brand;
  const afterSuccess = AFTER_SUCCESS_CARDS[id]?.outcome;
  return created(ctx, PM, { type: 'card', customer, livemode: false, billing_details: noBilling, ...sub, _declineOutcome: TEST_TOKEN_DECLINES[id] ?? null, ...(afterSuccess ? { _afterSuccess: afterSuccess } : {}) }, {});
}

/** A PaymentMethod made from a confirm's `payment_method_data` ("If provided, this hash will be used to create a
 *  PaymentMethod", docs.stripe.com/api/setup_intents/confirm, docs.stripe.com/api/payment_intents/confirm), or none. */
export async function methodFromData(ctx: HandlerContext, data: unknown): Promise<string | undefined> {
  if (!data || typeof data !== 'object') return undefined;
  const d = data as Row;
  const type = typeof d.type === 'string' ? d.type : 'card';
  const made = await created(ctx, PM, {}, {
    type, customer: null, livemode: false,
    // source: spec:/paths/~1v1~1setup_intents~1{intent}~1confirm/post/requestBody/content/application~1x-www-form-urlencoded/schema/properties/payment_method_data/description "this hash creates a PaymentMethod"
    metadata: d.metadata && typeof d.metadata === 'object' ? d.metadata : {},
    billing_details: { ...noBilling, ...((d.billing_details as Row | undefined) ?? {}) },
    ...paymentMethodSubObject(type, d),
    // what follows its card's success (a dispute, funds straight to available), as a PaymentMethod created directly carries
    ...(type === 'card' && afterSuccessOf(ctx, d.card) ? { _afterSuccess: afterSuccessOf(ctx, d.card) } : {}),
    // and what a payment with its card answers: a test card the issuer declines, or one that asks the cardholder to
    // authenticate, entered as its number (Stripe.js sends it so), as the same card made a PaymentMethod directly does
    // source: https://docs.stripe.com/testing "Generic decline 4000 0000 0000 0002"
    // source: https://docs.stripe.com/testing "This card requires authentication on all transactions, regardless of how the card is set up."
    ...(type === 'card' ? { _declineOutcome: declineFor(() => undefined, { card: d.card }) ?? null, ...(requiresAuthentication({ card: d.card }) ? { _requiresAuthentication: true } : {}) } : {}),
  });
  return String(made.id);
}

/** Whether an intent sets up or pays with a bank account by micro-deposits because it asks for them:
 *  payment_method_options[us_bank_account][verification_method]=microdeposits with a us_bank_account method
 *  ("Microdeposit only verification", docs.stripe.com/payments/ach-direct-debit/set-up-payment). */
export function microdepositsAsked(ctx: HandlerContext, params: Row, intent: Row, pm: string | undefined): boolean {
  const options = ((params.payment_method_options ?? intent.payment_method_options) as Row | undefined)?.us_bank_account as Row | undefined;
  return options?.verification_method === 'microdeposits' && !!pm && ctx.get(PM, pm)?.type === 'us_bank_account';
}

// ── features: an entitlements feature granted to a product, at most once ──

/** A tiered price: tiers_mode and tiers, each tier with up_to and a unit or flat amount; no single unit_amount, and
 *  the last tier's up_to null (∞) (docs.stripe.com/products-prices/pricing-models#tiered-pricing). */
export async function tieredPrice(ctx: HandlerContext, params: Row): Promise<Response> {
  const mode = typeof params.tiers_mode === 'string' ? params.tiers_mode : '';
  if (mode !== 'graduated' && mode !== 'volume') return fail(ctx, 'Missing required param: tiers_mode (graduated or volume).', 400, 'parameter_missing');
  const rawTiers = Array.isArray(params.tiers) ? (params.tiers as Row[]) : [];
  if (rawTiers.length === 0) return fail(ctx, 'Missing required param: tiers.', 400, 'parameter_missing');
  const tiers = rawTiers.map((t) => {
    const upToRaw = t.up_to;
    return {
      up_to: upToRaw === 'inf' || upToRaw === undefined || upToRaw === null ? null : Math.trunc(Number(upToRaw)),
      unit_amount: t.unit_amount !== undefined ? Math.trunc(Number(t.unit_amount)) : null,
      unit_amount_decimal: t.unit_amount !== undefined ? String(Math.trunc(Number(t.unit_amount))) : null,
      flat_amount: t.flat_amount !== undefined ? Math.trunc(Number(t.flat_amount)) : null,
      flat_amount_decimal: t.flat_amount !== undefined ? String(Math.trunc(Number(t.flat_amount))) : null,
    };
  });
  if (tiers.some((t) => t.unit_amount === null && t.flat_amount === null)) return fail(ctx, 'Each tier must specify a unit_amount or flat_amount.', 400, 'parameter_invalid_empty');
  const { tiers: _t, ...rest } = params;
  return ctx.reply(await created(ctx, 'price', { ...rest, billing_scheme: 'tiered', tiers_mode: mode, tiers, unit_amount: null }, { active: true, livemode: false, type: rest.recurring ? 'recurring' : 'one_time', metadata: {} }));
}

/** Whether the intent's caller named its methods: on create (TYPES_GIVEN), or by an update that set its
 *  payment_method_types ("Alternatively, update the allowed payment_method_types for this PaymentIntent",
 *  methodNotAllowed below), which the generic update writes as given, so the intent's history holds it. */
export const typesGiven = (ctx: HandlerContext, id: string): boolean =>
  ctx.rowsRaw(TYPES_GIVEN).some((r) => r.id === id)
  || ctx.history(PI, id).some((e) => e.operation !== 'payment_intent.create' && Array.isArray(e.fields?.payment_method_types));

export const paymentIntentsSend = (ctx: HandlerContext, r: StripeResponse): Response => ctx.reply(r.body, r.status);

export async function mintCharge(ctx: HandlerContext, piId: string, pi: Row, amount: number): Promise<string> {
  const already = ctx.get(PI, piId)?.latest_charge;
  if (typeof already === 'string' && ctx.get('charge', already)?.status === 'succeeded') return already;
  const chargeId = ctx.mint('charge');
  const bt = await settleCharge(ctx, chargeId, amount, String(pi.currency ?? 'usd'), typeof pi.payment_method === 'string' ? pi.payment_method : undefined);
  await created(ctx, 'charge', {
    id: chargeId, amount, currency: pi.currency ?? 'usd', payment_intent: piId,
    ...(typeof pi.customer === 'string' ? { customer: pi.customer } : {}),
    ...(typeof pi.payment_method === 'string' ? { payment_method: pi.payment_method } : {}),
    ...(typeof pi.invoice === 'string' ? { invoice: pi.invoice } : {}),
    ...intentCarries(pi),
  }, { ...chargeDefaults(chargeId, amount, true, ctx.occurredAt), balance_transaction: bt, payment_method_details: paymentMethodDetails(ctx, pi.payment_method) ?? null }, { operation: 'charge.succeeded' });
  await afterCharge(ctx, chargeId, { amount, currency: String(pi.currency ?? 'usd'), payment_intent: piId, application_fee_amount: pi.application_fee_amount, destination: (pi.transfer_data as Row | undefined)?.destination }, pi.payment_method);
  return chargeId;
}

/** A manual-capture intent's authorization: "Separate payment authorization and capture to create a charge now, but
 *  capture funds later", and on capture "A partial capture automatically releases the remaining amount"
 *  (docs.stripe.com/payments/place-a-hold-on-a-payment-method). The charge succeeded and is not captured, holding the
 *  amount until capture_before, with nothing on the balance yet. Written as
 *  charge.succeeded, as a charge made with capture=false is (charges.ts); its capture writes charge.captured
 *  (captureAuthorization). Where the documentation stops and the twin decides: the events page names no event for an
 *  authorization of its own, so the authorized charge sends charge.succeeded, its status being succeeded. */
export async function authorizeCharge(ctx: HandlerContext, piId: string, pi: Row, amount: number): Promise<string> {
  const chargeId = ctx.mint('charge');
  await created(ctx, 'charge', {
    id: chargeId, amount, currency: pi.currency ?? 'usd', payment_intent: piId,
    ...(typeof pi.customer === 'string' ? { customer: pi.customer } : {}),
    ...(typeof pi.payment_method === 'string' ? { payment_method: pi.payment_method } : {}),
    ...(typeof pi.invoice === 'string' ? { invoice: pi.invoice } : {}),
    ...intentCarries(pi),
  }, { ...chargeDefaults(chargeId, amount, false, ctx.occurredAt), balance_transaction: null, payment_method_details: paymentMethodDetails(ctx, pi.payment_method) ?? null }, { operation: 'charge.succeeded' });
  return chargeId;
}

/**
 * An intent an invoice collects through succeeded (the default_incomplete subscription flow: create
 * now, confirm client-side): its invoice is paid and, when it is a subscription's first, the
 * subscription leaves incomplete for active. Both are moves the invoice and subscription machines
 * declare under the confirming operation. No-op when the intent names no invoice, or the invoice is
 * already paid (a duplicate confirm) or void (voiding ends what it collects).
 */
export async function payInvoiceOf(ctx: HandlerContext, pi: Row, operationId: string, actor?: 'vendor'): Promise<void> {
  const invoiceId = typeof pi.invoice === 'string' ? pi.invoice : undefined;
  const invoice = invoiceId ? ctx.get('invoice', invoiceId) : undefined;
  if (!invoiceId || !invoice || invoice.status === 'paid' || invoice.status === 'void') return;
  await finishInvoiceIntent(ctx, invoice, invoiceId, operationId, actor);
}

/** An invoice-linked intent read back from a live account; the served create API cannot set invoice. */
export async function finishInvoiceIntent(ctx: HandlerContext, invoice: Row, invoiceId: string, operationId: string, actor?: 'vendor'): Promise<void> {
  if (ctx.legal('invoice', 'status', operationId, invoice.status, 'paid', invoiceId, actor)) return;
  const amount = Number(invoice.total ?? invoice.amount_due) || 0;
  // `invoice.pay` is the event the standalone pay action sends: invoice.paid
  await ctx.write('invoice', invoiceId, {
    status: 'paid', paid: true, amount_paid: amount, amount_remaining: 0,
    status_transitions: { ...((invoice.status_transitions as object) ?? {}), paid_at: nowUnix(ctx.occurredAt) },
  }, 'invoice.pay');
  const subId = typeof invoice.subscription === 'string' ? invoice.subscription : undefined;
  const sub = subId ? resourceView(ctx, 'subscription', subId) : undefined;
  if (subId && sub && sub.status === 'incomplete' && !ctx.legal('subscription', 'status', operationId, sub.status, 'active', subId, actor)) {
    await ctx.write('subscription', subId, { status: 'active' }, 'subscription.update');
  }
}

/** The type of the payment method an intent is paid with: its PaymentMethod's, or a documented test name's (pm_card_*,
 *  tok_* a card; pm_usBankAccount_* a US bank account), else unknown. */
export function methodType(ctx: HandlerContext, method: unknown): string | undefined {
  if (typeof method !== 'string' || !method) return undefined;
  const row = ctx.get('payment_method', method);
  if (row) return typeof row.type === 'string' ? row.type : undefined;
  if (/^pm_us_?bank_?account/i.test(method)) return 'us_bank_account';
  if (/^(pm_card_|tok_)/.test(method)) return 'card';
  return undefined;
}

/** A confirm with a payment method of a type the intent's caller did not allow, refused as Stripe refuses it: "The
 *  PaymentMethod provided (card_present) is not allowed for this PaymentIntent. Please attach a PaymentMethod of one of
 *  the following types: card. Alternatively, update the allowed payment_method_types for this PaymentIntent to include
 *  "card_present"" (a real answer quoted in github.com/stripe/stripe-terminal-react-native/issues/745, an intent made
 *  with payment_method_types ['card']). Only a list the caller gave restricts: without one Stripe offers the methods
 *  the account enables, which the twin does not model. Where the evidence stops: that answer's code is not quoted; the
 *  twin answers payment_intent_invalid_parameter ("One or more provided parameters wasn't allowed for the given
 *  operation on the PaymentIntent", docs.stripe.com/error-codes), param payment_method. */
export function methodNotAllowed(ctx: HandlerContext, existing: Row, params: Row): Response | undefined {
  const types = Array.isArray(params.payment_method_types) ? params.payment_method_types.map(String)
    : Array.isArray(params.allowed_payment_method_types) ? params.allowed_payment_method_types.map(String)
    : typesGiven(ctx, String(existing.id)) && Array.isArray(existing.payment_method_types) ? (existing.payment_method_types as unknown[]).map(String) : undefined;
  if (!types) return undefined;
  const type = methodType(ctx, params.payment_method ?? existing.payment_method);
  if (!type || types.includes(type)) return undefined;
  return ctx.refuse({ status: 400, code: 'payment_intent_invalid_parameter', param: 'payment_method', message: `The PaymentMethod provided (${type}) is not allowed for this PaymentIntent. Please attach a PaymentMethod of one of the following types: ${types.join(', ')}. Alternatively, update the allowed payment_method_types for this PaymentIntent to include "${type}"` });
}

// Confirmation controls are request instructions, absent from the pinned PaymentIntent object.
// source: spec:/paths/~1v1~1payment_intents~1{intent}~1confirm/post/requestBody/content/application~1x-www-form-urlencoded/schema/properties/return_url/description "The URL to redirect your customer back to after they authenticate or cancel their payment"
export function intentFields(params: Record<string, unknown>): Record<string, unknown> {
  const { confirm: _confirm, amount_to_confirm: _amount, confirmation_token: _token, error_on_requires_action: _error,
    expand: _expand, mandate: _mandate, mandate_data: _mandateData, off_session: _offSession,
    payment_method_data: _methodData, radar_options: _radar, return_url: _returnUrl, use_stripe_sdk: _sdk, ...fields } = params;
  return fields;
}

/** Confirm an intent the confirm machine allows to move: the confirm action, and a create with `confirm=true`. */
export async function confirmIntent(ctx: HandlerContext, existing: Record<string, unknown>, params: Record<string, unknown>): Promise<Response> {
  const id = String(existing.id);
  // a payment names a mandate only an active one authorizes: an inactive mandate "was rejected, revoked, or previously
  // used, and may not be used to initiate future payments" (docs.stripe.com/api/mandates/object), refused as
  // payment_intent_mandate_invalid, "The provided mandate is invalid and can't be used for the payment intent"
  // (docs.stripe.com/error-codes)
  const named = typeof params.mandate === 'string' ? params.mandate : typeof existing.mandate === 'string' ? existing.mandate : undefined;
  if (named && ctx.get('mandate', named)?.status !== 'active') return fail(ctx, 'The provided mandate is invalid and can\'t be used for the payment intent.', 400, 'payment_intent_mandate_invalid');
  const notAllowed = methodNotAllowed(ctx, existing, params);
  if (notAllowed) return notAllowed;
  // a declining test card leaves the intent needing a payment method, with the error on it and a 402
  const decline = declineFor(finder(ctx), params, existing);
  if (decline) {
    // Stripe records the attempt: a failed charge the intent's latest_charge names, the declined card on
    // last_payment_error (a test name made a real PaymentMethod), and no payment_method left on the intent
    // (docs.stripe.com/payments/paymentintents/lifecycle, docs.stripe.com/declines)
    const ref = params.payment_method ?? existing.payment_method;
    let pmId = typeof ref === 'string' ? ref : undefined;
    if (pmId && !ctx.get('payment_method', pmId) && pmId.startsWith('pm_card_')) pmId = String((await materializeTestMethod(ctx, pmId, typeof existing.customer === 'string' ? existing.customer : null)).id);
    const pm = pmId ? ctx.get('payment_method', pmId) : undefined;
    const amount = Number(params.amount ?? existing.amount) || 0;
    const chargeId = ctx.mint('charge');
    await created(ctx, 'charge', {
      id: chargeId, amount, currency: existing.currency ?? 'usd', payment_intent: id,
      ...(typeof existing.customer === 'string' ? { customer: existing.customer } : {}),
      ...(pmId ? { payment_method: pmId } : {}),
      ...intentCarries({ ...existing, ...intentFields(params) }),
    }, {
      ...chargeDefaults(chargeId, amount, false, ctx.occurredAt), status: 'failed', paid: false, captured: false, capture_before: null,
      failure_code: decline.code, failure_message: decline.message, balance_transaction: null,
      outcome: { type: 'issuer_declined', network_status: 'declined_by_network', reason: decline.decline_code ?? decline.code, risk_level: 'normal', seller_message: 'The bank did not return any further details with this decline.' },
      payment_method_details: pmId ? paymentMethodDetails(ctx, pmId) ?? null : null,
    }, { operation: 'charge.failed' }); // "Occurs whenever a failed charge attempt occurs." (docs.stripe.com/api/events/types)
    const { payment_method: _pm, ...rest } = params;
    const last_payment_error = { type: 'card_error', code: decline.code, ...(decline.decline_code ? { decline_code: decline.decline_code } : {}), message: decline.message, param: 'card', charge: chargeId, payment_method: pm ?? null };
    const failed = await ctx.write(PI, id, { ...intentFields(rest), payment_method: null, latest_charge: chargeId, status: 'requires_payment_method', last_payment_error }, 'payment_intent.payment_failed');
    return paymentIntentsSend(ctx, cardError(decline, { payment_intent: failed, charge: chargeId }));
  }
  // a bank debit that needs micro-deposit verification waits in requires_action
  const method = typeof params.payment_method === 'string' ? params.payment_method : typeof existing.payment_method === 'string' ? existing.payment_method : undefined;
  // a bank transfer is paid from the customer's cash balance, or waits for the transfer (fundFromCashBalance)
  if (method && ctx.get('payment_method', method)?.type === 'customer_balance') return ctx.reply(ctx.expand(PI, await fundFromCashBalance(ctx, { ...existing, ...intentFields(params) }, intentFields(params))));
  if (requiresMicrodeposits(params, existing) || microdepositsAsked(ctx, params, existing, method)) {
    return ctx.reply(ctx.expand(PI, await ctx.write(PI, id, { ...intentFields(params), status: 'requires_action', next_action: microdepositsNextAction(), last_payment_error: null }, 'payment_intent.requires_action')));
  }
  // 3DS: the first confirm asks for authentication; a second one completes it
  if (existing.status !== 'requires_action' && (requiresAuthentication(params, existing) || (!!method && ctx.row(PM, method)?._requiresAuthentication === true))) {
    return ctx.reply(ctx.expand(PI, await ctx.write(PI, id, { ...intentFields(params), status: 'requires_action', next_action: threeDsNextAction(), last_payment_error: null }, 'payment_intent.requires_action')));
  }
  // manual capture authorizes and waits for /capture: the authorization is a charge, succeeded and not captured, the
  // intent's latest_charge
  if ((params.capture_method ?? existing.capture_method) === 'manual') {
    const amount = Number(existing.amount ?? params.amount ?? 0);
    const charge = await authorizeCharge(ctx, id, { ...existing, ...intentFields(params) }, amount);
    return ctx.reply(ctx.expand(PI, await ctx.write(PI, id, { ...intentFields(params), status: 'requires_capture', amount_capturable: amount, amount_received: 0, next_action: null, last_payment_error: null, latest_charge: charge }, 'payment_intent.amount_capturable_updated')));
  }
  // a bank debit is submitted and settles later (beginBankDebit)
  if (isBankDebit(ctx, method)) return ctx.reply(ctx.expand(PI, await beginBankDebit(ctx, id, intentFields(params))));
  const amount = Number(existing.amount ?? params.amount ?? 0);
  // a succeeded intent has a Charge, and latest_charge names it: what a refund of it lands on
  const charge = await mintCharge(ctx, id, { ...existing, ...intentFields(params) }, amount);
  const body = await ctx.write(PI, id, { ...intentFields(params), status: 'succeeded', amount_received: amount, next_action: null, last_payment_error: null, latest_charge: charge }, 'payment_intent.confirm');
  await payInvoiceOf(ctx, body, 'PostPaymentIntentsIntentConfirm');
  return ctx.reply(ctx.expand(PI, body));
}

/** Whether the method an intent is confirmed with is a bank debit: a us_bank_account PaymentMethod, or one of Stripe's
 *  test bank accounts named as one (pm_usBankAccount_*, pm_us_bank_account). */
export function isBankDebit(ctx: HandlerContext, method: unknown): boolean {
  if (typeof method !== 'string') return false;
  return ctx.get('payment_method', method)?.type === 'us_bank_account' || /^pm_us_?bank_?account/i.test(method);
}

/** Whether a bank debit stays processing: the page's pm_usBankAccount_processing, or its account 000000000009. */
export function staysProcessing(ctx: HandlerContext, method: unknown): boolean {
  if (method === 'pm_usBankAccount_processing') return true;
  const bank = typeof method === 'string' ? (ctx.get('payment_method', method)?.us_bank_account as Row | undefined) : undefined;
  return bank?.last4 === '0009';
}

/** A bank debit submitted: the intent processes, nothing received yet, sent as payment_intent.processing; it is due to
 *  settle at this instant, unless its test account stays processing. */
export async function beginBankDebit(ctx: HandlerContext, id: string, fields: Row): Promise<Row> {
  const method = fields.payment_method ?? ctx.get(PI, id)?.payment_method;
  return ctx.write(PI, id, { ...fields, status: 'processing', amount_received: 0, next_action: null, last_payment_error: null, _settles_at: staysProcessing(ctx, method) ? null : Number(nowUnix(ctx.occurredAt)) }, 'payment_intent.processing');
}

/** Time's settling of bank debits, caught up to the World's clock: each processing debit whose moment has come succeeds
 *  then, its Charge made and the invoice it collects for paid. */
export async function settleBankDebits(ctx: HandlerContext): Promise<void> {
  const now = Number(nowUnix(ctx.occurredAt));
  const due = ctx.rowsRaw(PI).filter((p) => p.status === 'processing' && typeof p._settles_at === 'number' && p._settles_at <= now).sort((a, b) => Number(a._settles_at) - Number(b._settles_at));
  for (const pi of due) {
    const id = String(pi.id);
    const c = await at_(ctx)(Number(pi._settles_at));
    c.legal(PI, 'status', ctx.call.operation.id, 'processing', 'succeeded', id, 'vendor');
    const amount = Number(pi.amount) || 0;
    const charge = await mintCharge(c, id, pi, amount);
    const body = await c.write(PI, id, { status: 'succeeded', amount_received: amount, latest_charge: charge, _settles_at: null }, 'payment_intent.succeeded');
    // (a debit run under a mandate names it on its charge, and a single-use mandate is spent by it, at Stripe; the twin
    // makes no mandate: micro-deposit verification, which accepts one, is the gap here, ../manifest.ts unmodeled)
    await payInvoiceOf(c, body, ctx.call.operation.id, 'vendor');
  }
}

/** A customer_balance intent funded from the customer's cash balance: paid when the balance covers it ("If the customer
 *  already has a balance high enough to cover the payment amount, the PaymentIntent immediately succeeds"), else
 *  waiting for a transfer: "If the customer balance isn’t high enough to cover the request amount, the PaymentIntent
 *  shows a requires_action status ... next_action ... display_bank_transfer_instructions" with the amount_remaining
 *  (docs.stripe.com/payments/bank-transfers/accept-a-payment). Answers the intent as written. */
export async function fundFromCashBalance(ctx: HandlerContext, pi: Row, fields: Row = {}): Promise<Row> {
  const customer = typeof pi.customer === 'string' ? pi.customer : '';
  const currency = String(pi.currency ?? 'usd');
  // what the customer's funded cash balance holds in this currency, from its ledger
  const available = customer ? ctx.rows('customer_cash_balance_transaction').filter((t) => t.customer === customer && String(t.currency) === currency).reduce((n, t) => n + (Number(t.net_amount) || 0), 0) : 0;
  const amount = Number(pi.amount) || 0;
  if (available >= amount) return payFromCashBalance(ctx, pi, fields, { customer, currency, available, amount });
  // not enough yet: the intent waits for the rest, with the instructions to send it
  const next_action = { type: 'display_bank_transfer_instructions', display_bank_transfer_instructions: { amount_remaining: amount - available, currency, type: 'us_bank_transfer' } };
  return ctx.write(PI, String(pi.id), { ...fields, status: 'requires_action', next_action }, 'payment_intent.requires_action');
}

/** A customer_balance intent the customer's funded cash balance pays: its ledger records what was applied, and the intent
 *  succeeds with its charge. */
export async function payFromCashBalance(ctx: HandlerContext, pi: Row, fields: Row, o: { customer: string; currency: string; available: number; amount: number }): Promise<Row> {
  await created(ctx, 'customer_cash_balance_transaction', { customer: o.customer }, { currency: o.currency, type: 'applied_to_payment', net_amount: -o.amount, ending_balance: o.available - o.amount, applied_to_payment: { payment_intent: String(pi.id) }, livemode: false });
  const charge = await mintCharge(ctx, String(pi.id), { ...pi, ...fields }, o.amount);
  return ctx.write(PI, String(pi.id), { ...fields, status: 'succeeded', next_action: null, amount_received: o.amount, last_payment_error: null, latest_charge: charge }, 'payment_intent.succeeded');
}

/** Whether a charge's funds go straight to the available balance: a bypass card as a raw number, a test name (pm_card_*
 *  or tok_*), or a stored PaymentMethod made from one (which records it as what follows its success, after-payment.ts);
 *  or a US bank account, stored or one of Stripe's test bank accounts named as one (pm_usBankAccount_*). */
export function bypassesPending(ctx: HandlerContext, card: string | undefined): boolean {
  if (!card) return false;
  const stored = ctx.row('payment_method', card);
  // the row carries what the method recorded; its type is the vendor object's (ctx.get), not the row's envelope
  if (stored) return stored._afterSuccess === 'available' || ctx.get('payment_method', card)?.type === 'us_bank_account';
  if (/^pm_us_?bank_?account/i.test(card)) return true;
  return BYPASS_NUMBERS.has(card.replace(/\D/g, '')) || card.replace(/^tok_/, 'pm_card_') in BYPASS_PENDING_CARDS;
}

/** The connected account a request acts for, or undefined for the platform. */
// The platform's own account ID denotes the same balance as an omitted Stripe-Account header.
export const actingAccount = (ctx: HandlerContext): string | undefined => { const id = ctx.call.request.headers.get('stripe-account'); return id && id !== PLATFORM_ACCOUNT_ID ? id : undefined; };

/** A ledger entry on an account's balance: the acting account's unless one is named (null names the platform). */
export async function write(ctx: HandlerContext, fields: Row, account: string | null | undefined = actingAccount(ctx)): Promise<string> {
  // a credit available at once waits for the drain's balance.available (settleDueEntries)
  const unsent = (fields.status ?? 'available') === 'available' && Number(fields.net) > 0 ? { [UNSENT]: true } : {};
  const bt = await created(ctx, BT, {}, { status: 'available', fee_details: [], description: null, exchange_rate: null, balance_type: 'payments', ...fields, ...unsent, ...(account ? { _account: account } : {}) });
  return String(bt.id);
}

/** A captured charge's credit: its amount less the fee, pending two days unless the card bypasses the pending
 *  balance (bypassesPending), when it is due at once. The
 *  caller mints the charge's id first and stores the returned id as the charge's balance_transaction. */
export async function settleCharge(ctx: HandlerContext, chargeId: string, amount: number, currency: string, card?: string): Promise<string> {
  const now = Number(nowUnix(ctx.occurredAt));
  const fee = feeOf(amount);
  const atOnce = bypassesPending(ctx, card);
  const id = await write(ctx, {
    amount, currency, fee, net: amount - fee, type: 'charge', reporting_category: 'charge', source: chargeId,
    ...(atOnce ? { status: 'available', available_on: now } : { status: 'pending', available_on: now + 2 * DAY }),
    fee_details: fee ? [{ amount: fee, application: null, currency, description: 'Stripe processing fees', type: 'stripe_fee' }] : [],
  });
  return id;
}

/** A refund's debit, at once, on the acting account's balance unless one is named (null names the platform). */
export async function settleRefund(ctx: HandlerContext, refundId: string, amount: number, currency: string, account: string | null | undefined = actingAccount(ctx)): Promise<string> {
  return write(ctx, { amount: -amount, currency, fee: 0, net: -amount, type: 'refund', reporting_category: 'refund', source: refundId, available_on: Number(nowUnix(ctx.occurredAt)) }, account);
}

/** What an account had available in a currency at a moment: every entry of its payments balance whose funds had come
 *  due by then. */
export function availableAt(ctx: HandlerContext, account: string | undefined, currency: string, at: number): number {
  let sum = 0;
  for (const t of ctx.rowsRaw(BT)) {
    if (!onAccount(t, account) || t.balance_type === 'issuing' || String(t.currency ?? 'usd') !== currency) continue;
    const due = Number(t.available_on ?? t.created);
    if (Number.isFinite(due) && due <= at) sum += Number(t.net ?? 0);
  }
  return sum;
}

/** The moments after `from` and up to `until` when funds of an account came due, in order: when a held refund can
 *  next be covered. */
export function fundsDueBetween(ctx: HandlerContext, account: string | undefined, currency: string, from: number, until: number): number[] {
  const times = ctx.rowsRaw(BT).filter((t) => onAccount(t, account) && String(t.currency ?? 'usd') === currency).map((t) => Number(t.available_on ?? t.created)).filter((d) => Number.isFinite(d) && d > from && d <= until);
  return [...new Set(times)].sort((a, b) => a - b);
}

/** A dispute's debit, at once: the disputed amount and the dispute fee (the twin's 1500 cents, Stripe's US $15). */
export async function settleDispute(ctx: HandlerContext, disputeId: string, amount: number, currency: string): Promise<string> {
  const fee = 1500;
  return write(ctx, {
    amount: -amount, currency, fee, net: -amount - fee, type: 'adjustment', reporting_category: 'dispute', source: disputeId, available_on: Number(nowUnix(ctx.occurredAt)),
    fee_details: [{ amount: fee, application: null, currency, description: 'Dispute fee', type: 'stripe_fee' }],
  });
}

/** An account's ledger entries an automatic payout has not yet paid out: every entry on its payments balance that no
 *  automatic payout took (the automatic payouts' own debits excluded), as stored. */
export function unpaidEntries(ctx: HandlerContext, account: string | undefined): Row[] {
  const automatic = new Set(ctx.rowsRaw('payout').filter((p) => p.automatic === true).map((p) => p.id));
  return ctx.rowsRaw(BT).filter((t) => onAccount(t, account) && t.balance_type !== 'issuing' && !t._payout && !automatic.has(t.source));
}

/** An automatic payout's debit at `at`, and the entries it pays out marked with it, so the ledger lists them under
 *  the payout (docs.stripe.com/api/balance_transactions/list#balance_transaction_list-payout). */
export async function settleAutomaticPayout(ctx: HandlerContext, payoutId: string, amount: number, currency: string, account: string | undefined, at: number, entries: Row[]): Promise<string> {
  for (const t of entries) await ctx.write(BT, String(t.id), { _payout: payoutId }, 'balance_transaction.paid_out');
  return write(ctx, { amount: -amount, currency, fee: 0, net: -amount, type: 'payout', reporting_category: 'payout', source: payoutId, available_on: at, _payout: payoutId }, account ?? null);
}

/** A payout's debit (negative) or a cancellation's or reversal's credit (positive), at once, on the payout's account. */
export async function settlePayout(ctx: HandlerContext, payoutId: string, amount: number, currency: string, account: string | null | undefined = actingAccount(ctx)): Promise<string> {
  const type = amount < 0 ? 'payout' : 'payout_cancel';
  return write(ctx, { amount, currency, fee: 0, net: amount, type, reporting_category: type === 'payout' ? 'payout' : 'payout_reversal', source: payoutId, available_on: Number(nowUnix(ctx.occurredAt)) }, account);
}

/** A transfer's two entries: out of the platform's balance at once, into the destination's when `fromCharge` (its
 *  charge's funds' availability) comes (a plain transfer, with no `fromCharge`, moves funds available already).
 *  Answers the platform's entry. */
export async function settleTransfer(ctx: HandlerContext, transferId: string, amount: number, currency: string, destination: string, fromCharge?: number, fromPending = false): Promise<string> {
  const availableOn = fromCharge ?? Number(nowUnix(ctx.occurredAt));
  const settled = availableOn <= Number(nowUnix(ctx.occurredAt));
  // a transfer from a charge's pending funds (source_transaction) leaves the platform when they arrive, not before
  const platform = await write(ctx, { amount: -amount, currency, fee: 0, net: -amount, type: 'transfer', reporting_category: 'transfer', source: transferId, ...(fromPending ? { status: settled ? 'available' : 'pending', available_on: availableOn } : { available_on: Number(nowUnix(ctx.occurredAt)) }) }, null);
  await write(ctx, { amount, currency, fee: 0, net: amount, type: 'payment', reporting_category: 'charge', source: transferId, status: settled ? 'available' : 'pending', available_on: availableOn }, destination);
  return platform;
}

/** A direct charge's application fee: out of the connected account's balance, into the platform's. */
export async function settleApplicationFee(ctx: HandlerContext, feeId: string, amount: number, currency: string, account: string): Promise<string> {
  await write(ctx, { amount: -amount, currency, fee: 0, net: -amount, type: 'application_fee', reporting_category: 'platform_earning', source: feeId, available_on: Number(nowUnix(ctx.occurredAt)) }, account);
  return write(ctx, { amount, currency, fee: 0, net: amount, type: 'application_fee', reporting_category: 'platform_earning', source: feeId, available_on: Number(nowUnix(ctx.occurredAt)) }, null);
}

/** Time's settlements, written: each entry on the acting account's balance whose funds came due by the World's clock
 *  moves pending → available (the clock's move the machine allows), so a settlement is recorded once. A read already
 *  sees it (asOf); the record is what lets Stripe's balance.available be sent once (./front.ts, the drain).
 *  Funds that were available at once and not yet sent are taken too, and marked sent. Answers the entries taken. */
export async function settleDueEntries(ctx: HandlerContext, account: string | undefined = actingAccount(ctx)): Promise<Row[]> {
  const now = Number(nowUnix(ctx.occurredAt));
  const moved: Row[] = [];
  for (const t of ctx.rowsRaw(BT)) {
    if (!onAccount(t, account)) continue;
    if (t.status === 'available' && t[UNSENT] === true) {
      await ctx.write(BT, String(t.id), { [UNSENT]: false }, 'balance_transaction.available_sent');
      moved.push(t);
      continue;
    }
    if (t.status !== 'pending' || !(Number(t.available_on) <= now)) continue;
    if (ctx.legal(BT, 'status', ctx.call.operation.id, 'pending', 'available', String(t.id), 'time')) continue;
    await ctx.write(BT, String(t.id), { status: 'available' }, 'balance_transaction.available');
    moved.push(t);
  }
  return moved;
}

/** An account's balance, by currency: what the clock has made available, what is still pending, and Issuing's own. */
export function balanceOf(ctx: HandlerContext, account: string | undefined = actingAccount(ctx)): { available: Map<string, number>; pending: Map<string, number>; issuing: Map<string, number> } {
  const available = new Map<string, number>();
  const pending = new Map<string, number>();
  const issuing = new Map<string, number>();
  for (const raw of ctx.rowsRaw(BT)) {
    if (!onAccount(raw, account)) continue;
    const t = commonAsOf(ctx, raw);
    const cur = String(t.currency ?? 'usd');
    const net = Number(t.net ?? 0);
    const bucket = t.balance_type === 'issuing' ? issuing : t.status === 'available' ? available : pending;
    bucket.set(cur, (bucket.get(cur) ?? 0) + net);
  }
  return { available, pending, issuing };
}

/** balance_insufficient when a payout or transfer would take more than the account has available in its currency. */
export function refusePayout(ctx: HandlerContext, amount: number, currency: string, account: string | undefined = actingAccount(ctx)): Response | undefined {
  const have = balanceOf(ctx, account).available.get(currency) ?? 0;
  if (amount <= have) return undefined;
  return fail(ctx, "The transfer or payout couldn't be completed because the associated account doesn't have a sufficient balance available.", 400, 'balance_insufficient');
}

/** The ids of the ledger entries on the acting account's balance. */
export const mine = (ctx: HandlerContext): Set<unknown> => new Set(ctx.rowsRaw(BT).filter((t) => onAccount(t, actingAccount(ctx))).map((t) => t.id));

export const chargeMissing = (ctx: HandlerContext, id: string): Response => fail(ctx, `No such charge: '${id}'`, 404, 'resource_missing');

/** Every egress of a charge carries its refunds, derived from the refund rows in list order. */
export function chargeBody(ctx: HandlerContext, c: Row): Row {
  const data = newest(ctx, 'refund').filter((r) => r.charge === c.id);
  return { ...c, refunds: { object: 'list', data, has_more: false, total_count: data.length, url: `/v1/charges/${String(c.id)}/refunds` } };
}

export const subMissing = (ctx: HandlerContext, id: string): Response => fail(ctx, `No such subscription: '${id}'`, 404, 'resource_missing');

/** A coupon that replaces the subscription's discount, or an empty one that clears it (docs.stripe.com/api/subscriptions/update#update_subscription-discounts). */
export function replacedDiscounts(ctx: HandlerContext, couponId: string, sub: Row): Row[] | Response {
  if (couponId === '') return [];
  const coupon = ctx.get('coupon', couponId);
  return coupon ? [buildDiscount(coupon, String(sub.customer ?? ''), Number(nowUnix(ctx.occurredAt)), { subscription: String(sub.id) })] : fail(ctx, `No such coupon: '${couponId}'`, 400, 'resource_missing');
}

/** A `trial_end` Stripe refuses: the parameter is `"now" | timestamp` (docs.stripe.com/api/subscriptions/update), and a
 *  timestamp that is not in the future answers "Invalid timestamp: must be an integer Unix timestamp in the future."
 *  (Stripe's own message, as its SDKs' users report it: github.com/stripe/stripe-dotnet/issues/805,
 *  github.com/stripe/stripe-ruby/issues/682). Where the documentation stops and the twin decides: a value that is no
 *  number at all, and one more than two years on, answer that same message. */
export function trialEndRefused(ctx: HandlerContext, value: unknown, now: number): Response | undefined {
  const t = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value) : NaN;
  return value === undefined || value === 'now' || (Number.isInteger(t) && t > now && t <= now + MAX_TRIAL) ? undefined : invalidTrialEnd(ctx);
}

export function invalidTrialEnd(ctx: HandlerContext): Response {
  return ctx.refuse({ status: 400, param: 'trial_end', message: 'Invalid timestamp: must be an integer Unix timestamp in the future.' });
}

/** An update's `trial_end` on the subscription, into `fields`.
 *
 *  `now` on a trialing subscription ends its trial at once: "The special value `now` can be provided to end the customer's
 *  trial immediately" (docs.stripe.com/api/subscriptions/update#update_subscription-trial_end; the trials guide's "To end a
 *  trial early … setting the `trial_end` value to … **now** to end immediately", docs.stripe.com/billing/subscriptions/
 *  trials/free-trials). The update resets the billing date and charges at once: "Switching prices does not normally change
 *  the billing date or generate an immediate charge unless … A trial starts or ends. In these cases, we … immediately
 *  charge the customer using the new price, and reset the billing date" (docs.stripe.com/api/subscriptions/update), and
 *  "Stripe immediately attempts payment when a subscription's billing cycle anchor is reset … When billing is performed
 *  immediately, but the required payment fails, the subscription change request succeeds and the subscription transitions
 *  to `past_due`" (docs.stripe.com/billing/subscriptions/upgrade-downgrade#immediate-payment). So a new period starts now,
 *  its invoice is made (`invoice.created`) and charged to the subscription's default payment method, else the
 *  customer's (paid: `invoice.paid`, the subscription `active`; declined or none: the invoice open, `past_due`), and the
 *  subscription's own write sends `customer.subscription.updated`. `payment_behavior` (the same page): `error_if_incomplete`
 *  answers 402 and leaves the subscription as it was, `default_incomplete` leaves the invoice open without an attempt.
 *
 *  A future timestamp moves the trial's end, and the period and billing anchor with it: "The `billing_cycle_anchor` will be
 *  updated to the `trial_end` value" (the same parameter); on a subscription out of its trial it starts a new one ("You can
 *  add a new trial on a non-trialing subscription by updating the subscription while specifying trial_end", and for
 *  classic billing mode "the `trial_start` field remains set to the start of the first trial", docs.stripe.com/billing/
 *  subscriptions/trials/free-trials).
 *
 *  Where the documentation stops and the twin decides: the invoice's billing_reason is `subscription_update` ("A
 *  subscription was updated", docs.stripe.com/api/invoices/object#invoice_object-billing_reason); `now` on a subscription
 *  that is not trialing has no trial to end and changes nothing; the credit Stripe prorates for the unused time when a new
 *  trial starts mid-period is not made (as `proration_behavior=none` would have it); `pending_if_incomplete` answers as
 *  `allow_incomplete` (no pending update is modelled). Answers a refusal, or the invoice to collect once the subscription is written. */
export async function applyTrialEnd(ctx: HandlerContext, sub: Row, fields: Row, now: number): Promise<{ invoice: string; payer?: string; attempt: boolean } | undefined> {
  const value = ctx.params.trial_end;
  delete fields.trial_end;
  const id = String(sub.id);
  if (value !== 'now' || sub.status !== 'trialing') return value === 'now' ? undefined : movedTrial(sub, fields, Number(value), now);
  // the period's invoice bills the items as this update leaves them, under its discount
  const next: Row = { ...sub, ...fields, items: resourceView(ctx, SUB, id)?.items ?? sub.items };
  const { interval, interval_count } = resolveSubscriptionBillingInterval(((next.items as { data?: Row[] } | undefined)?.data) ?? [], finder(ctx));
  const period = { start: now, end: addBillingInterval(now, interval, interval_count) };
  const invoice = await draftSubscriptionInvoice(ctx, next, { ...period, reason: 'subscription_update' });
  Object.assign(fields, { trial_end: now, billing_cycle_anchor: now, current_period_start: period.start, current_period_end: period.end, latest_invoice: invoice });
  const payer = trialPayer(ctx, sub);
  return { invoice, ...(payer ? { payer } : {}), attempt: ctx.params.payment_behavior !== 'default_incomplete' };
}

/** What ending the trial charges: the update's own default payment method, else the subscription's, else its customer's. */
export function trialPayer(ctx: HandlerContext, sub: Row): string | undefined {
  const given = ctx.params.default_payment_method;
  return typeof given === 'string' && given ? given : payerOf(ctx, sub);
}

/** What an update's `trial_end` refuses before anything is written: a new trial the machine does not allow from the
 *  subscription's status, or, under `error_if_incomplete`, ending a trial that cannot be paid at once ("If payment fails,
 *  return an HTTP `402` status code and don't update the subscription", docs.stripe.com/api/subscriptions/update). */
export function trialEndBlocked(ctx: HandlerContext, sub: Row, discounts: Row[] | undefined): Response | undefined {
  if (ctx.params.trial_end !== 'now') return newTrialRefused(ctx, sub);
  if (sub.status !== 'trialing') return undefined;
  const charge = trialEndCharge(ctx, sub, discounts);
  if (ctx.params.payment_behavior === 'error_if_incomplete' && charge.due > 0 && !charge.pays) return firstPaymentRefused(ctx, charge.declined);
  // the move ending the trial makes (paid or nothing due: active; else past_due) is the machine's, asked before
  // anything is written
  const refused = ctx.legal(SUB, 'status', ctx.call.operation.id, 'trialing', charge.due <= 0 || charge.pays ? 'active' : 'past_due', String(sub.id));
  return refused ? ctx.refuse(refused) : undefined;
}

/** A price named by id, or given as an object. */
export function priceRow(ctx: HandlerContext, price: unknown): Row | undefined {
  return typeof price === 'string' ? ctx.get('price', price) : price && typeof price === 'object' ? (price as Row) : undefined;
}

/** One period of the subscription's items as an update's `items` would leave them, before any discount: an entry naming
 *  an item changes its price and quantity (a new price resets the quantity to 1 unless one is given) or deletes it, and
 *  one naming none adds an item (applyItemChanges). */
export function dueAfter(ctx: HandlerContext, sub: Row, entries: Row[]): number {
  const lines = new Map<string, { price: Row | undefined; quantity: number }>();
  for (const it of ((sub.items as { data?: Row[] } | undefined)?.data) ?? []) lines.set(String(it.id), { price: priceRow(ctx, it.price), quantity: itemQuantity(it) });
  entries.forEach((e, i) => entryAfter(ctx, lines, e, i));
  return [...lines.values()].reduce((sum, l) => sum + priceAmount(l.price, l.quantity), 0);
}

/** One entry of an update's `items` on the lines it would leave (dueAfter). */
export function entryAfter(ctx: HandlerContext, lines: Map<string, { price: Row | undefined; quantity: number }>, e: Row, i: number): void {
  // an inline price bills as the Price inlinePrice makes of it
  const d = e.price_data && typeof e.price_data === 'object' ? (e.price_data as Row) : undefined;
  const inline: Row | undefined = d ? (d.unit_amount_decimal !== undefined ? { unit_amount_decimal: String(d.unit_amount_decimal) } : { unit_amount: Math.trunc(Number(d.unit_amount) || 0) }) : undefined;
  const price = typeof e.price === 'string' && e.price ? priceRow(ctx, e.price) : inline;
  const named = typeof e.id === 'string' && e.id;
  const key = named ? String(e.id) : `new_${i}`;
  // only a named item is deleted; an entry naming none adds one, as applyItemChanges does
  if (named && asBool(e.deleted)) { lines.delete(key); return; }
  const was = lines.get(key);
  const quantity = e.quantity !== undefined ? Math.max(0, Math.trunc(Number(e.quantity) || 0)) : price && was && price.id !== was.price?.id ? 1 : was?.quantity ?? 1;
  lines.set(key, { price: price ?? was?.price, quantity });
}

/** A new trial on a subscription whose status the machine does not let start one. */
export function newTrialRefused(ctx: HandlerContext, sub: Row): Response | undefined {
  const refused = sub.status === 'trialing' ? undefined : ctx.legal(SUB, 'status', ctx.call.operation.id, sub.status, 'trialing', String(sub.id));
  return refused ? ctx.refuse(refused) : undefined;
}

/** What ending the trial charges, judged before anything is written: the period of the items as this update leaves them
 *  (dueAfter) under the discount it leaves, and whether the payer pays it (an attempt made, a payer, no decline). */
export function trialEndCharge(ctx: HandlerContext, sub: Row, discounts: Row[] | undefined): { due: number; pays: boolean; declined?: ReturnType<typeof declineFor> } {
  const subtotal = dueAfter(ctx, sub, subscriptionItemEntries(ctx.params.items));
  // the discount the subscription carries after this update takes this invoice (renewals.ts draftSubscriptionInvoice)
  const discount = (discounts ?? (sub.discounts as Row[] | undefined) ?? [])[0];
  const coupon = discount && typeof discount === 'object' ? (discount.coupon as Row | undefined) : undefined;
  const due = subtotal - (coupon ? applyCouponDiscount(subtotal, coupon) : 0);
  const payer = trialPayer(ctx, sub);
  const attempt = ctx.params.payment_behavior !== 'default_incomplete';
  const declined = payer && attempt ? declineFor(finder(ctx), { payment_method: payer }) : undefined;
  return { due, pays: attempt && !!payer && !declined, ...(declined ? { declined } : {}) };
}

/** A new item named with neither `price` nor `price_data`: "One of `price` or `price_data` is required"
 *  (docs.stripe.com/api/subscriptions/update). */
export function noItemPrice(ctx: HandlerContext): Response {
  return fail(ctx, 'Missing required param: items[price].', 400, 'parameter_missing');
}

/** A subscription asked to fail when its first invoice cannot be paid at once (payment_behavior=error_if_incomplete):
 *  the card's decline, or no payment method to charge (docs.stripe.com/api/subscriptions/create#create_subscription-payment_behavior). */
export function firstPaymentRefused(ctx: HandlerContext, declined: Parameters<typeof cardError>[0] | null | undefined): Response {
  return declined ? send(ctx, cardError(declined)) : fail(ctx, 'This customer has no attached payment source or default payment method.', 400, 'resource_missing');
}

/** An update's `items`: "A list of up to 20 subscription items, each with an attached price"
 *  (docs.stripe.com/api/subscriptions/update): an entry naming an item's `id` changes that item (its price, quantity,
 *  metadata) or, with `deleted` ("A flag that, if set to `true`, will delete the specified item"), removes it; "If you
 *  omit `id`, the API adds a new subscription item rather than updating the existing one". Each takes `price` or
 *  `price_data`, "Data used to generate a new Price object inline. One of `price` or `price_data` is required", and
 *  "When changing a subscription item's price, `quantity` is set to 1 unless a `quantity` parameter is provided". An
 *  inline price is made as the manage-prices guide says: "By default, prices created with `price_data` are effectively
 *  archived (they're marked as `active=false`)" (docs.stripe.com/products-prices/manage-prices).
 *  Where the documentation stops and the twin decides: the update is all or nothing, every entry checked before any is
 *  written (Stripe answers one error for the request); the refusals are worded by the twin. */
export async function applyItemChanges(ctx: HandlerContext, subId: string, entries: Row[]): Promise<Response | undefined> {
  // every entry is checked first: a refusal leaves the subscription as it was
  const refused = itemChangesRefused(ctx, subId, entries);
  if (refused) return refused;
  return writeItemChanges(ctx, subId, entries);
}

/** The refusal of an update's `items`, checked entry by entry before any is written (applyItemChanges). */
export function itemChangesRefused(ctx: HandlerContext, subId: string, entries: Row[]): Response | undefined {
  for (const entry of entries) {
    const priceRef = typeof entry.price === 'string' && entry.price ? entry.price : undefined;
    if (priceRef && !ctx.get('price', priceRef)) return fail(ctx, `No such price: '${priceRef}'`, 400, 'resource_missing');
    const inline = !priceRef && entry.price_data && typeof entry.price_data === 'object' ? (entry.price_data as Row) : undefined;
    if (inline) {
      const refused = refuseInlinePrice(ctx, inline);
      if (refused) return refused;
    }
    if (typeof entry.id === 'string' && entry.id) {
      const si = ctx.get('subscription_item', entry.id);
      if (!si || si.subscription !== subId) return fail(ctx, `No such subscription_item: '${entry.id}'`, 400, 'resource_missing');
    } else if (!priceRef && !inline) return noItemPrice(ctx);
  }
  return undefined;
}

/** An update's checked `items`, written. */
export async function writeItemChanges(ctx: HandlerContext, subId: string, entries: Row[]): Promise<undefined> {
  for (const entry of entries) {
    const inline = typeof entry.price === 'string' && entry.price ? undefined : entry.price_data && typeof entry.price_data === 'object' ? (entry.price_data as Row) : undefined;
    const priceRef = typeof entry.price === 'string' && entry.price ? entry.price : inline ? await inlinePrice(ctx, inline) : undefined;
    // only a price that changes resets the quantity; one naming the item's own price leaves it
    const was = typeof entry.id === 'string' && entry.id ? ctx.get('subscription_item', entry.id)?.price : undefined;
    const wasId = typeof was === 'string' ? was : was && typeof was === 'object' ? String((was as Row).id ?? '') : undefined;
    const quantity = entry.quantity !== undefined ? { quantity: Math.max(0, Math.trunc(Number(entry.quantity) || 0)) } : priceRef && priceRef !== wasId ? { quantity: 1 } : {};
    const metadata = entry.metadata && typeof entry.metadata === 'object' ? { metadata: entry.metadata } : {};
    if (typeof entry.id === 'string' && entry.id) {
      if (asBool(entry.deleted)) { await ctx.write('subscription_item', entry.id, { deleted: true }, 'subscription_item.delete'); continue; }
      await ctx.write('subscription_item', entry.id, { ...(priceRef ? { price: priceRef } : {}), ...quantity, ...metadata }, 'subscription_item.update');
    } else {
      await created(ctx, 'subscription_item', { subscription: subId, ...subscriptionItemPrice(priceRef, finder(ctx)), quantity: 1, ...quantity, ...metadata }, { livemode: false, metadata: {}, discounts: [], tax_rates: [], billing_thresholds: null });
    }
  }
  await syncItems(ctx, subId);
  return undefined;
}

/** A subscription item's `price_data` Stripe would refuse: its required `currency`, `product` (an existing one) and
 *  `recurring[interval]`, and "Only one of `unit_amount` and `unit_amount_decimal` can be set". */
export function refuseInlinePrice(ctx: HandlerContext, d: Row): Response | undefined {
  for (const name of ['currency', 'product']) if (typeof d[name] !== 'string' || !d[name]) return fail(ctx, `Missing required param: items[price_data][${name}].`, 400, 'parameter_missing');
  if (!ctx.get('product', String(d.product))) return fail(ctx, `No such product: '${String(d.product)}'`, 400, 'resource_missing');
  const interval = (d.recurring as Row | undefined)?.interval;
  if (!['day', 'week', 'month', 'year'].includes(String(interval))) return fail(ctx, 'Missing required param: items[price_data][recurring][interval].', 400, 'parameter_missing');
  if (d.unit_amount !== undefined && d.unit_amount_decimal !== undefined) return fail(ctx, 'Only one of `unit_amount` and `unit_amount_decimal` can be set.', 400, 'parameter_invalid');
  return undefined;
}

/** The inline Price a `price_data` generates: recurring, archived (active=false). Answers its id. */
export async function inlinePrice(ctx: HandlerContext, d: Row): Promise<string> {
  const r = d.recurring as Row;
  const decimal = d.unit_amount_decimal !== undefined ? String(d.unit_amount_decimal) : String(Math.trunc(Number(d.unit_amount) || 0));
  const price = await created(ctx, 'price', {
    product: d.product, currency: String(d.currency).toLowerCase(),
    // a decimal amount that is not a whole number of the smallest unit has no integer unit_amount (as semantics/plans.ts)
    unit_amount: d.unit_amount_decimal !== undefined ? (Number.isInteger(Number(d.unit_amount_decimal)) ? Number(d.unit_amount_decimal) : null) : Math.trunc(Number(d.unit_amount) || 0), unit_amount_decimal: decimal,
    recurring: { interval: r.interval, interval_count: Math.max(1, Math.trunc(Number(r.interval_count ?? 1)) || 1), usage_type: 'licensed', trial_period_days: null, meter: null },
    tax_behavior: typeof d.tax_behavior === 'string' ? d.tax_behavior : 'unspecified',
  }, { active: false, livemode: false, billing_scheme: 'per_unit', type: 'recurring', metadata: {}, lookup_key: null, nickname: null });
  return String(price.id);
}

// ── items: each write keeps the parent subscription's items.data in step, rebuilt from the live items ──

/** A new subscription's items, each its own subscription_item as Stripe keeps it (/v1/subscription_items/{id}). */
export async function storeItems(ctx: HandlerContext, subId: string, items: Row[]): Promise<void> {
  for (const item of items) {
    if (typeof item.id !== 'string' || ctx.get('subscription_item', item.id)) continue;
    const { plan: _plan, price, ...fields } = item;
    await ctx.write('subscription_item', item.id, { ...fields, price: typeof price === 'object' && price ? (price as Row).id : price, subscription: subId }, 'subscription_item.create');
  }
}

export async function syncItems(ctx: HandlerContext, subId: string): Promise<void> {
  if (!subId) return;
  await ctx.write(SUB, subId, {}, 'subscription.items_synced');
}

export const listMissing = (ctx: HandlerContext, id: string, status = 404): Response => fail(ctx, `No such radar value list: '${id}'`, status, 'resource_missing');

/** A value list's list_items, "List of items contained within this value list" (the served spec), kept in step with
 *  its items, at the address the fixture names (/v1/radar/value_list_items?value_list=…). */
export async function radarSyncItems(ctx: HandlerContext, listId: string): Promise<void> {
  const data = newest(ctx, VLI).filter((i) => i.value_list === listId);
  await ctx.write(VL, listId, { list_items: { object: 'list', data, has_more: false, url: `/v1/radar/value_list_items?value_list=${listId}` } }, 'radar.value_list.items_synced');
}

/** An authorization as every egress carries it: its card embedded in full. */
export function withCard(ctx: HandlerContext, a: Row): Row {
  return ctx.expand(AUTH, a);
}

export const authMissing = (ctx: HandlerContext, id: string): Response => fail(ctx, `No such authorization: '${id}'`, 404, 'resource_missing');

/** A capture: an Issuing transaction (negative: it debits) and the issuing balance's debit. */
export async function capture(ctx: HandlerContext, authId: string, auth: Row, amountCents: number): Promise<{ txnId: string; btId: string }> {
  const currency = typeof auth.currency === 'string' ? auth.currency : 'usd';
  const bt = await created(ctx, 'balance_transaction', {}, {
    amount: -amountCents, currency, fee: 0, net: -amountCents, type: 'issuing_transaction',
    status: 'available', balance_type: 'issuing', reporting_category: 'issuing_transaction',
    available_on: nowUnix(ctx.occurredAt), fee_details: [],
  });
  const txn = await created(ctx, TXN, { authorization: authId, card: auth.card, cardholder: auth.cardholder }, {
    type: 'capture', amount: -amountCents, currency,
    merchant_amount: -amountCents, merchant_currency: typeof auth.merchant_currency === 'string' ? auth.merchant_currency : currency,
    merchant_data: auth.merchant_data ?? merchantData(undefined),
    livemode: false, metadata: {}, dispute: null, wallet: null, network_data: null,
    amount_details: null, purchase_details: null, balance_transaction: bt.id,
  });
  return { txnId: String(txn.id), btId: String(bt.id) };
}

/** Issuing refusals of a request no story sends: an unknown card status or authorization method, and a capture of an
 *  authorization that is not approved and pending. */
export function issuingRefusal(ctx: HandlerContext, what: 'card_status' | 'authorization_method' | 'not_capturable', auth?: Row): Response {
  switch (what) {
    case 'card_status': return fail(ctx, "Invalid status: must be one of 'active', 'inactive', or 'canceled'.", 400, 'parameter_invalid_string_enum');
    case 'authorization_method': return fail(ctx, "Invalid authorization_method: must be one of 'chip', 'contactless', 'keyed_in', 'online', or 'swipe'.", 400, 'parameter_invalid_string_enum');
    case 'not_capturable': return fail(ctx, `This authorization cannot be captured because it is not an approved pending authorization (status: ${String(auth?.status)}, approved: ${auth?.approved === true}).`, 400);
  }
}

/** A partial approval's refusal: "You can specify the amount you want to approve by setting the amount in the webhook
 *  response body or the approve call" only "When an authorization is partially authorized, the is_amount_controllable
 *  field on the authorization request is set to true" (docs.stripe.com/issuing/purchases/authorizations), and never a
 *  credit. Answers the refusal, or undefined when the amount may be approved. */
export function partialApprovalRefused(ctx: HandlerContext, auth: Row): Response | undefined {
  if (Math.trunc(Number(ctx.params.amount) || 0) <= 0) return fail(ctx, 'Invalid integer: amount must be a positive integer.', 400, 'parameter_invalid_integer');
  if ((auth.pending_request as Row | null | undefined)?.is_amount_controllable !== true) return fail(ctx, 'amount may only be provided when the authorization was presented with is_amount_controllable.', 400);
  return undefined;
}

// the (deprecated but real) API decision on a pending authorization: it lands in request_history
// as the webhook's answer would, consumes the pending request, and an approval captures
export function issuingDecide(approved: boolean): Handler {
  return async (ctx) => {
    const id = at(ctx, 'authorization');
    const auth = ctx.get(AUTH, id);
    if (!auth) return authMissing(ctx, id);
    const finalized = { status: 400, code: 'authorization_already_finalized', message: `This authorization has already been finalized (status ${String(auth.status)}).` };
    // a webhook-approved authorization is decided, though still pending
    if (auth.approved === true && auth.status === 'pending') return ctx.refuse(finalized);
    const refused = ctx.legal(AUTH, 'status', approved ? 'PostIssuingAuthorizationsAuthorizationApprove' : 'PostIssuingAuthorizationsAuthorizationDecline', auth.status, undefined, id);
    if (refused) return ctx.refuse(refused);
    // a partial approval only for an amount-controllable presentment, and never a credit
    const badAmount = approved && ctx.params.amount !== undefined ? partialApprovalRefused(ctx, auth) : undefined;
    if (badAmount) return badAmount;
    const decidedAmount = approved && ctx.params.amount !== undefined ? Math.trunc(Number(ctx.params.amount) || 0) : Number(auth.amount) || 0;
    const currency = typeof auth.currency === 'string' ? auth.currency : 'usd';
    const history = Array.isArray(auth.request_history) ? (auth.request_history as Row[]) : [];
    // an approval holds the funds and waits for the merchant's capture; a decline closes it
    // (docs.stripe.com/issuing/purchases/authorizations, docs.stripe.com/issuing/funding/balance)
    const hold = approved ? await holdFor(ctx, id, decidedAmount, currency) : null;
    return ctx.reply(withCard(ctx, await ctx.write(AUTH, id, {
        status: approved ? 'pending' : 'closed', approved, pending_request: null,
        ...(approved && ctx.params.amount !== undefined ? { amount: decidedAmount } : {}),
        request_history: [...history, historyEntry({
          amount: decidedAmount, currency, approved, reason: approved ? 'webhook_approved' : 'webhook_declined', reasonMessage: null,
          createdSec: Number(nowUnix(ctx.occurredAt)), merchantAmount: Number(auth.merchant_amount) || decidedAmount,
          merchantCurrency: typeof auth.merchant_currency === 'string' ? auth.merchant_currency : currency,
        })],
        ...(hold ? { balance_transactions: [...(Array.isArray(auth.balance_transactions) ? auth.balance_transactions : []), hold.id] } : {}),
      }, 'issuing_authorization.updated'),
    ));
  };
}

/** Time's decision on a real-time request no one answered, caught up to the World's clock: once its window has ended,
 *  a pending authorization whose issuing_authorization.request went unanswered, and that no approve or decline decided,
 *  is decided automatically, its request_history reason webhook_timeout ("webhook_timeout for all other failure modes",
 *  the same page, beside webhook_error for a response Stripe cannot process).
 *  Where the documentation stops and the twin decides: the timeout setting is the Dashboard's, which the API does not
 *  answer, and the twin's is to decline; the window is measured in World time from the authorization's created. */
export async function lapseRealtimeRequests(ctx: HandlerContext): Promise<void> {
  const now = Number(nowUnix(ctx.occurredAt));
  const requested = new Set(ctx.rows('event').filter((e) => e.type === 'issuing_authorization.request').map((e) => String(((e.data as Row | undefined)?.object as Row | undefined)?.id ?? '')));
  for (const a of ctx.rowsRaw(AUTH)) {
    if (a.status !== 'pending' || a.approved === true || !a.pending_request || !requested.has(String(a.id))) continue;
    const at = Number(a.created) + REALTIME_WINDOW_SECONDS;
    if (now < at) continue;
    const id = String(a.id);
    const currency = typeof a.currency === 'string' ? a.currency : 'usd';
    const amount = Number(a.amount) || 0;
    ctx.legal(AUTH, 'status', ctx.call.operation.id, 'pending', 'closed', id, 'time');
    await ctx.write(AUTH, id, {
      status: 'closed', approved: false, pending_request: null,
      request_history: [...(Array.isArray(a.request_history) ? (a.request_history as Row[]) : []), historyEntry({
        amount, currency, approved: false, reason: 'webhook_timeout', reasonMessage: null, createdSec: at,
        merchantAmount: Number(a.merchant_amount) || amount, merchantCurrency: typeof a.merchant_currency === 'string' ? a.merchant_currency : currency,
      })],
    }, 'issuing_authorization.updated');
  }
}

/** An approval's hold: "If you approve the authorization, we deduct the `amount` from your Issuing balance and hold it
 *  in reserve until the authorization is either captured, voided, or expired without capture"
 *  (docs.stripe.com/issuing/purchases/authorizations). */
export async function holdFor(ctx: HandlerContext, authId: string, amount: number, currency: string): Promise<Row> {
  return created(ctx, 'balance_transaction', {}, {
    amount: -amount, currency, fee: 0, net: -amount, type: 'issuing_authorization_hold',
    status: 'available', balance_type: 'issuing', reporting_category: 'issuing_authorization_hold',
    available_on: nowUnix(ctx.occurredAt), fee_details: [], source: authId,
  });
}

/** An authorization approved as it is presented, its amount held: approved and pending until the merchant captures. */
export async function approvedAtOnce(ctx: HandlerContext, subject: Row, fields: Row, held: number, entry: Row): Promise<Response> {
  const hold = await holdFor(ctx, String(subject.id), held, String(fields.currency ?? 'usd'));
  return ctx.reply(withCard(ctx, await created(ctx, AUTH, subject, { ...fields, amount: held, status: 'pending', approved: true, pending_request: null, request_history: [entry], balance_transactions: [hold.id] })));
}

/** An authorization as the platform's real-time answer makes it: approved (in part, only when the request was
 *  amount-controllable), declined, or declined for an answer Stripe cannot read (docs.stripe.com/issuing/controls/
 *  real-time-authorizations: the response's `approved` and `amount`; webhook_error "if we can't process your response"). */
export async function answeredByEndpoint(ctx: HandlerContext, outcome: { kind: 'approved'; amount?: number } | { kind: 'declined' } | { kind: 'error'; message: string }, o: {
  subject: Row; fields: Row; amount: number; controllable: boolean; entry: (e: { amount: number; approved: boolean; reason: string; reasonMessage: string | null }) => Row;
  decline: (reason: string, message: string | null) => Promise<Response>;
}): Promise<Response> {
  if (outcome.kind === 'approved') {
    const held = o.controllable && outcome.amount !== undefined ? outcome.amount : o.amount;
    return approvedAtOnce(ctx, o.subject, o.fields, held, o.entry({ amount: held, approved: true, reason: 'webhook_approved', reasonMessage: null }));
  }
  return outcome.kind === 'declined' ? o.decline('webhook_declined', null) : o.decline('webhook_error', outcome.message);
}

/** Time's settling of held refunds, caught up to the World's clock: each refund held for want of balance, oldest first,
 *  is made at the first moment the account's available balance covers it (the funds that come due then), its debit
 *  written then, as `refund.updated`. Where the documentation stops and the twin decides: a held refund is made the
 *  moment the balance covers it. */
export async function settleHeldRefunds(ctx: HandlerContext): Promise<void> {
  const now = Number(nowUnix(ctx.occurredAt));
  const heldRefunds = ctx.rowsRaw('refund').filter((r) => r.status === 'pending' && r.pending_reason === 'insufficient_funds').sort((a, b) => Number(a.created) - Number(b.created));
  for (const r of heldRefunds) await settleOneHeldRefund(ctx, r, now);
}

/** A pending refund can enter this surface only through the vendor-backed refund refresh. */
export async function settleOneHeldRefund(ctx: HandlerContext, r: Row, now: number): Promise<void> {
    const account = typeof r._account === 'string' ? r._account : undefined;
    const currency = String(r.currency ?? 'usd');
    const amount = Number(r.amount) || 0;
    const when = [Number(r.created), ...fundsDueBetween(ctx, account, currency, Number(r.created), now)].find((t) => availableAt(ctx, account, currency, t) >= amount);
    if (when === undefined) return;
    const c = await at_(ctx)(when);
    c.legal('refund', 'status', ctx.call.operation.id, 'pending', 'succeeded', String(r.id), 'vendor');
    const bt = await settleRefund(c, String(r.id), amount, currency, account ?? null);
    await c.write('refund', String(r.id), { status: 'succeeded', pending_reason: null, balance_transaction: bt }, 'refund.updated');
}

export const accountMissing = (ctx: HandlerContext, id: string, status = 404): Response => fail(ctx, `No such account: '${id}'`, status, 'resource_missing');

/** The account, tombstones included where the hand-written routes looked past a deletion. */
export const accountRow = (ctx: HandlerContext, id: string): Row | undefined => ctx.row('account', id, { withDeleted: true });

/** Stripe's review of a Custom account once the platform gives it something: with nothing left due, its requested
 *  capabilities become active and it can take charges and receive payouts; with something due again (its bank account
 *  removed), they stop. Where the documentation stops and the twin decides: test-mode verification is immediate, and
 *  it owes what customRequirements lists. An Express or Standard account is onboarded on Stripe's own pages. */
export async function connectReview(ctx: HandlerContext, id: string): Promise<void> {
  const account = resourceView(ctx, 'account', id);
  if (account && account.type === 'custom') await reviewCustom(ctx, id, account);
}

/** The review of a Custom account (see review). */
export async function reviewCustom(ctx: HandlerContext, id: string, account: Row): Promise<void> {
  const bank = ctx.rows('external_account').some((e) => e.account === id);
  const persons = ctx.rows('person').filter((p) => p.account === id);
  const { now: due, later } = customRequirements(account, bank, persons);
  // one account, one review: "If a connected account has both card_payments and transfers, and the status of either one
  // is inactive, then both capabilities are disabled" (docs.stripe.com/connect/account-capabilities)
  const ready = due.length === 0;
  const capabilities: Row = {};
  for (const [key, was] of Object.entries((account.capabilities as Row | undefined) ?? {})) {
    const to = ready ? 'active' : 'inactive';
    // Capabilities are entries of the account's map, not standalone stored subjects.
    capabilities[key] = to;
  }
  const requirements = { ...((account.requirements as Row | undefined) ?? {}), currently_due: due, eventually_due: [...due, ...later], past_due: [], disabled_reason: ready ? null : 'requirements.past_due', current_deadline: null };
  await ctx.write('account', id, { capabilities, requirements, charges_enabled: ready, payouts_enabled: ready, details_submitted: ready }, ready ? 'account.updated' : 'account.update');
}

/** A transfer to an account whose transfers capability is not active. */
export function transfersInactive(ctx: HandlerContext): Response {
  return ctx.refuse({ status: 400, code: 'insufficient_capabilities_for_transfer', param: 'destination', message: 'Your destination account needs to have at least one of the following capabilities enabled: transfers, crypto_transfers, legacy_payments' });
}

/** A transfer from a charge whose funds have settled: "With a source_transaction, the transfer request returns success
 *  regardless of your available balance if the related charge hasn't settled yet" (docs.stripe.com/connect/separate-
 *  charges-and-transfers), so a settled one comes out of the available balance. */
export function settledSourceRefused(ctx: HandlerContext, amount: number, currency: string): Response | undefined {
  return refusePayout(ctx, amount, currency, undefined);
}

/** An earlier version's payment_method_types refused: the first value that names no payment method type the
 *  operation takes, in the intent's words or (a Checkout Session) the enum's. */
export function unknownMethodType(ctx: HandlerContext, opId: string, given: unknown): Response | undefined {
  const values = Array.isArray(given) ? given : given && typeof given === 'object' ? Object.values(given) : [given];
  const checkout = opId === 'PostCheckoutSessions';
  const known = checkout ? CHECKOUT_METHOD_TYPES : PAYMENT_METHOD_TYPES;
  const i = values.findIndex((v) => !known.includes(String(v)));
  if (i < 0) return undefined;
  if (checkout) {
    const param = `payment_method_types[${i}]`;
    return ctx.refuse({ status: 400, param, message: `Invalid ${param}: must be one of ${oneOf(known)}` });
  }
  const doc = TYPES_DOC[opId.startsWith('PostSetupIntents') ? 'setup_intents' : 'payment_intents'];
  return ctx.refuse({ status: 400, param: 'payment_method_types', message: `The payment method type "${String(values[i])}" is invalid. See ${doc} for the full list of supported payment method types.` });
}

/** payment_method_types refused where the caller's version removed it. */
export const noLongerSupported = (ctx: HandlerContext, version: string): Response =>
  ctx.refuse({ status: 400, code: 'payment_method_types_no_longer_supported', param: 'payment_method_types', message: `payment_method_types is no longer supported in API version ${version}. Use allowed_payment_method_types, or dynamic payment methods, instead.` });

/** Stripe's refusal of a request whose top-level parameters the operation does not take, or undefined. */
export function refuseParameters(ctx: HandlerContext): Response | undefined {
  const op = OPS.get(ctx.call.operation.id);
  if (!op) return undefined;
  const pinned = ctx.call.request.headers.get('stripe-version');
  const params = ctx.params;
  if (pinned && pinned < SERVED_VERSION) {
    if (!TYPED.has(op.id)) return undefined;
    if (params.payment_method_types === undefined) return undefined;
    if (REMOVED_TYPES.has(op.id) && methodTypesRemoved(pinned)) return noLongerSupported(ctx, pinned);
    return unknownMethodType(ctx, op.id, params.payment_method_types);
  }
  const method = ctx.call.request.method.toUpperCase();
  const known = new Set([...(op.query ?? []), ...(op.body ?? [])].map((p) => p.name).concat(DOCUMENTED[op.id] ?? []));
  if (REMOVED_TYPES.has(op.id) && params.payment_method_types !== undefined) return noLongerSupported(ctx, pinned ?? SERVED_VERSION);
  for (const name of Object.keys(params)) {
    if (!known.has(name)) return ctx.refuse({ status: 400, code: 'parameter_unknown', param: name, message: `Received unknown parameter: ${name}` });
  }
  const required = method === 'GET' || method === 'DELETE' ? (op.query ?? []) : (op.body ?? []);
  for (const p of required) {
    if (p.required && params[p.name] === undefined) return ctx.refuse({ status: 400, code: 'parameter_missing', param: p.name, message: `Missing required param: ${p.name}.` });
  }
  return undefined;
}

/** An answer in the shape of the API version the caller is served (./version.ts), a webhook endpoint's `secret` shown
 *  only at its creation ("Only returned at creation", docs.stripe.com/api/webhook_endpoints/object). */
export async function rendered(request: Request, res: Response): Promise<Response> {
  const creates = request.method === 'POST' && new URL(request.url).pathname.replace(/\/+$/, '') === '/v1/webhook_endpoints';
  const pinned = request.headers.get('stripe-version');
  if (!(res.headers.get('content-type') ?? '').includes('json')) return res;
  if (!servesCurrent(pinned) && creates) return res;
  const expand = await expandOf(request.clone());
  const body = await res.json();
  const answered = creates ? body : withoutEndpointSecret(body);
  return new Response(JSON.stringify(servesCurrent(pinned) ? render(answered, pinned, expand) : answered), { status: res.status, statusText: res.statusText, headers: res.headers });
}



/** Write a draft's line list and the totals derived from it. */
export async function writeLines(ctx: HandlerContext, invoiceId: string, next: Row[]): Promise<Row> {
  const subtotal = sumLines(next);
  const lines = { object: 'list', data: next, has_more: false, total_count: next.length, url: `/v1/invoices/${invoiceId}/lines` };
  return ctx.write(INV, invoiceId, { lines, subtotal, total: subtotal, amount_due: subtotal, amount_remaining: subtotal }, 'invoice.update');
}



/** A customer's pending invoice item, made before the invoice, pulled onto it (docs.stripe.com/api/invoices/create#create_invoice-pending_invoice_items_behavior). */
export async function pullPendingItem(ctx: HandlerContext, invoiceId: string, inv: Row, item: Row, now: number): Promise<void> {
  const current = ctx.get(INV, invoiceId) ?? inv;
  await writeLines(ctx, invoiceId, [...linesOf(current), {
    id: `il_${String(item.id)}`, object: 'line_item', type: 'invoiceitem', amount: Number(item.amount) || 0, currency: String(current.currency ?? item.currency ?? 'usd'),
    quantity: Number(item.quantity) || 1, proration: false, invoice_item: item.id, price: item.price ?? null,
    period: item.period ?? { start: now, end: now }, description: (item.description as string) ?? null,
    discountable: item.discountable ?? true, discounts: [], livemode: false, metadata: item.metadata ?? {}, tax_amounts: [], tax_rates: [],
  }]);
  await ctx.write('invoiceitem', String(item.id), { invoice: invoiceId }, 'invoiceitem.update');
}



/** The intent the path names, and the machine's refusal when this operation may not move it. */
export function paymentIntentsLoad(ctx: HandlerContext, operationId: string): { pi: Record<string, unknown> } | { answer: Response } {
  const pi = ctx.id ? ctx.get(PI, ctx.id) : undefined;
  if (!pi) return { answer: ctx.notFound(PI, String(ctx.id)) };
  const refusal = ctx.legal(PI, 'status', operationId, pi.status);
  return refusal ? { answer: ctx.refuse(refusal) } : { pi };
}



/** A transfer reversal's two entries: back into the platform's balance, out of the destination's. */
export async function settleTransferReversal(ctx: HandlerContext, reversalId: string, amount: number, currency: string, destination: string): Promise<string> {
  const platform = await write(ctx, { amount, currency, fee: 0, net: amount, type: 'transfer_refund', reporting_category: 'transfer_reversal', source: reversalId, available_on: Number(nowUnix(ctx.occurredAt)) }, null);
  await write(ctx, { amount: -amount, currency, fee: 0, net: -amount, type: 'payment_refund', reporting_category: 'refund', source: reversalId, available_on: Number(nowUnix(ctx.occurredAt)) }, destination);
  return platform;
}



/** A capture=false charge refunded while uncaptured: its authorization is released by the refund, as it would be
 *  "automatically refunded if uncaptured" (spec/openapi.json.gz, `capture_before`). The charge stays uncaptured and
 *  becomes refunded in full, a Refund records the release, and no money moves: none was ever received. Written as
 *  charge.refunded. Where the documentation stops and the twin decides: Stripe's basil change ("Partially capturing or
 *  canceling payments no longer creates a Refund", docs.stripe.com/changelog/basil/2025-03-31/remove-refund-from-partial-
 *  capture-and-payment-cancellation-flow) names partial capture and cancellation, not a refund asked for, so a refund
 *  still makes one; its reason is null and it has no balance transaction. Answers the Refund. */
export async function releaseAuthorization(ctx: HandlerContext, ch: Row, operationId: string, given: Row = {}): Promise<Row> {
  const id = String(ch.id);
  const full = Number(ch.amount) || 0;
  if (ch.refunded !== true) ctx.legal('charge', 'refunded', operationId, 'false', 'true', id);
  const refund = await created(ctx, 'refund', { ...given, charge: id, amount: full - (Number(ch.amount_refunded) || 0), currency: String(ch.currency ?? 'usd') }, {
    status: 'succeeded', metadata: {}, reason: null, receipt_number: null,
    balance_transaction: null, source_transfer_reversal: null, transfer_reversal: null, ...refundDestination(ch, 'reversal'),
    ...(typeof ch.payment_intent === 'string' ? { payment_intent: ch.payment_intent } : {}),
  });
  await ctx.write('charge', id, { amount_refunded: full, refunded: true }, 'charge.refunded');
  return refund;
}



/** A PaymentIntent's authorization released by its cancel: "For PaymentIntents with a `status` of `requires_capture`, the
 *  remaining `amount_capturable` is automatically refunded" (docs.stripe.com/api/payment_intents/cancel), and since basil
 *  a cancellation makes no Refund: "`amount_captured` will be 0 instead of `nil` in payment cancellation flows",
 *  "`amount_refunded` will no longer be updated by these actions", "`refunded` will no longer be `true` for payment
 *  cancellation flows", and no charge.refunded is sent (docs.stripe.com/changelog/basil/2025-03-31/remove-refund-from-
 *  partial-capture-and-payment-cancellation-flow). The charge stays uncaptured; nothing is written as an event. */
export async function cancelAuthorization(ctx: HandlerContext, ch: Row): Promise<Row> {
  return ctx.write('charge', String(ch.id), { amount_captured: 0 }, 'charge.authorization_released');
}



/**
 * Create a refund and land it on its charge. An omitted amount is the whole remaining balance. The
 * charge's write records `charge.refunded`, the event Stripe sends carrying the charge's new totals;
 * `refunded` is true only at the full amount.
 */
/** A reason Stripe does not take (docs.stripe.com/api/refunds/create#create_refund-reason). */
export function badReason(ctx: HandlerContext): Response {
  return fail(ctx, `Invalid refund reason: must be one of ${[...REFUND_REASONS].join(', ')}.`, 400, 'parameter_invalid_string_enum');
}



/** A bank-transfer payment refunded with origin=customer_balance goes back to the cash balance
 *  (docs.stripe.com/payments/customer-balance/refunding). */
export async function backToCashBalance(ctx: HandlerContext, customer: string, currency: string, amount: number, refundId: string): Promise<void> {
  const before = ctx.rows('customer_cash_balance_transaction').filter((t) => t.customer === customer && String(t.currency) === currency).reduce((n, t) => n + (Number(t.net_amount) || 0), 0);
  await created(ctx, 'customer_cash_balance_transaction', { customer }, { currency, type: 'refunded_from_payment', net_amount: amount, ending_balance: before + amount, refunded_from_payment: { refund: refundId }, livemode: false });
}



/** A capture=false charge's refund, which releases its whole authorization (see the header). */
export async function refundUncaptured(ctx: HandlerContext, charge: Row, amount: number, remaining: number, params: Row): Promise<Response> {
  if (amount < remaining) return fail(ctx, `Charge ${String(charge.id)} is uncaptured: refunding it releases the whole authorization (${remaining}).`, 400, 'amount_too_small');
  const { reason, metadata } = params;
  return ctx.reply(await releaseAuthorization(ctx, charge, ctx.call.operation.id, { ...(reason !== undefined ? { reason } : {}), ...(metadata !== undefined ? { metadata } : {}) }));
}



export async function refundCharge(ctx: HandlerContext, charge: Row, params: Row): Promise<Response> {
  const chargeId = String(charge.id);
  const total = Number(charge.amount) || 0;
  const already = Number(charge.amount_refunded) || 0;
  const remaining = Math.max(0, total - already);
  const amount = params.amount === undefined ? remaining : Math.trunc(Number(params.amount));
  if (!Number.isFinite(amount) || amount <= 0) return fail(ctx, 'Invalid integer: amount must be a positive integer.', 400, 'parameter_invalid_integer');
  if (amount > remaining) return fail(ctx, `Refund amount (${amount}) is greater than unrefunded amount on charge (${remaining}).`, 400, 'amount_too_large');
  if (params.reason !== undefined && !REFUND_REASONS.has(String(params.reason))) return badReason(ctx);
  // an authorization is released, never refunded out of the balance: a PaymentIntent's by cancelling the intent, a
  // capture=false charge's by its refund (refundUncaptured)
  if (charge.captured === false && typeof charge.payment_intent === 'string') return fail(ctx, `Charge ${chargeId} is uncaptured and can't be refunded directly; cancel its PaymentIntent (${charge.payment_intent}) to release the authorization.`, 400, 'payment_intent_unexpected_state');
  if (charge.captured === false) return refundUncaptured(ctx, charge, amount, remaining, params);
  const refunded = already + amount;
  // the refund that takes the rest refunds the charge: the charge machine's move under this operation
  if (refunded >= total && charge.refunded !== true) {
    const refused = ctx.legal('charge', 'refunded', ctx.call.operation.id, 'false', 'true', chargeId);
    if (refused) return ctx.refuse(refused);
  }
  // a refund has no `livemode` field; it debits the balance at once
  const refundId = ctx.mint('refund');
  const currency = String(charge.currency ?? 'usd');
  const pi = typeof charge.payment_intent === 'string' ? ctx.get('payment_intent', charge.payment_intent) : undefined;
  const byTransfer = ((pi?.payment_method_types as unknown[] | undefined) ?? []).includes('customer_balance');
  const toCashBalance = byTransfer && params.origin === 'customer_balance';
  const awaitsBank = byTransfer && !toCashBalance;
  const now = Number(nowUnix(ctx.occurredAt));
  const customer = typeof charge.customer === 'string' ? charge.customer : typeof pi?.customer === 'string' ? pi.customer : undefined;
  const emailTo = typeof params.instructions_email === 'string' ? params.instructions_email : (customer ? ctx.get('customer', customer)?.email : undefined) ?? null;
  // "Refunds use your available Stripe balance (not including pending amounts). If your available balance doesn't
  // cover the amount of the refund, Stripe holds the refund as pending for card transactions ... until your Stripe
  // balance becomes sufficient" (docs.stripe.com/refunds): the refund waits, moving no money, until the balance covers
  // it (settleHeldRefunds). Where the documentation stops and the twin decides: a refund of another payment method
  // short of balance is not modelled (Stripe fails it); the twin makes it as a card's.
  const account = actingAccount(ctx);
  const isCard = (charge.payment_method_details as Row | null | undefined)?.type === 'card';
  const held = !awaitsBank && !toCashBalance && isCard && availableAt(ctx, account, currency, now) < amount;
  if (held) ctx.legal('refund', 'status', ctx.call.operation.id, 'succeeded', 'pending', refundId);
  const bt = awaitsBank || held ? null : await settleRefund(ctx, refundId, amount, currency);
  if (toCashBalance && customer) await backToCashBalance(ctx, customer, currency, amount, refundId);
  const { reverse_transfer: reverseTransfer, refund_application_fee: refundFee, instructions_email: _email, origin: _origin, ...stored } = params;
  const share = (whole: number): number => Math.round((whole * amount) / (total || 1));
  let transferReversal: string | null = null;
  const transfer = typeof charge.transfer === 'string' ? ctx.get('transfer', charge.transfer) : undefined;
  if (reverseTransfer !== undefined && asBool(reverseTransfer) && transfer) {
    const back = Math.min(share(Number(transfer.amount) || 0), (Number(transfer.amount) || 0) - (Number(transfer.amount_reversed) || 0));
    const trr = await created(ctx, 'transfer_reversal', { amount: back, currency, transfer: transfer.id }, { balance_transaction: null, destination_payment_refund: null, source_refund: refundId, metadata: {} });
    const trrBt = await settleTransferReversal(ctx, String(trr.id), back, currency, String(transfer.destination));
    const reversal = await ctx.write('transfer_reversal', String(trr.id), { balance_transaction: trrBt }, 'transfer_reversal.updated');
    const reversed = (Number(transfer.amount_reversed) || 0) + back;
    const list = (transfer.reversals as Row | undefined) ?? { object: 'list', data: [], has_more: false, total_count: 0 };
    const data = [...(((list.data as unknown[]) ?? [])), reversal];
    await ctx.write('transfer', String(transfer.id), { amount_reversed: reversed, reversed: reversed >= (Number(transfer.amount) || 0), reversals: { ...list, data, total_count: data.length, url: `/v1/transfers/${String(transfer.id)}/reversals` } }, 'transfer.reversed');
    transferReversal = String(trr.id);
  }
  const fee = typeof charge.application_fee === 'string' ? ctx.get('application_fee', charge.application_fee) : undefined;
  if (refundFee !== undefined && asBool(refundFee) && fee) {
    const feeTotal = Number(fee.amount) || 0;
    const back = Math.min(share(feeTotal), feeTotal - (Number(fee.amount_refunded) || 0));
    const done = (Number(fee.amount_refunded) || 0) + back;
    if (!(done >= feeTotal && fee.refunded !== true && ctx.legal('application_fee', 'refunded', ctx.call.operation.id, 'false', 'true', String(fee.id)))) {
      const fr = await created(ctx, 'fee_refund', { amount: back, currency, fee: fee.id }, { balance_transaction: null, metadata: {} });
      const list = (fee.refunds as Row | undefined) ?? { object: 'list', data: [], has_more: false, total_count: 0 };
      const data = [...(((list.data as unknown[]) ?? [])), fr];
      await ctx.write('application_fee', String(fee.id), { amount_refunded: done, refunded: done >= feeTotal, refunds: { ...list, data, total_count: data.length, url: `/v1/application_fees/${String(fee.id)}/refunds` } }, 'application_fee.refunded');
    }
  }
  const body = await created(ctx, 'refund', {
    ...stored, id: refundId, charge: chargeId, amount, currency, transfer_reversal: transferReversal,
    ...(typeof charge.payment_intent === 'string' ? { payment_intent: charge.payment_intent } : {}),
  }, {
    status: awaitsBank ? 'requires_action' : held ? 'pending' : 'succeeded', metadata: {}, reason: null, receipt_number: null,
    ...(held ? { pending_reason: 'insufficient_funds', _account: account ?? null } : {}),
    balance_transaction: bt, source_transfer_reversal: null,
    // a bank transfer's refund goes to the customer's bank (a us_bank_transfer) or back to its cash balance
    // (customer_cash_balance): "If this is a `us_bank_transfer` refund, this hash contains the transaction specific details",
    // "If this is a `customer_cash_balance` refund ..." (docs.stripe.com/api/refunds/object, destination_details)
    ...(byTransfer
      ? { destination_details: toCashBalance ? { type: 'customer_cash_balance', customer_cash_balance: {} } : { type: 'us_bank_transfer', us_bank_transfer: { reference: null, reference_status: null } } }
      : refundDestination(charge, 'refund')),
    ...(awaitsBank ? { next_action: { type: 'display_details', display_details: { email_sent: { email_sent_at: now, email_sent_to: emailTo }, expires_at: now + 30 * 86_400 } } } : {}),
  });
  await ctx.write('charge', chargeId, { amount_refunded: refunded, refunded: refunded >= total }, 'charge.refunded');
  return ctx.reply(body);
}



/** The charge a refund aims at: named directly, or reached through its PaymentIntent. */
export function target(ctx: HandlerContext): Row | Response {
  const chargeId = typeof ctx.params.charge === 'string' ? ctx.params.charge : '';
  const piId = typeof ctx.params.payment_intent === 'string' ? ctx.params.payment_intent : '';
  if (!chargeId && !piId) return fail(ctx, 'One of `charge` or `payment_intent` is required.', 400, 'parameter_missing');
  if (chargeId) return ctx.get('charge', chargeId) ?? fail(ctx, `No such charge: '${chargeId}'`, 404, 'resource_missing');
  const pi = ctx.get('payment_intent', piId);
  if (!pi) return fail(ctx, `No such payment_intent: '${piId}'`, 404, 'resource_missing');
  const latest = typeof pi.latest_charge === 'string' ? pi.latest_charge : undefined;
  const ch = (latest ? ctx.get('charge', latest) : undefined) ?? newest(ctx, 'charge').find((c) => c.payment_intent === piId);
  return ch ?? fail(ctx, `This PaymentIntent does not have a successful charge to refund. Its status is ${String(pi.status)}.`, 400, 'payment_intent_unexpected_state');
}


/** A pending invoice item contributes to a preview only on its customer's next invoice. */
// source: spec:PostInvoicesCreatePreview "including subscription renewal charges, invoice item charges, etc."
export function pendingPreviewItem(ii: Row, customer: string, currency: string, now: number): Row | undefined {
  if (ii.customer !== customer || ii.invoice) return undefined;
  return {
    id: `il_${String(ii.id)}`, object: 'line_item', type: 'invoiceitem', amount: Number(ii.amount) || 0, currency,
    quantity: Number(ii.quantity) || 1, proration: false, invoice_item: ii.id,
    period: ii.period ?? { start: now, end: now }, description: (ii.description as string) ?? null,
  };
}

export function pendingPreviewLines(ctx: HandlerContext, customer: string, currency: string, now: number): Row[] {
  return newest(ctx, 'invoiceitem', 'date').flatMap(ii => { const line = pendingPreviewItem(ii, customer, currency, now); return line ? [line] : []; });
}
