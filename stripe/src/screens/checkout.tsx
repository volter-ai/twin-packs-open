// STRIPE CHECKOUT — a hosted flow (docs/contributing/architecture.md, "Screens"): an application creates a
// Checkout Session and sends its customer to the session's `url` at checkout.stripe.com/c/pay/{id}; the
// customer pays there, the session completes (what the payment made is linked on it and
// checkout.session.completed is delivered), and Checkout redirects to success_url with
// {CHECKOUT_SESSION_ID} filled in, or the customer goes back to cancel_url
// (docs.stripe.com/payments/checkout/how-checkout-works). Paying is a move no API call makes: the external
// actor's move on the session's machine, taken here through the same handler context the API's handlers use.
// The page is authored from @volter/world-ui's payment piece under Stripe's skin, nothing of Stripe's page
// copied; its fields carry the ids tests of Checkout fill (email, cardNumber, cardExpiry, cardCvc,
// billingName, billingCountry, billingPostalCode) and its button the test id Stripe gives it.
//
// Where the documentation stops and the twin decides: test cards answer as docs.stripe.com/testing lists
// (4242… pays; 4000000000000002 declines; …9995 insufficient funds; …0069 expired; …0127 incorrect CVC;
// …0341 is saved but declines when charged, so it declines on a page that charges now and is saved on one that
// only sets the card up: setup mode, or a subscription's trial);
// any other number that passes the Luhn check pays, and a card that asks for authentication pays without
// the challenge. A subscription session with no customer makes one from the email, as Stripe does.
import type { HandlerContext } from '@volter/world-core';
import { flowPage, Payment, PAYMENT_CSS, type PaymentField } from '@volter/world-ui';
import { isOneTime } from '../engine/checkout.ts';
import { newCustomer } from '../engine/customers.ts';
import type { Row } from '../engine/common.ts';
import { publicBusinessName } from '../engine/display.ts';
import { applyCouponDiscount, nowUnix, PLATFORM_ACCOUNT_ID, resolveTrial } from '../engine/stripe.ts';
import { cardAnswer, COUNTRIES, formOf, money, notFound, parseExpiry } from './shared.tsx';
import { completeSession, created } from '../semantics/shared.ts';
const CS = 'checkout.session';
const COMPLETE_OPERATION = { id: 'PostCheckoutSessionsSession' };

// Stripe's skin: its type, its blue submit, the summary on a tinted half.
const SKIN = `
body { color: #1a1a1a; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Ubuntu, sans-serif; }
.pay-summary { background: #f7f7f9; }
.pay-back, .pay-line small, .pay-total-lead span { color: #6b7280; }
.pay-field input, .pay-field select { border-color: #e0e0e0; background: #ffffff; }
.pay-error { color: #df1b41; }
.pay-submit { background: #0074d4; color: #ffffff; }
`;

/** A subscription session's trial, when its subscription_data gives one: `trial_period_days`, or `trial_end`
 *  (docs.stripe.com/payments/checkout/free-trials), as resolveTrial makes the subscription's at completion. */
function trialOf(session: Row, now: number): { start: number; end: number } | undefined {
  const data = (session as { _subscription_data?: Row })._subscription_data;
  return session.mode === 'subscription' && data && typeof data === 'object' ? resolveTrial(data, now) : undefined;
}

/** A session line's inline price_data, when it was given one (semantics/checkout.ts keeps them). */
const inlineOf = (session: Row, i: number): Row | null | undefined => (session._price_data as Array<Row | null> | undefined)?.[i];

const recurringOf = (item: Row): Row | undefined => (item.price && typeof item.price === 'object' ? ((item.price as Row).recurring as Row | undefined) ?? undefined : undefined);

/** How often a price bills, as Checkout says it after the amount: "per month". Where the documentation stops and the twin
 *  decides: a price billing every several intervals reads "every 3 months". */
function cadenceOf(session: Row): string {
  const lines = ((session.line_items as { data?: Row[] } | undefined)?.data) ?? [];
  const recurring = lines.map((it, i) => recurringOf(it) ?? (inlineOf(session, i)?.recurring as Row | undefined)).find(Boolean);
  const interval = typeof recurring?.interval === 'string' ? recurring.interval : 'month';
  const count = Math.max(1, Math.trunc(Number(recurring?.interval_count ?? 1)) || 1);
  return count === 1 ? `per ${interval}` : `every ${count} ${interval}s`;
}

/** What a trial's Checkout says, as checkout.stripe.com shows it for a 14-day trial of a $12.99 monthly price: the lead
 *  "14 days free" over "Then $12.99 per month", the button "Start trial", and under it "After your trial ends, you will
 *  be charged $12.99 per month starting July 7, 2025. You can always cancel before then." (a live Checkout page's
 *  screenshot, github.com/stripe/stripe-react-native/issues/1975; Stripe's docs describe no wording). Where that stops
 *  and the twin decides: a one-day trial reads "1 day free", a trial set by `trial_end` counts its days rounded up, and
 *  the amount is the session's total, what the first invoice after the trial charges. */
function trialSummary(session: Row, trial: { start: number; end: number }): { lead: { label: string; amount: string; detail: string }; note: string } {
  const days = Math.ceil((trial.end - trial.start) / 86400);
  const then = `${money(afterTrial(session), session.currency)} ${cadenceOf(session)}`;
  const date = new Date(trial.end * 1000).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  return {
    lead: { label: '', amount: `${days} ${days === 1 ? 'day' : 'days'} free`, detail: `Then ${then}` },
    note: `After your trial ends, you will be charged ${then} starting ${date}. You can always cancel before then.`,
  };
}

/** What each period after the trial charges, as the subscription's invoices will: its recurring line items (a one-time
 *  item is on the first invoice only, semantics/checkout.ts isOneTime), under the session's coupon unless the coupon is `once`, which the trial's own $0
 *  invoice takes (../engine/renewals.ts draftSubscriptionInvoice). */
function afterTrial(session: Row): number {
  const items = (((session.line_items as { data?: Row[] } | undefined)?.data) ?? []).filter((it, i) => !isOneTime(it, inlineOf(session, i)));
  const subtotal = items.reduce((sum, it) => sum + (Number(it.amount_subtotal) || 0), 0);
  const coupon = session._coupon as Row | undefined;
  return subtotal - (coupon && coupon.duration !== 'once' ? applyCouponDiscount(subtotal, coupon) : 0);
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** The email of the session's customer when it has a valid one: "If the Customer already has a valid email set, the email
 *  will be prefilled and not editable in Checkout" (docs.stripe.com/api/checkout/sessions/create#create_checkout_session-customer). */
function customerEmailOf(session: Row): string | undefined {
  const email = (session._customer as Row | undefined)?.email;
  return typeof email === 'string' && EMAIL.test(email) ? email : undefined;
}

function page(session: Row, id: string, now: number, values: Record<string, string> = {}, error?: string): Response {
  const lines = (((session.line_items as { data?: Row[] } | undefined)?.data) ?? []).map((item) => ({
    name: String(item.description ?? 'Item'),
    amount: money(item.amount_total, item.currency ?? session.currency),
    ...(Number(item.quantity) > 1 ? { detail: `Qty ${String(item.quantity)}` } : {}),
  }));
  const mode = String(session.mode);
  const merchant = String(session._merchant);
  const trial = trialOf(session, now);
  const submit = mode === 'setup' ? 'Save card' : mode === 'subscription' ? (trial ? 'Start trial' : 'Subscribe') : 'Pay';
  const trialText = trial ? trialSummary(session, trial) : undefined;
  const onFile = customerEmailOf(session);
  const contact: PaymentField[] = onFile
    ? [{ id: 'email', label: 'Email', type: 'email', autoComplete: 'email', value: onFile, readOnly: true }]
    : typeof session.customer_email === 'string'
      ? [{ id: 'email', label: 'Email', type: 'email', autoComplete: 'email', value: session.customer_email }]
      : [{ id: 'email', label: 'Email', type: 'email', autoComplete: 'email', placeholder: 'email@example.com', value: values.email ?? '' }];
  const card: PaymentField[] = [
    { id: 'cardNumber', label: 'Card number', autoComplete: 'cc-number', placeholder: '1234 1234 1234 1234', value: values.cardNumber ?? '' },
    { id: 'cardExpiry', label: 'Expiration', autoComplete: 'cc-exp', placeholder: 'MM / YY', value: values.cardExpiry ?? '', format: 'card-expiry' },
    { id: 'cardCvc', label: 'CVC', autoComplete: 'cc-csc', placeholder: 'CVC', value: values.cardCvc ?? '' },
    { id: 'billingName', label: 'Cardholder name', autoComplete: 'cc-name', placeholder: 'Full name on card', value: values.billingName ?? '' },
    { id: 'billingCountry', label: 'Country or region', options: COUNTRIES, value: values.billingCountry ?? 'US' },
    { id: 'billingPostalCode', label: 'ZIP', autoComplete: 'postal-code', placeholder: 'ZIP', value: values.billingPostalCode ?? '' },
  ];
  return flowPage({
    title: 'Checkout',
    css: [PAYMENT_CSS, SKIN],
    status: error ? 402 : 200,
    body: (
      <Payment
        merchant={merchant}
        lines={lines}
        {...(trialText ? { total: trialText.lead, note: trialText.note } : session.amount_total !== null && session.amount_total !== undefined ? { total: { label: mode === 'subscription' ? 'Subscribe' : `Pay ${merchant}`, amount: money(session.amount_total, session.currency) } } : {})}
        action={`/c/pay/${id}`}
        sections={[{ heading: 'Contact information', fields: contact }, { heading: 'Payment method', fields: card }]}
        submit={{ label: submit, testId: 'hosted-payment-submit-button' }}
        {...(typeof session.cancel_url === 'string' ? { back: { href: session.cancel_url, label: '← Back' } } : {})}
        {...(error ? { error } : {})}
      />
    ),
  });
}

const gone = (): Response =>
  flowPage({ title: 'Checkout', status: 404, css: [PAYMENT_CSS, SKIN], body: <main className="pay-form"><h1>This Checkout Session is no longer active.</h1></main> });

async function pay(ctx: HandlerContext, id: string, session: Row, v: Record<string, string>): Promise<Response> {
  const onFile = customerEmailOf(session);
  const email = onFile ?? (typeof session.customer_email === 'string' ? session.customer_email : (v.email ?? '').trim());
  if (session.mode !== 'setup' || !session.customer) {
    if (!EMAIL.test(email)) return page(session, id, nowUnix(ctx.occurredAt), v, 'Your email address is incomplete.');
  }
  // a trial charges nothing now unless a one-time price is on the first invoice
  const oneTimeDue = (((session.line_items as { data?: Row[] } | undefined)?.data) ?? []).some((it, i) => isOneTime(it, inlineOf(session, i)));
  const chargesNow = session.mode === 'payment' || (session.mode === 'subscription' && (!trialOf(session, nowUnix(ctx.occurredAt)) || oneTimeDue));
  const refused = cardAnswer(v, nowUnix(ctx.occurredAt), chargesNow);
  if (refused) return page(session, id, nowUnix(ctx.occurredAt), v, refused);
  let existing = session;
  // Checkout always makes a customer for a subscription; a payment makes one only when the session asks
  if (!session.customer && (session.mode === 'subscription' || session.customer_creation === 'always')) {
    const cid = ctx.mint('customer');
    const customer = await created(ctx, 'customer', { id: cid, email, ...(v.billingName ? { name: v.billingName } : {}) }, { livemode: false, ...newCustomer(cid) });
    existing = { ...session, customer: customer.id };
  }
  // "If the Customer does not have a valid email, Checkout will set the email entered during the session on the Customer" (the same page)
  if (typeof session.customer === 'string' && !onFile && EMAIL.test(email)) await ctx.write('customer', session.customer, { email }, 'customer.update');
  const details: Row = {
    customer_details: { email, name: v.billingName || null, address: { country: v.billingCountry || null, postal_code: v.billingPostalCode || null, city: null, line1: null, line2: null, state: null }, phone: null, tax_exempt: 'none', tax_ids: [] },
    ...(existing.customer !== session.customer ? { customer: existing.customer } : {}),
  };
  const exp = parseExpiry(v.cardExpiry ?? '')!;
  const done = await completeSession(ctx, id, existing, details, { number: (v.cardNumber ?? '').replace(/\D/g, ''), exp_month: exp.month, exp_year: exp.year });
  if (done instanceof Response) return gone();
  const to = String(session.success_url).replaceAll('{CHECKOUT_SESSION_ID}', id);
  return new Response(null, { status: 303, headers: { location: to } });
}

/** The name the page shows: the session's own `branding_settings.display_name` where the create set one, else the
 *  public business name (../engine/display.ts, publicBusinessName) of the account whose brand Checkout uses: "Checkout uses
 *  the brand settings of the connected account for destination charges with on_behalf_of and for platforms performing
 *  direct charges" (a session made with Stripe-Account), and otherwise the platform's; "If you omit a field in
 *  branding_settings, Checkout applies the default value from the Dashboard"
 *  (docs.stripe.com/payments/checkout/customization/appearance). */
function merchantOf(ctx: HandlerContext, stored: Row): string {
  const brand = (stored._branding_settings as Row | undefined)?.display_name;
  const behalf = (stored._payment_intent_data as Row | undefined)?.on_behalf_of ?? (stored._subscription_data as Row | undefined)?.on_behalf_of;
  const account = typeof behalf === 'string' ? behalf : typeof stored._brand_account === 'string' ? stored._brand_account : PLATFORM_ACCOUNT_ID;
  return typeof brand === 'string' && brand.trim() ? brand : publicBusinessName(ctx.get('account', account));
}

export async function screen(ctx: HandlerContext): Promise<Response> {
  const request = ctx.call.request;
  const m = /^\/c\/pay\/(cs_[A-Za-z0-9_]+)\/?$/.exec(new URL(request.url).pathname);
  if (!m || (request.method !== 'GET' && request.method !== 'POST')) return notFound();
  const id = m[1]!;
  // the form is read before the context, which reads the request's body itself
  const values = request.method === 'POST' ? await formOf(request.clone()) : {};
  const session = ctx.get(CS, id);
  if (!session) return gone();
  // an ended session's page is gone; paying on one is the customer's move the machine refuses
  if (session.status !== 'open' && (request.method === 'GET' || ctx.legal(CS, 'status', COMPLETE_OPERATION.id, String(session.status), 'complete', id, 'external'))) return gone();
  const stored = ctx.row(CS, id) ?? {};
  const coupon = (stored._discount as Row | undefined)?.coupon;
  const full = { ...session, _subscription_data: stored._subscription_data, _price_data: stored._price_data, _merchant: merchantOf(ctx, stored), _coupon: typeof coupon === 'string' ? ctx.get('coupon', coupon) : undefined, _customer: typeof session.customer === 'string' ? ctx.get('customer', session.customer) : undefined };
  return request.method === 'GET' ? page(full, id, nowUnix(ctx.occurredAt)) : pay(ctx, id, full, values);
}
