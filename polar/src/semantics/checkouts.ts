// Checkout sessions: made by the application, confirmed by the customer on Polar's hosted page (or its client API),
// which makes the order, the subscription and the benefit grants.
import type { HandlerContext } from '@volter/world-core';
import { rowOf,
  among, bodyOf, checkoutFields, customerFields, subscriptionFields, createSession, environment, CHECKOUT, checkoutView, newest, CUSTOMER, customerBy, fail, invalid, missing, newId, notFound, ORDER, organizationView, priceView, PRODUCT, type Row, rowsOf, secret, SUBSCRIPTION, addInterval, makeOrder,
} from './shared.ts';

const DAY = 86_400_000;
// source: https://raw.githubusercontent.com/polarsource/polar/main/server/polar/config.py "CHECKOUT_TTL_SECONDS: int = 60 * 60 * 24"

/** `POST /v1/checkouts/`: a session for the first product named, at its first price, open for 24 hours. */
// source: spec:checkouts:create "Create a checkout session."
export async function checkouts_create(ctx: HandlerContext): Promise<Response> {
  const body = bodyOf(ctx);
  const products = Array.isArray(body.products) ? (body.products as unknown[]).map(String) : [];
  // source: spec:/components/schemas/CheckoutProductsCreate "products"
  if (products.length === 0) return missing('products');
  const product = rowOf(ctx, PRODUCT, products[0]!);
  // the spec documents no 404 here: a product or customer that does not exist is the request's validation error, on
  // the field that named it (where the documentation stops: the message's words)
  // source: spec:checkouts:create "Validation Error"
  if (!product || product.deleted === true) return invalid(['products', 0], 'Product does not exist.');
  // source: https://polar.sh/docs/features/checkout/session "Ad-hoc prices are temporary prices that exist only for that specific checkout session"
  const adHoc: Row[] = [];
  for (const p of (body.prices as Record<string, Row[]> | undefined)?.[products[0]!] ?? []) {
    const priceId = ctx.mint('_price');
    await ctx.record('_price', {}, priceId);
    adHoc.push({ ...p, id: priceId, source: 'ad_hoc' });
  }
  const price = (adHoc.length ? adHoc : (product.prices as Row[] | undefined) ?? [])[0];
  const amount = price?.amount_type === 'fixed' ? Number(price.price_amount ?? 0) : Number(body.amount ?? 0);
  const customer = body.customer_id !== undefined ? customerBy(ctx, { id: body.customer_id }) : undefined;
  if (body.customer_id !== undefined && !customer) return invalid(['customer_id'], 'Customer does not exist.');
  const id = newId(ctx, CHECKOUT);
  await ctx.write(CHECKOUT, id, { ...checkoutFields(ctx, {
    id, created_at: ctx.occurredAt, modified_at: null, status: 'open', client_secret: await secret(ctx, 'polar_c_', `checkout:${id}`),
    expires_at: new Date(Date.parse(ctx.occurredAt) + DAY).toISOString(), product_id: product.id, products, product_price_id: price?.id ?? null, amount,
    prices: { [String(product.id)]: (adHoc.length ? adHoc.map((p) => priceView(ctx, p, product)) : product.prices) }, currency: price?.price_currency ?? 'usd', success_url: body.success_url ?? null, return_url: body.return_url ?? null, embed_origin: body.embed_origin ?? null, customer_ip_address: body.customer_ip_address ?? null, allow_discount_codes: body.allow_discount_codes ?? true, require_billing_address: body.require_billing_address ?? false, allow_trial: body.allow_trial ?? null, is_business_customer: body.is_business_customer ?? false,
    customer_id: customer?.id ?? null, customer_email: body.customer_email ?? customer?.email ?? null, customer_name: body.customer_name ?? null,
    external_customer_id: body.external_customer_id ?? body.customer_external_id ?? null, metadata: body.metadata ?? {}, customer_metadata: body.customer_metadata ?? {},
  }), _environment: environment(ctx) }, 'checkout.create');
  return Response.json(checkoutView(ctx, rowOf(ctx, CHECKOUT, id)!), { status: 201 });
}


const bySecret = (ctx: HandlerContext): Row | undefined => rowsOf(ctx, CHECKOUT).find((c) => c.client_secret === ctx.call.params.client_secret);
/** The client API answers CheckoutPublic: the checkout and its organization. */
// source: spec:/components/schemas/CheckoutPublic "CheckoutPublic"
const publicView = (ctx: HandlerContext, c: Row): Row => {
  const { trial_interval: _ti, trial_interval_count: _tc, metadata: _m, external_customer_id: _e, subscription_id: _s, customer_metadata: _cm, ...visible } = checkoutView(ctx, c);
  return { ...visible, organization: organizationView(ctx) };
};

/** `GET /v1/checkouts/{id}`: the session as the application reads it back (its status once the customer has paid). */
// source: spec:checkouts:get "Get a checkout session by ID."
export async function checkouts_get(ctx: HandlerContext): Promise<Response> {
  const c = rowOf(ctx, CHECKOUT, String(ctx.call.params.id));
  return c && c.deleted !== true ? Response.json(checkoutView(ctx, c)) : notFound('Checkout');
}

/** `GET /v1/checkouts/`: the organization's checkout sessions, newest first, by customer, product, status or the
 *  customer's email. */
// source: spec:checkouts:list "List checkout sessions."
export async function checkouts_list(ctx: HandlerContext): Promise<Response> {
  const q = String(ctx.params.query ?? '').toLowerCase();
  const rows = rowsOf(ctx, CHECKOUT)
    .filter((c) => among(ctx, 'customer_id', c.customer_id) && among(ctx, 'external_customer_id', c.external_customer_id) && among(ctx, 'product_id', c.product_id) && among(ctx, 'status', c.status))
    // source: spec:checkouts:list "Filter by customer email."
    .filter((c) => q === '' || String(c.customer_email ?? '').toLowerCase().includes(q))
    .sort(newest('created_at'));
  return ctx.list('Checkout', rows.map((c) => checkoutView(ctx, c)));
}

// source: spec:checkouts:client_get "Get a checkout session by client secret."
export async function checkouts_client_get(ctx: HandlerContext): Promise<Response> {
  const c = bySecret(ctx);
  return c ? Response.json(publicView(ctx, c)) : notFound('Checkout');
}

/** `POST /v1/checkouts/client/{client_secret}/confirm`: the customer pays. The customer is found or made, the order
 *  is paid, a recurring product's subscription starts (trialing through the product's trial), and the checkout
 *  succeeds. A product's benefits are granted too; no application of the demand gives a product one (the benefits'
 *  API is the gap), so none is granted here. */
// source: spec:checkouts:client_confirm "Orders and subscriptions will be processed."
export async function checkouts_client_confirm(ctx: HandlerContext): Promise<Response> {
  const c = bySecret(ctx);
  if (!c) return notFound('Checkout');
  // source: spec:checkouts:client_confirm "The checkout session is expired."
  if (c.status === 'expired') return fail(410, 'ExpiredCheckoutError', 'The checkout session is expired.');
  const refused = ctx.legal('Checkout', 'status', 'checkouts:client_confirm', c.status, 'confirmed', String(c.id), 'external');
  if (refused) return ctx.refuse(refused);
  const body = bodyOf(ctx);
  // source: spec:/components/schemas/CheckoutConfirmStripe/properties/confirmation_token_id "Required for fixed prices and custom prices."
  if (c.is_payment_required && !body.confirmation_token_id) return missing('confirmation_token_id');
  const email = (body.customer_email ?? c.customer_email) as string | null;
  // the customer: the one named, the one the application's own id names, or the one with the email; else a new one
  let customer = c.customer_id ? customerBy(ctx, { id: c.customer_id }) : c.external_customer_id ? customerBy(ctx, { external: c.external_customer_id }) : undefined;
  if (!customer && email) customer = rowsOf(ctx, CUSTOMER).find((x) => String(x.email).toLowerCase() === email.toLowerCase());
  if (!customer && !email) return missing('customer_email');
  const product = rowOf(ctx, PRODUCT, String(c.product_id));
  if (!product) return invalid(['products', 0], 'Product does not exist.');
  // source: spec:checkouts:client_confirm "the customer already has an active subscription"
  const held = customer;
  const existing = product.recurring_interval != null && held ? rowsOf(ctx, SUBSCRIPTION).find((s) => s.customer_id === held.id && s.product_id === product.id && ['trialing', 'active'].includes(String(s.status))) : undefined;
  if (existing) return ctx.refuse(ctx.legal('Subscription', 'status', 'checkouts:client_confirm', existing.status, undefined, String(existing.id), 'external')!);
  // Claim the documented open -> confirmed transition under the kernel's action
  // lock before any awaited customer/order write. Parallel confirms cannot both
  // create payment effects. A crash after this claim remains unresolved; it never
  // authorizes a second payment merely because the first caller missed its answer.
  // source: spec:checkouts:client_confirm "Orders and subscriptions will be processed."
  const at = ctx.occurredAt;
  let claimed = false;
  await ctx.change('Checkout', String(c.id), (current) => {
    if (current.status !== 'open') return undefined;
    claimed = true;
    return { status: 'confirmed', modified_at: at };
  }, 'checkout.update');
  // change returns the unchanged row on a skipped decision too; only our locked
  // decision winning authorizes effects, never the mere presence of that row.
  if (!claimed) return fail(403, 'CheckoutForbiddenError', 'The checkout is expired, the customer already has an active subscription, or the organization is not ready to accept payments.');
  if (!customer) {
    const cid = newId(ctx, CUSTOMER);
    await ctx.write(CUSTOMER, cid, { ...customerFields(ctx, { id: cid, created_at: ctx.occurredAt, modified_at: null, email, name: body.customer_name ?? c.customer_name ?? null, external_id: c.external_customer_id ?? null, email_verified: false, metadata: {} }), _environment: environment(ctx) }, 'customer.create');
    customer = rowOf(ctx, CUSTOMER, cid)!;
  }
  const customerId = String(customer.id);
  await ctx.write(CHECKOUT, String(c.id), { customer_id: customerId, customer_email: customer.email, modified_at: at }, 'checkout.update');
  // the subscription of a recurring product: its period from now, or its trial first
  let subscriptionId: string | null = null;
  if (product.recurring_interval) {
    subscriptionId = newId(ctx, SUBSCRIPTION);
    const trial = product.trial_interval != null;
    const end = addInterval(at, String(trial ? product.trial_interval : product.recurring_interval), Number(trial ? product.trial_interval_count ?? 1 : product.recurring_interval_count ?? 1));
    await ctx.write(SUBSCRIPTION, subscriptionId, { ...subscriptionFields(ctx, {
      id: subscriptionId, created_at: at, modified_at: null, amount: c.amount, currency: c.currency ?? 'usd', recurring_interval: product.recurring_interval,
      recurring_interval_count: product.recurring_interval_count ?? 1, status: 'incomplete', current_period_start: at, current_period_end: end,
      trial_start: trial ? at : null, trial_end: trial ? end : null, cancel_at_period_end: false, canceled_at: null, started_at: at, ends_at: null, ended_at: null,
      customer_id: customerId, product_id: product.id, checkout_id: c.id, prices: (c.prices as Record<string, Row[]>)[String(product.id)], metadata: c.metadata ?? {},
    }), _environment: environment(ctx) }, 'subscription.create');
    // source: spec:/components/schemas/SubscriptionStatus "trialing"
    ctx.legal('Subscription', 'status', 'subscription.activate', 'incomplete', trial ? 'trialing' : 'active', subscriptionId, 'vendor');
    await ctx.write(SUBSCRIPTION, subscriptionId, { status: trial ? 'trialing' : 'active', modified_at: at }, 'subscription.activate');
  }
  // source: https://polar.sh/docs/features/subscriptions/trials "they will not be charged immediately"
  if (!product.trial_interval) await makeOrder(ctx, { ...c, customer_id: customerId, subscription_id: subscriptionId }, subscriptionId ? 'subscription_create' : 'purchase');
  const session = await createSession(ctx, customer);
  const confirmed = { ...publicView(ctx, rowOf(ctx, CHECKOUT, String(c.id))!), customer_session_token: session.token };
  ctx.legal('Checkout', 'status', 'checkout.update', 'confirmed', 'succeeded', String(c.id), 'vendor');
  await ctx.write(CHECKOUT, String(c.id), { status: 'succeeded', subscription_id: subscriptionId, modified_at: at }, 'checkout.update');
  return Response.json(confirmed);
}
