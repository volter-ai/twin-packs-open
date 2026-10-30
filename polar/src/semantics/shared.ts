// What every family of Polar shares: the World's organization, ids, the objects as the spec's schemas require them
// (the SDK parses every answer and every webhook with them), a customer's meters, and Polar's answers.
import type { HandlerContext, WriteHookContext } from '@volter/world-core';

export type Row = Record<string, unknown>;
type Reader = Pick<HandlerContext, 'row' | 'rowsRaw' | 'crypto' | 'own' | 'call'> | Pick<WriteHookContext, 'row' | 'rowsRaw' | 'crypto' | 'own' | 'call'>;

/** A customer by its id or its external id. */
export function customerBy(ctx: Reader, key: { id?: unknown; external?: unknown }): Row | undefined {
  return key.id !== undefined ? rowsOf(ctx, CUSTOMER).find((c) => c.id === key.id) : rowsOf(ctx, CUSTOMER).find((c) => c.external_id === key.external);
}

export const ORGANIZATION = 'organization';
export const CUSTOMER = 'customer';
export const PRODUCT = 'product';
export const CHECKOUT = 'checkout';
export const SUBSCRIPTION = 'subscription';
export const ORDER = 'order';
export const EVENT = 'event';
export const METER = 'meter';
export const SESSION = 'customer_session';
export const ENDPOINT = 'webhook_endpoint';

/** Where Polar's hosted pages are: the checkout (`buy.polar.sh`) and the portal (`polar.sh`), rewritten to the twin. */
export const CHECKOUT_ORIGIN = 'https://buy.polar.sh';
export const PORTAL_ORIGIN = 'https://polar.sh';

// ── answers ────────────────────────────────────────────────────────────────────────────────────
// source: spec:/components/schemas/ResourceNotFound "ResourceNotFound"

/** Polar's error body: `{ error: <kind>, detail }`. */
export const fail = (status: number, error: string, detail: string): Response => Response.json({ error, detail }, { status });
export const notFound = (what: string): Response => fail(404, 'ResourceNotFound', `${what} not found.`);
/** FastAPI's 422, one error per field. */
// source: spec:/components/schemas/HTTPValidationError "HTTPValidationError"
export const invalid = (loc: Array<string | number>, msg: string, type = 'value_error'): Response =>
  Response.json({ detail: [{ type, loc: ['body', ...loc], msg, input: null }] }, { status: 422 });
export const missing = (field: string): Response => invalid([field], 'Field required', 'missing');

export const bodyOf = (ctx: HandlerContext): Row => (ctx.body && typeof ctx.body === 'object' && !Array.isArray(ctx.body) ? ctx.body as Row : {});

// ── ids and the organization ───────────────────────────────────────────────────────────────────

/** A new subject's id: a UUID the kernel mints from the tree (ctx.mint), under the resource the manifest declares for its
 *  stored type. */
const DECLARED: Record<string, string> = { product: 'Product', checkout: 'Checkout', subscription: 'Subscription', order: 'Order', webhook_endpoint: 'WebhookEndpoint' };
export const newId = (ctx: Pick<HandlerContext, 'mint'>, type: string): string => ctx.mint(DECLARED[type] ?? type);

/** A secret of Polar's form (`polar_cst_…`, `polar_c_…`, `polar_whs_…`, `polar_oat_…`): its prefix and 43 letters and
 *  digits drawn from a secret the World holds for the seed (ctx.secret), so none is computed from the ids it names. */
export async function secret(ctx: Pick<HandlerContext, 'secret'>, prefix: string, seed: string): Promise<string> {
  const a = await ctx.secret(`polar-secret:${seed}`);
  const b = await ctx.secret(`polar-secret:${seed}:2`);
  return `${prefix}${`${a}${b}`.replace(/[^A-Za-z0-9]/g, '').slice(0, 43)}`;
}

/** The World's one organization: the one its token names. */
export const ORG_ID = '1dbfc517-0bbf-4301-9ba8-555ca42b9737';
export const orgId = (ctx: Pick<HandlerContext, 'call'>): string => environment(ctx) === 'sandbox' ? '2dbfc517-0bbf-4301-9ba8-555ca42b9737' : ORG_ID;
export const organizationView = (ctx: Reader): Row => {
  const o = rowOf(ctx, ORGANIZATION, 'org') ?? {};
  return {
    created_at: o.created_at ?? '2026-01-01T00:00:00Z', modified_at: null, id: orgId(ctx), name: o.name ?? 'Twin organization', slug: o.slug ?? 'twin',
    avatar_url: null, proration_behavior: 'prorate', allow_customer_updates: true, email: null, website: null, socials: [], status: 'active',
    details_submitted_at: null, onboarding_resubmission_requested_at: null, sso_enforced: false, default_presentment_currency: 'usd',
    default_tax_behavior: 'location', feature_settings: {}, subscription_settings: { allow_multiple_subscriptions: false, allow_customer_updates: true, proration_behavior: 'prorate', benefit_revocation_grace_period: 0, prevent_trial_abuse: false },
    customer_email_settings: {}, customer_portal_settings: {}, dispute_settings: {}, embed_hosts: [], embed_hosts_enforced: false, account_id: null, payout_account_id: null, capabilities: {},
  };
};

// ── views: each object with every field its schema requires ───────────────────────────────────

/** Whether a row's field is among the values a list's query names (one value or several), or the query names none. */
export const among = (ctx: Pick<HandlerContext, 'params'>, key: string, value: unknown): boolean =>
  ctx.params[key] === undefined || ([] as unknown[]).concat(ctx.params[key]).map(String).includes(String(value));
/** Newest first by a timestamp field. */
export const newest = (field: string) => (a: Row, b: Row): number => String(b[field]).localeCompare(String(a[field]));

/** Stored rows without the kernel's bookkeeping. */
export const environment = (ctx: Pick<HandlerContext, 'call'>): string => new URL(ctx.call.request.url).hostname.startsWith('sandbox') ? 'sandbox' : 'production';
export const rowsOf = (ctx: Reader, type: string): Row[] => ctx.rowsRaw(type).filter((r) => r.deleted !== true && (r._environment ?? (r.organization_id === '2dbfc517-0bbf-4301-9ba8-555ca42b9737' ? 'sandbox' : 'production')) === environment(ctx));
export const rowOf = (ctx: Reader, type: string, id: string): Row | undefined => rowsOf(ctx, type).find((r) => r.id === id);
/** The stored vendor shape; bookkeeping is private, including the environment boundary. */
export const vendorFields = (ctx: Pick<HandlerContext, 'own'>, row: Row): Row => Object.fromEntries(Object.entries(ctx.own(row)).filter(([k]) => !k.startsWith('_')));
export const customerView = (ctx: Reader, c: Row): Row => vendorFields(ctx, c);
export const productView = (ctx: Reader, p: Row): Row => vendorFields(ctx, p);
export const subscriptionView = (ctx: Reader, s: Row): Row => vendorFields(ctx, s);
export const orderView = (ctx: Reader, o: Row): Row => vendorFields(ctx, o);
export const eventView = (ctx: Reader, e: Row): Row => vendorFields(ctx, e);
export const checkoutView = (ctx: Reader, c: Row): Row => vendorFields(ctx, c);


// source: spec:/components/schemas/CustomerIndividual "CustomerIndividual"
export function customerFields(ctx: Reader, c: Row): Row {
  return {
    id: c.id, created_at: c.created_at, modified_at: c.modified_at ?? null, metadata: c.metadata ?? {}, external_id: c.external_id ?? null,
    email: c.email, email_verified: c.email_verified ?? false, type: 'individual', name: c.name ?? null, billing_name: c.billing_name ?? null,
    billing_address: c.billing_address ?? null, tax_id: c.tax_id ?? null, locale: c.locale ?? null, organization_id: orgId(ctx),
    default_payment_method_id: null, deleted_at: c.deleted_at ?? null, first_user_event_at: c.first_user_event_at ?? null,
    avatar_url: `https://www.gravatar.com/avatar/${String(c.email ?? '')}?d=404`,
  };
}

/** A price as the schema of its amount type requires (ProductPriceFixed, ProductPriceFree, ProductPriceCustom,
 *  ProductPriceMeteredUnit). */
// source: spec:/components/schemas/ProductPriceFixed "ProductPriceFixed"
export function priceView(ctx: Reader, p: Row, product: Row): Row {
  const base = {
    created_at: product.created_at, modified_at: null, id: p.id, source: p.source ?? 'catalog', amount_type: p.amount_type, price_currency: p.price_currency ?? 'usd',
    tax_behavior: null, is_archived: p.is_archived ?? false, product_id: product.id,
  };
  if (p.amount_type === 'fixed') return { ...base, price_amount: p.price_amount };
  if (p.amount_type === 'custom') return { ...base, minimum_amount: p.minimum_amount ?? null, maximum_amount: p.maximum_amount ?? null, preset_amount: p.preset_amount ?? null };
  if (p.amount_type !== 'metered_unit') return base;
  const meter = rowOf(ctx, METER, String(p.meter_id));
  // source: spec:/components/schemas/ProductPriceMeter "A meter associated to a metered price."
  // source: spec:/components/schemas/MeterCreate/properties/unit "scalar"
  return { ...base, unit_amount: String(p.unit_amount ?? '0'), cap_amount: p.cap_amount ?? null, meter_id: p.meter_id,
    meter: { id: p.meter_id, name: meter?.name ?? '', unit: meter?.unit ?? 'scalar', custom_label: meter?.custom_label ?? null, custom_multiplier: meter?.custom_multiplier ?? null } };
}

// source: spec:/components/schemas/Product "Product"
export function productFields(ctx: Reader, p: Row): Row {
  return {
    id: p.id, created_at: p.created_at, modified_at: p.modified_at ?? null, trial_interval: p.trial_interval ?? null, trial_interval_count: p.trial_interval_count ?? null,
    name: p.name, description: p.description ?? null, visibility: p.visibility ?? 'public', recurring_interval: p.recurring_interval ?? null,
    recurring_interval_count: p.recurring_interval ? Number(p.recurring_interval_count ?? 1) : null, meter_interval: null, meter_interval_count: null,
    is_recurring: p.recurring_interval != null, is_archived: p.is_archived ?? false, organization_id: orgId(ctx), metadata: p.metadata ?? {},
    prices: p.prices ?? [],
    benefits: [],
    medias: [], attached_custom_fields: [],
  };
}

// source: spec:/components/schemas/Subscription "Subscription"
export function subscriptionFields(ctx: Reader, s: Row): Row {
  const customer = rowOf(ctx, CUSTOMER, String(s.customer_id));
  const product = rowOf(ctx, PRODUCT, String(s.product_id));
  return {
    created_at: s.created_at, modified_at: s.modified_at ?? null, id: s.id, amount: s.amount ?? 0, currency: s.currency ?? 'usd',
    recurring_interval: s.recurring_interval, recurring_interval_count: Number(s.recurring_interval_count ?? 1), status: s.status,
    current_period_start: s.current_period_start, current_period_end: s.current_period_end ?? null, current_meter_period_start: null, current_meter_period_end: null,
    trial_start: s.trial_start ?? null, trial_end: s.trial_end ?? null, cancel_at_period_end: s.cancel_at_period_end ?? false, canceled_at: s.canceled_at ?? null,
    started_at: s.started_at ?? null, ends_at: s.ends_at ?? null, ended_at: s.ended_at ?? null, pause_at_period_end: false, paused_at: null, resumes_at: null,
    customer_id: s.customer_id, product_id: s.product_id, discount_id: s.discount_id ?? null, checkout_id: s.checkout_id ?? null,
    customer_cancellation_reason: s.customer_cancellation_reason ?? null, customer_cancellation_comment: s.customer_cancellation_comment ?? null,
    metadata: s.metadata ?? {}, custom_field_data: {},
    customer: customer ? customerView(ctx, customer) : null, product: product ? productView(ctx, product) : null, discount: null,
    prices: s.prices ?? product?.prices ?? [], meters: s.meters ?? [], pending_update: null,
  };
}

// source: spec:/components/schemas/Order "Order"
export function orderFields(ctx: Reader, o: Row): Row {
  const customer = rowOf(ctx, CUSTOMER, String(o.customer_id));
  const product = o.product_id ? rowOf(ctx, PRODUCT, String(o.product_id)) : undefined;
  const sub = o.subscription_id ? rowOf(ctx, SUBSCRIPTION, String(o.subscription_id)) : undefined;
  const total = Number(o.total_amount ?? 0);
  const refunded = Number(o.refunded_amount ?? 0);
  return {
    id: o.id, created_at: o.created_at, modified_at: o.modified_at ?? null, status: o.status, paid: ['paid', 'refunded', 'partially_refunded'].includes(String(o.status)),
    subtotal_amount: total, discount_amount: 0, net_amount: total, tax_amount: 0, total_amount: total, applied_balance_amount: 0, due_amount: 0,
    refunded_amount: refunded, refunded_tax_amount: 0, currency: o.currency ?? 'usd', billing_reason: o.billing_reason, billing_name: null, billing_address: null,
    invoice_number: `TWIN-${String(o.number ?? 1).padStart(4, '0')}`, is_invoice_generated: false, receipt_number: null,
    customer_id: o.customer_id, product_id: o.product_id ?? null, discount_id: null, subscription_id: o.subscription_id ?? null, checkout_id: o.checkout_id ?? null,
    metadata: o.metadata ?? {}, custom_field_data: {}, platform_fee_amount: 0, platform_fee_currency: null,
    customer: customer ? customerView(ctx, customer) : null,
    product: product ? (({ prices: _p, benefits: _b, medias: _m, attached_custom_fields: _a, ...rest }) => rest)(productView(ctx, product)) : null,
    discount: null, subscription: sub ? (({ customer: _c, product: _pr, discount: _d, prices: _ps, meters: _ms, pending_update: _u, ...rest }) => rest)(subscriptionView(ctx, sub)) : null,
    items: o.items ?? [],
    description: product?.name ?? 'Order', refundable_amount: total - refunded, refundable_tax_amount: 0,
  };
}

/** A usage event as the API answers it (UserEvent): with its customer. */
// source: spec:/components/schemas/UserEvent "An event you created through the ingestion API."
// Where the documentation stops: a user event's `label` (its type's "human readable label"); the twin gives its name
export function eventFields(ctx: Reader, e: Row): Row {
  const customer = e.customer_id ? rowOf(ctx, CUSTOMER, String(e.customer_id)) : undefined;
  return {
    id: e.id, timestamp: e.timestamp, organization_id: orgId(ctx), customer_id: e.customer_id ?? null, customer: customer && customer.deleted !== true ? customerView(ctx, customer) : null,
    external_customer_id: e.external_customer_id ?? null, member_id: null, external_member_id: null, child_count: 0, parent_id: null,
    label: e.name, name: e.name, source: 'user', metadata: e.metadata ?? {},
  };
}

// source: spec:/components/schemas/Checkout "Checkout"
export function checkoutFields(ctx: Reader, c: Row): Row {
  const product = rowOf(ctx, PRODUCT, String(c.product_id));
  const pv = product ? productView(ctx, product) : null;
  const prices = (c.prices as Record<string, Row[]> | undefined)?.[String(c.product_id)] ?? (pv?.prices as Row[] | undefined) ?? [];
  const price = prices.find((p) => p.id === c.product_price_id) ?? prices[0] ?? null;
  const amount = Number(c.amount ?? 0);
  return {
    id: c.id, created_at: c.created_at, modified_at: c.modified_at ?? null, payment_processor: 'stripe', status: c.status, client_secret: c.client_secret,
    url: `${CHECKOUT_ORIGIN}/${String(c.client_secret)}`, expires_at: c.expires_at, success_url: c.success_url ?? `${CHECKOUT_ORIGIN}/${String(c.client_secret)}/confirmation`,
    return_url: c.return_url ?? null, embed_origin: c.embed_origin ?? null, amount, discount_amount: 0, net_amount: amount, tax_amount: null, tax_behavior: null,
    total_amount: amount, currency: c.currency ?? 'usd', allow_trial: c.allow_trial ?? null, active_trial_interval: product?.trial_interval ?? null, active_trial_interval_count: product?.trial_interval_count ?? null,
    trial_end: null, organization_id: orgId(ctx), product_id: c.product_id, product_price_id: price?.id ?? null, discount_id: null, allow_discount_codes: c.allow_discount_codes ?? true,
    require_billing_address: c.require_billing_address ?? false, is_discount_applicable: false, is_free_product_price: amount === 0, is_payment_required: amount > 0,
    is_payment_setup_required: pv?.is_recurring === true, is_payment_form_required: amount > 0, customer_id: c.customer_id ?? null, is_business_customer: c.is_business_customer ?? false,
    customer_name: c.customer_name ?? null, customer_email: c.customer_email ?? null, customer_ip_address: c.customer_ip_address ?? null, customer_billing_name: null,
    customer_billing_address: null, customer_tax_id: null, payment_method_type: null, payment_processor_metadata: {},
    billing_address_fields: { country: 'required', state: 'disabled', city: 'disabled', postal_code: 'disabled', line1: 'disabled', line2: 'disabled' },
    trial_interval: null, trial_interval_count: null, metadata: c.metadata ?? {}, external_customer_id: c.external_customer_id ?? null, custom_field_data: {},
    products: pv ? [pv] : [], product: pv, product_price: price, prices: pv ? { [String(pv.id)]: prices } : {}, discount: null,
    subscription_id: c.subscription_id ?? null, attached_custom_fields: [], customer_metadata: c.customer_metadata ?? {},
  };
}

// ── a customer's meters ────────────────────────────────────────────────────────────────────────

/** Whether a meter's filter admits an event: clauses on `name`, `source` or a metadata key, joined by the filter's
 *  conjunction, nested filters among them. */
// source: spec:/components/schemas/Filter "Filter"
export function admits(filter: Row | undefined, e: Row): boolean {
  const clauses = (filter?.clauses as Row[] | undefined) ?? [];
  if (clauses.length === 0) return true;
  const one = (c: Row): boolean => {
    if ('clauses' in c) return admits(c, e);
    const prop = String(c.property ?? '');
    const actual = prop === 'name' || prop === 'source' ? e[prop] : ((e.metadata as Row | undefined) ?? {})[prop.replace(/^metadata\./, '')];
    const want = c.value;
    // every other operator is answered as the gap before a meter is made (the manifest's variants)
    return String(actual) === String(want);
  };
  return String(filter?.conjunction ?? 'and') === 'or' ? clauses.some(one) : clauses.every(one);
}

/** A meter's aggregation over the events it admits: a count, or the sum, max, min or average of a metadata property. */
// source: spec:/components/schemas/PropertyAggregation "PropertyAggregation"
export function aggregate(agg: Row | undefined, events: Row[]): number {
  const func = String(agg?.func ?? 'count');
  if (func === 'count') return events.length;
  const prop = String(agg?.property ?? '').replace(/^metadata\./, '');
  // source: https://polar.sh/docs/features/usage-based-billing/meters "Counts the number of unique values of a property."
  if (func === 'unique') return new Set(events.map((e) => ((e.metadata as Row | undefined) ?? {})[prop])).size;
  const values = events.map((e) => Number(((e.metadata as Row | undefined) ?? {})[prop])).filter(Number.isFinite);
  if (values.length === 0) return 0;
  if (func === 'max') return Math.max(...values);
  if (func === 'min') return Math.min(...values);
  const sum = values.reduce((a, b) => a + b, 0);
  return func === 'avg' ? sum / values.length : sum;
}

/** A customer's meter: consumed (the fold over its events), credited (its meter-credit grants), and the balance. */
// source: spec:/components/schemas/CustomerStateMeter "The balance of the meter, i.e. the difference between credited and consumed units."
export function customerMeter(ctx: Reader, customerId: string, meter: Row): { consumed: number; credited: number; balance: number } {
  const events = rowsOf(ctx, EVENT).filter((e) => e.customer_id === customerId && admits(meter.filter as Row | undefined, e));
  const consumed = aggregate(meter.aggregation as Row | undefined, events);
  const credited = 0; // No demanded product grants meter credits; benefits are outside the served surface.
  return { consumed, credited, balance: credited - consumed };
}

/** A customer's state: its active subscriptions, granted benefits and meters. */
// source: spec:customers:get_state "The customer state includes information about the customer's active subscriptions and benefits."
export async function customerState(ctx: HandlerContext, c: Row): Promise<Row> {
  const id = String(c.id);
  for (const meter of rowsOf(ctx, METER)) {
    if (!rowsOf(ctx, '_customer_meter').some((r) => r.customer_id === id && r.meter_id === meter.id)) {
      const meterId = ctx.mint('_customer_meter');
      await ctx.record('_customer_meter', { id: meterId, customer_id: id, meter_id: meter.id, _environment: environment(ctx) }, meterId);
    }
  }
  const subs = rowsOf(ctx, SUBSCRIPTION).filter((s) => s.customer_id === id && (s.status === 'active' || s.status === 'trialing'));
  return {
    ...customerView(ctx, c),
    active_subscriptions: subs.map((s) => {
      const v = subscriptionView(ctx, s);
      return { id: v.id, created_at: v.created_at, modified_at: v.modified_at, metadata: v.metadata, status: v.status, amount: v.amount, currency: v.currency, recurring_interval: v.recurring_interval, current_period_start: v.current_period_start, current_period_end: v.current_period_end, trial_start: v.trial_start, trial_end: v.trial_end, cancel_at_period_end: v.cancel_at_period_end, canceled_at: v.canceled_at, started_at: v.started_at, ends_at: v.ends_at, product_id: v.product_id, discount_id: v.discount_id, meters: [], custom_field_data: {} };
    }),
    granted_benefits: [],
    active_meters: rowsOf(ctx, METER).map((m) => {
      const { consumed, credited, balance } = customerMeter(ctx, id, m);
      return { id: rowsOf(ctx, '_customer_meter').find((r) => r.customer_id === id && r.meter_id === m.id)!.id, created_at: m.created_at, modified_at: null, meter_id: m.id, consumed_units: consumed, credited_units: credited, balance };
    }),
  };
}


// source: https://polar.sh/docs/features/subscriptions/introduction "creates a new order"
export async function makeOrder(ctx: HandlerContext, source: Row, reason: string, period?: { start: string; end: string }): Promise<void> {
  const id = newId(ctx, ORDER);
  const number = Number(ctx.mint('_seq_order'));
  await ctx.record('_seq_order', {}, String(number));
  const product = rowOf(ctx, PRODUCT, String(source.product_id))!;
  const prices = (source.prices && !Array.isArray(source.prices) ? (source.prices as Record<string, Row[]>)[String(product.id)] : source.prices) as Row[] | undefined;
  const items: Row[] = [];
  for (const price of prices ?? product.prices as Row[]) {
    let amount = price.amount_type === 'fixed' ? Number(price.price_amount) : price.amount_type === 'custom' ? Number(source.amount ?? 0) : 0;
    // source: spec:/components/schemas/ProductPriceMeteredUnit/properties/unit_amount "The price per unit in cents."
    // source: https://polar.sh/docs/features/usage-based-billing/event-ingestion "Polar never issues retroactive invoices or credits for late events."
    if (price.amount_type === 'metered_unit' && period) {
      const meter = rowOf(ctx, METER, String(price.meter_id))!;
      const events = rowsOf(ctx, EVENT).filter((e) => e.customer_id === source.customer_id && String(e._received_at ?? e.timestamp) >= period.start && String(e._received_at ?? e.timestamp) < period.end && admits(meter.filter as Row, e));
      amount = Math.ceil(aggregate(meter.aggregation as Row, events) * Number(price.unit_amount));
      if (price.cap_amount != null) amount = Math.min(amount, Number(price.cap_amount));
    }
    const itemId = ctx.mint('_order_item');
    await ctx.record('_order_item', {}, itemId);
    items.push({ id: itemId, created_at: ctx.occurredAt, modified_at: null, label: product.name, amount, tax_amount: 0, proration: false, product_price_id: price.id });
  }
  const total = items.reduce((n, item) => n + Number(item.amount), 0);
  const fields = orderFields(ctx, {
    id, created_at: ctx.occurredAt, modified_at: null, status: 'pending', total_amount: total, currency: source.currency ?? 'usd', refunded_amount: 0,
    billing_reason: reason, customer_id: source.customer_id, product_id: source.product_id, subscription_id: source.subscription_id ?? null,
    checkout_id: source.checkout_id ?? source.id, metadata: source.metadata ?? {}, number, items,
  });
  await ctx.write(ORDER, id, { ...fields, _environment: environment(ctx) }, 'order.create');
  ctx.legal('Order', 'status', 'order.pay', 'pending', 'paid', id, 'vendor');
  await ctx.write(ORDER, id, { status: 'paid', paid: true, modified_at: ctx.occurredAt }, 'order.pay');
}

// source: https://polar.sh/docs/features/subscriptions/introduction "Daily, weekly, monthly or yearly."
export function addInterval(at: string, interval: string, count: number): string {
  const d = new Date(at);
  if (interval === 'day' || interval === 'week') d.setUTCDate(d.getUTCDate() + count * (interval === 'week' ? 7 : 1));
  else {
    const day = d.getUTCDate();
    d.setUTCDate(1);
    if (interval === 'year') d.setUTCFullYear(d.getUTCFullYear() + count);
    else d.setUTCMonth(d.getUTCMonth() + count);
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(day, last));
  }
  return d.toISOString();
}

// source: https://polar.sh/docs/features/usage-based-billing/meters "Operators are the operators that you want to use to filter the events."

// source: spec:/components/schemas/CustomerSession "CustomerSession"
export async function createSession(ctx: HandlerContext, customer: Row, returnUrl: unknown = null): Promise<Row> {
  const id = newId(ctx, SESSION);
  const token = await secret(ctx, 'polar_cst_', `session:${id}`);
  const fields = { id, created_at: ctx.occurredAt, modified_at: null, token, expires_at: new Date(Date.parse(ctx.occurredAt) + 3_600_000).toISOString(), return_url: returnUrl,
    customer_portal_url: `${PORTAL_ORIGIN}/${String(organizationView(ctx).slug)}/portal?customer_session_token=${token}`, customer_id: customer.id, customer: customerView(ctx, customer) };
  await ctx.write(SESSION, id, { ...fields, _environment: environment(ctx) }, 'customer_session.create');
  return fields;
}
