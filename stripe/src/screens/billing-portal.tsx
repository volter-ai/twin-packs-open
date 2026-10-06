// STRIPE'S CUSTOMER PORTAL — a hosted flow (docs/contributing/architecture.md, "Screens"): an application creates
// a portal session for its customer and sends them to the session's `url` at billing.stripe.com/p/session/{id};
// there the customer sees their plans, payment method, billing details and invoices, and makes the moves the
// portal configuration allows, then returns to return_url (docs.stripe.com/customer-management). Canceling is the
// customer's own move (the subscription machine's external actor): at the period's end by default, or at once
// when the configuration's subscription_cancel.mode says immediately, and a plan set to cancel can be renewed.
// Each move goes through the same handler context the API's handlers use, so the application sees it as it
// would from Stripe: on the subscription, and in its events. Authored from @volter/world-ui's portal piece under
// Stripe's skin; nothing of Stripe's page is copied.
//
// The customer also replaces their card, which becomes the default for their invoices and subscriptions, and pays
// an open invoice with it, which makes a subscription waiting on it (past_due) active again
// (docs.stripe.com/customer-management/configure-portal: payment_method_update, invoice_history).
//
// Where the documentation stops and the twin decides: a session's configuration that the World never created
// (the account's default) enables cancellation at period end, updating the payment method and invoice history;
// changing the plan from the portal is not offered yet. A new card is saved without a charge, so a card that
// declines only when charged (4000000000000341) is saved and declines when the invoice is paid.
import type { HandlerContext } from '@volter/world-core';
import { flowPage, type PaymentField, Portal, PORTAL_CSS, type PortalItem } from '@volter/world-ui';
import type { Row } from '../engine/common.ts';
import { publicBusinessName } from '../engine/display.ts';
import { declineFor, nowUnix, paymentMethodSubObject, PLATFORM_ACCOUNT_ID } from '../engine/stripe.ts';
import { cardAnswer, COUNTRIES, formOf, money, notFound } from './shared.tsx';
import { resourceView, afterSuccessOf, created, payerOf, payOpenInvoice } from '../semantics/shared.ts';
const SUB = 'subscription';
const PORTAL_OPERATION = { id: 'PostBillingPortalSessions' };

// Stripe's skin: its type, its purple accent, the merchant's side tinted.
const SKIN = `
body { color: #1a1a1a; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Ubuntu, sans-serif; }
.portal-side { background: #f7f7f9; }
.portal-back { color: #635bff; }
.portal-section h2 { color: #6b7280; border-color: #e5e7eb; }
.portal-item { border-bottom: 1px solid #f0f0f3; }
.portal-detail, .portal-note { color: #6b7280; }
.portal-badge { background: #eef0f4; color: #414552; }
.portal-button { border-color: #d5dbe1; color: #1a1a1a; }
.portal-primary { background: #635bff; border-color: #635bff; color: #ffffff; }
.portal-danger { color: #df1b41; border-color: #f4c7d0; }
.portal-empty { color: #6b7280; }
`;

const day = (epoch: unknown): string => new Date(Number(epoch) * 1000).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const gone = (): Response => flowPage({ title: 'Billing', status: 404, css: [PORTAL_CSS, SKIN], body: <main className="portal-main"><h1>This link has expired.</h1></main> });

type Features = { cancel: { enabled: boolean; mode: 'at_period_end' | 'immediately' }; invoices: boolean; paymentMethod: boolean };
function featuresOf(ctx: HandlerContext, session: Row): Features {
  const f = (ctx.get('billing_portal.configuration', String(session.configuration))?.features ?? undefined) as Row | undefined;
  const cancel = (f?.subscription_cancel ?? {}) as Row;
  const invoices = (f?.invoice_history ?? {}) as Row;
  const update = (f?.payment_method_update ?? {}) as Row;
  return {
    cancel: { enabled: f ? cancel.enabled === true : true, mode: cancel.mode === 'immediately' ? 'immediately' : 'at_period_end' },
    invoices: f ? invoices.enabled !== false : true,
    paymentMethod: f ? update.enabled === true : true,
  };
}

function planOf(ctx: HandlerContext, sub: Row): { name: string; price: string } {
  const item = (((sub.items as { data?: Row[] } | undefined)?.data) ?? [])[0];
  const price = (typeof item?.price === 'object' ? item.price : ctx.get('price', String(item?.price ?? ''))) as Row | undefined;
  const product = typeof price?.product === 'string' ? ctx.get('product', price.product) : (price?.product as Row | undefined);
  const recurring = price?.recurring as Row | undefined;
  return {
    name: String(product?.name ?? price?.nickname ?? 'Plan'),
    price: price ? `${money(price.unit_amount, price.currency)}${recurring?.interval ? ` per ${String(recurring.interval)}` : ''}` : '',
  };
}

function page(ctx: HandlerContext, id: string, session: Row, problem?: { error: string; values: Record<string, string> }): Response {
  const features = featuresOf(ctx, session);
  const customer = ctx.get('customer', String(session.customer)) ?? {};
  const subs = ctx.rows(SUB).map((s) => ctx.expand(SUB, s)).filter((s) => s.customer === session.customer && s.status !== 'canceled' && s.status !== 'incomplete_expired');
  const plans: PortalItem[] = subs.map((s) => {
    const plan = planOf(ctx, s);
    const ending = s.cancel_at_period_end === true;
    return {
      title: plan.name,
      detail: plan.price,
      badge: s.status === 'trialing' ? 'Trial' : s.status === 'past_due' ? 'Past due' : ending ? 'Cancels' : undefined,
      note: ending ? `Your plan will be canceled on ${day(s.current_period_end)}.` : s.status === 'trialing' ? `Trial ends ${day(s.trial_end)}.` : `Renews on ${day(s.current_period_end)}.`,
      actions: ending
        ? [{ label: 'Renew plan', action: `/p/session/${id}/renew`, fields: { subscription: String(s.id) }, tone: 'primary' as const }]
        : features.cancel.enabled ? [{ label: 'Cancel plan', action: `/p/session/${id}/cancel`, fields: { subscription: String(s.id) }, tone: 'danger' as const }] : [],
    };
  });
  const defaultPm = ((customer.invoice_settings as Row | undefined)?.default_payment_method as string | undefined) ?? undefined;
  const pms = ctx.rows('payment_method').filter((p) => p.customer === session.customer);
  const subDefault = subs.map((sub) => payerOf(ctx, sub)).find((p) => typeof p === 'string');
  const pm = (defaultPm ? pms.find((p) => p.id === defaultPm) : undefined) ?? (subDefault ? pms.find((p) => p.id === subDefault) : undefined) ?? pms[0];
  const card = pm?.card as Row | undefined;
  const methods: PortalItem[] = pm ? [{ title: `${String(card?.brand ?? 'card').replace(/^./, (c) => c.toUpperCase())} •••• ${String(card?.last4 ?? '')}`, detail: card ? `Expires ${String(card.exp_month).padStart(2, '0')}/${String(card.exp_year)}` : undefined, badge: 'Default' }] : [];
  const address = customer.address as Row | undefined;
  const details: PortalItem[] = [{ title: String(customer.name ?? customer.email ?? ''), detail: String(customer.email ?? ''), ...(address?.country ? { note: [address.line1, address.city, address.postal_code, address.country].filter(Boolean).join(', ') } : {}) }];
  const invoices: PortalItem[] = features.invoices
    ? ctx.rows('invoice').filter((i) => i.customer === session.customer && i.status !== 'draft').sort((a, b) => Number(b.created) - Number(a.created))
      .map((i) => ({
        title: day(i.created), detail: money(i.amount_due ?? i.total, i.currency), badge: String(i.status ?? '').replace(/^./, (c) => c.toUpperCase()),
        ...(i.status === 'open' && i.collection_method !== 'send_invoice' ? { actions: [{ label: 'Pay', action: `/p/session/${id}/pay`, fields: { invoice: String(i.id) }, tone: 'primary' as const }] } : {}),
      }))
    : [];
  const back = typeof session.return_url === 'string' ? session.return_url : undefined;
  // the portal shows the public business name (../engine/display.ts, publicBusinessName) of the session's on_behalf_of
  // account ("Use the Accounts API to modify the on_behalf_of account's branding settings, which the portal displays",
  // docs.stripe.com/api/customer_portal/sessions/object), else of the account it was made on (Stripe-Account), else the
  // platform's
  const owner = session.on_behalf_of ?? ctx.row('billing_portal.session', String(session.id))?._brand_account;
  const merchant = publicBusinessName(ctx.get('account', typeof owner === 'string' ? owner : PLATFORM_ACCOUNT_ID));
  const v = problem?.values ?? {};
  const cardFields: PaymentField[] = [
    { id: 'cardNumber', label: 'Card number', autoComplete: 'cc-number', placeholder: '1234 1234 1234 1234', value: v.cardNumber ?? '' },
    { id: 'cardExpiry', label: 'Expiration', autoComplete: 'cc-exp', placeholder: 'MM / YY', value: v.cardExpiry ?? '' },
    { id: 'cardCvc', label: 'CVC', autoComplete: 'cc-csc', placeholder: 'CVC', value: v.cardCvc ?? '' },
    { id: 'billingName', label: 'Name on card', autoComplete: 'cc-name', value: v.billingName ?? '' },
    { id: 'billingCountry', label: 'Country or region', options: COUNTRIES, value: v.billingCountry ?? 'US' },
    { id: 'billingPostalCode', label: 'ZIP', autoComplete: 'postal-code', value: v.billingPostalCode ?? '' },
  ];
  return flowPage({
    title: 'Billing',
    css: [PORTAL_CSS, SKIN],
    ...(problem ? { status: 402 } : {}),
    body: (
      <Portal
        merchant={merchant}
        {...(problem ? { notice: problem.error } : {})}
        {...(features.paymentMethod ? { forms: [{ heading: pm ? 'Update payment method' : 'Add payment method', action: `/p/session/${id}/payment_method`, fields: cardFields, submit: { label: pm ? 'Update' : 'Add' } }] } : {})}
        {...(back ? { back: { href: back, label: `← Return to ${merchant}` } } : {})}
        sections={[
          { heading: 'Current plan', items: plans, empty: 'You have no active plans.' },
          { heading: 'Payment method', items: methods, empty: 'No payment method on file.' },
          { heading: 'Billing information', items: details },
          ...(features.invoices ? [{ heading: 'Invoice history', items: invoices, empty: 'No invoices yet.' }] : []),
        ]}
      />
    ),
  });
}

/** The customer's move on one of their subscriptions, then back to the portal. */
async function move(ctx: HandlerContext, id: string, session: Row, subscription: string, kind: 'cancel' | 'renew'): Promise<Response> {
  const sub = resourceView(ctx, SUB, subscription);
  if (!sub || sub.customer !== session.customer || sub.status === 'canceled') return gone();
  const back = new Response(null, { status: 303, headers: { location: `/p/session/${id}` } });
  if (kind === 'renew') {
    await ctx.write(SUB, subscription, { cancel_at_period_end: false, cancel_at: null, canceled_at: null, cancellation_details: { comment: null, feedback: null, reason: null } }, 'subscription.update');
    return back;
  }
  const features = featuresOf(ctx, session);
  if (!features.cancel.enabled) return gone();
  const now = nowUnix(ctx.occurredAt);
  const details = { comment: null, feedback: null, reason: 'cancellation_requested' };
  if (features.cancel.mode === 'at_period_end') {
    await ctx.write(SUB, subscription, { cancel_at_period_end: true, cancel_at: sub.current_period_end ?? null, canceled_at: now, cancellation_details: details }, 'subscription.update');
    return back;
  }
  const refused = ctx.legal(SUB, 'status', PORTAL_OPERATION.id, sub.status, 'canceled', subscription, 'external');
  if (refused) return gone();
  await ctx.write(SUB, subscription, { status: 'canceled', canceled_at: now, ended_at: now, cancellation_details: details }, 'subscription.cancel');
  return back;
}

/** The customer's new card: saved on them (no charge) as the default their invoices and subscriptions charge. */
async function updatePaymentMethod(ctx: HandlerContext, id: string, session: Row, v: Record<string, string>): Promise<Response> {
  if (!featuresOf(ctx, session).paymentMethod) return gone();
  const refused = cardAnswer(v, nowUnix(ctx.occurredAt), false);
  if (refused) return page(ctx, id, session, { error: refused, values: v });
  const customer = String(session.customer);
  const [month, year] = (v.cardExpiry ?? '').split('/').map((x) => Number(x.trim()));
  const card = { number: (v.cardNumber ?? '').replace(/\D/g, ''), exp_month: month ?? 12, exp_year: (year ?? 0) < 100 ? 2000 + (year ?? 0) : (year ?? 0) };
  const pm = await created(ctx, 'payment_method', {}, {
    type: 'card', customer, livemode: false,
    billing_details: { address: { country: v.billingCountry || null, postal_code: v.billingPostalCode || null, city: null, line1: null, line2: null, state: null }, email: null, name: v.billingName || null, phone: null },
    ...paymentMethodSubObject('card', { card }), _declineOutcome: declineFor(() => undefined, { card }) ?? null,
    ...(afterSuccessOf(ctx, card) ? { _afterSuccess: afterSuccessOf(ctx, card) } : {}),
  });
  const holder = ctx.get('customer', customer) ?? {};
  await ctx.write('customer', customer, { invoice_settings: { ...((holder.invoice_settings as Row | undefined) ?? {}), default_payment_method: pm.id } }, 'customer.update');
  for (const sub of ctx.rows(SUB).map((s) => ctx.expand(SUB, s)).filter((s) => s.customer === customer && s.status !== 'canceled' && s.status !== 'incomplete_expired')) {
    await ctx.write(SUB, String(sub.id), { default_payment_method: pm.id }, 'subscription.update');
  }
  return new Response(null, { status: 303, headers: { location: `/p/session/${id}` } });
}

/** The customer pays one of their open invoices with the card on file. */
async function payInvoice(ctx: HandlerContext, id: string, session: Row, invoiceId: string): Promise<Response> {
  const inv = ctx.get('invoice', invoiceId);
  if (!inv || inv.customer !== session.customer || inv.status !== 'open') return gone();
  const sub = typeof inv.subscription === 'string' ? resourceView(ctx, SUB, inv.subscription) : undefined;
  const holder = ctx.get('customer', String(session.customer)) ?? {};
  const pm = (sub ? payerOf(ctx, sub) : undefined) ?? ((holder.invoice_settings as Row | undefined)?.default_payment_method as string | undefined);
  if (!pm) return page(ctx, id, session, { error: 'Add a payment method to pay this invoice.', values: {} });
  const declined = await payOpenInvoice(ctx, invoiceId, pm);
  if (declined) return page(ctx, id, session, { error: declined.message, values: {} });
  return new Response(null, { status: 303, headers: { location: `/p/session/${id}` } });
}

/** billing.stripe.com's portal pages, or undefined for any other request. */
export async function screen(ctx: HandlerContext): Promise<Response> {
  const request = ctx.call.request;
  const m = /^\/p\/session\/(bps_[A-Za-z0-9_]+)(?:\/(cancel|renew|payment_method|pay))?\/?$/.exec(new URL(request.url).pathname);
  if (!m) return notFound();
  const [, id, kind] = m as unknown as [string, string, 'cancel' | 'renew' | 'payment_method' | 'pay' | undefined];
  if ((kind && request.method !== 'POST') || (!kind && request.method !== 'GET')) return notFound();
  // the form is read before the context, which reads the request's body itself
  const form = kind ? await formOf(request.clone()) : {};
  const session = ctx.get('billing_portal.session', id);
  if (!session) return gone();
  if (!kind) return page(ctx, id, session);
  if (kind === 'payment_method') return updatePaymentMethod(ctx, id, session, form);
  if (kind === 'pay') return payInvoice(ctx, id, session, form.invoice ?? '');
  return move(ctx, id, session, form.subscription ?? '', kind);
}
