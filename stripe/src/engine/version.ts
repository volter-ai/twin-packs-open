// STRIPE'S API VERSIONS — how an answer is rendered for the version a caller is served. Stripe keeps one
// account of an object and renders it per API version (docs.stripe.com/upgrades): a request pinning a version
// with `Stripe-Version` gets that version's shape, and one that pins none gets the account's. The twin keeps
// its objects in the shape its rules were written against (the 2024-06-20 one, with the request parameters
// those rules read), and renders them here: in the spec's version (the one this pack serves, surface.version)
// for a request that pins none or pins basil (2025-03-31) or later, and as kept for an earlier pin.
//
// Where the evidence stops: the changes below are the ones between the kept shape and the vendored spec that
// the pack's journeys reach, each from Stripe's changelog for basil (docs.stripe.com/changelog/basil); a version
// pinned between basil and the spec's is rendered in the spec's shape, not its own.
import surface from '../generated/surface.gen.json' with { type: 'json' };

type Row = Record<string, unknown>;

/** The version the pack serves: its vendored spec's. */
export const SERVED_VERSION = String(surface.version);
const BASIL = '2025-03-31';
const CLOVER = '2025-09-30';

/** Whether a request is answered in the served version's shape. */
export const servesCurrent = (pinned?: string | null): boolean => !pinned || pinned >= BASIL;

// What the twin keeps on an object for its rules that Stripe never answers: request parameters (a capture
// flag, the payment behavior a subscription was created with) and links it follows internally.
const KEPT: Record<string, string[]> = {
  account: ['livemode'],
  // source: spec:PostWebhookEndpoints "Whether this endpoint should receive events from connected accounts"
  // connect configures event delivery; it is not a WebhookEndpoint response field.
  webhook_endpoint: ['connect'],
  // a meter event is identified by its identifier; the twin's row id is its own
  'billing.meter_event': ['id'],
  // a card source's creation time is the twin's, for ordering
  card: ['created'],
  charge: ['capture', 'capture_before'],
  dispute: ['submit'],
  ephemeral_key: ['associated_objects'],
  'financial_connections.account': ['session'],
  'identity.verification_session': ['return_url'],
  invoice: ['days_until_due', 'pending_invoice_items_behavior'],
  'issuing.token': ['cardholder'],
  payment_intent: ['mandate', 'off_session'],
  subscription: ['payment_behavior'],
  subscription_item: ['livemode'],
  subscription_schedule: ['from_subscription', 'renewal_interval', 'proration_behavior'],
  'tax.transaction': ['calculation'],
  'terminal.reader': ['registration_code'],
  topup: ['destination_balance'],
  'treasury.outbound_payment': ['destination_payment_method_data'],
  'treasury.transaction_entry': ['amount'],
};

const omit = (o: Row, keys: string[]): Row => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));
const idOf = (v: unknown): string | null => (typeof v === 'string' ? v : v && typeof v === 'object' && typeof (v as Row).id === 'string' ? String((v as Row).id) : null);

/** A price (an id or an expanded object) as basil's pricing block names it. */
function pricing(price: unknown, amount: unknown, quantity: unknown): Row | null {
  const id = idOf(price);
  if (!id) return null;
  const product = price && typeof price === 'object' ? idOf((price as Row).product) : null;
  const unit = price && typeof price === 'object' && (price as Row).unit_amount !== undefined ? (price as Row).unit_amount : Number(amount) / (Number(quantity) || 1);
  return { type: 'price_details', price_details: { price: id, product: product ?? '' }, unit_amount_decimal: String(unit ?? 0) };
}

// basil (2025-03-31): what moved, per object
const BASIL_CHANGES: Record<string, (o: Row, parent?: Row) => Row> = {
  // an invoice's subscription is its parent; its payments are the invoice's payments list (docs.stripe.com/changelog/basil/2025-03-31/add-support-for-multiple-partial-payments-on-invoices)
  invoice: (o) => {
    const subscription = idOf(o.subscription);
    const parent = o.parent !== undefined ? o.parent : subscription ? { type: 'subscription_details', quote_details: null, subscription_details: { metadata: {}, subscription } } : null;
    // "confirmation_secret … Currently, this contains the client_secret of the PaymentIntent that Stripe creates during
    // invoice finalization" (docs.stripe.com/api/invoices/object; includable, answered only when expanded: INCLUDABLE);
    // the intent's client_secret is the one ./stripe.ts mintClientSecret gives it
    const confirmation_secret = o.confirmation_secret ?? null;
    return { ...omit(o, ['payment_intent', 'charge', 'paid', 'paid_out_of_band', 'subscription']), parent, confirmation_secret };
  },
  charge: (o) => omit(o, ['invoice', 'source']),
  payment_intent: (o) => omit(o, ['invoice']),
  // a subscription's billing period is its items' (docs.stripe.com/changelog/basil/2025-03-31/deprecate-subscription-current-period-start-and-end)
  subscription: (o) => {
    const period = { current_period_start: o.current_period_start, current_period_end: o.current_period_end };
    const items = o.items && typeof o.items === 'object' ? (o.items as Row) : undefined;
    const data = Array.isArray(items?.data) ? (items!.data as Row[]).map((it) => ({ ...it, current_period_start: it.current_period_start ?? period.current_period_start, current_period_end: it.current_period_end ?? period.current_period_end })) : undefined;
    return { ...omit(o, ['current_period_start', 'current_period_end']), ...(items && data ? { items: { ...items, data } } : {}) };
  },
  subscription_item: (o) => ({ ...omit(o, ['plan']), discounts: o.discounts ?? [] }),
  invoiceitem: (o) => ({ ...omit(o, ['price']), pricing: o.pricing ?? pricing(o.price, o.amount, o.quantity) }),
  // a line names what generated it (its parent) and its price and taxes in basil's blocks
  line_item: (o) => {
    const proration = o.proration === true;
    // a line an invoice item made names it; a subscription's line (invoice_item null) is its item's: "Details about the
    // subscription item that generated this line item" (docs.stripe.com/api/invoice-line-item/object, parent)
    const fromItem = o.type === 'invoiceitem' || (o.invoice_item !== undefined && o.invoice_item !== null && o.type !== 'subscription');
    const parent = o.parent !== undefined ? o.parent : fromItem
      ? { type: 'invoice_item_details', invoice_item_details: { invoice_item: idOf(o.invoice_item) ?? String(o.id).replace(/^il_/, ''), proration, proration_details: null, subscription: idOf(o.subscription) }, subscription_item_details: null }
      : { type: 'subscription_item_details', subscription_item_details: { subscription_item: idOf(o.subscription_item) ?? '', proration, proration_details: null, subscription: idOf(o.subscription), invoice_item: null }, invoice_item_details: null };
    const taxes = Array.isArray(o.tax_amounts) ? (o.tax_amounts as Row[]).map((t) => ({ amount: t.amount, tax_behavior: 'exclusive', taxability_reason: t.taxability_reason ?? 'standard_rated', taxable_amount: t.taxable_amount ?? null, type: 'tax_rate_details', tax_rate_details: { tax_rate: idOf(t.tax_rate) } })) : [];
    return {
      ...omit(o, ['price', 'invoice_item', 'proration', 'tax_amounts', 'tax_rates', 'type', 'subscription_item']),
      parent, pricing: o.pricing ?? pricing(o.price, o.amount, o.quantity), taxes,
      discountable: o.discountable ?? !proration, discounts: o.discounts ?? [], livemode: o.livemode ?? false, metadata: o.metadata ?? {},
      period: o.period ?? { start: 0, end: 0 }, subtotal: o.subtotal ?? o.amount,
    };
  },
  // a promotion code promotes a coupon (docs.stripe.com/api/promotion_codes/object)
  promotion_code: (o) => ({ ...omit(o, ['coupon']), promotion: o.promotion ?? { type: 'coupon', coupon: o.coupon ?? null } }),
};

// Stripe answers every field of an object, a nullable one it has no value for as null (the Product object's page,
// docs.stripe.com/api/products/object, lists `package_dimensions` as "(object, nullable)" and its example answers
// `"package_dimensions": null`): a nullable field of the served spec the twin never set is rendered null. The spec's
// top-level fields are read from the surface; a sub-object's nullable fields are listed below, each from its object's
// page, where a published example met one the twin left out.
const NULLABLE = new Map((surface.resources as Array<{ schema: string; fields: Array<{ name: string; nullable?: boolean }> }>).map((r) => [r.schema, r.fields.filter((f) => f.nullable).map((f) => f.name)]));
const NESTED_NULLABLE: Record<string, Record<string, string[]>> = {
  // docs.stripe.com/api/checkout/sessions/object?query=customer_details: business_name, individual_name "(string, nullable)"
  'checkout.session': { customer_details: ['business_name', 'individual_name'] },
  // docs.stripe.com/api/subscriptions/object: "billing_mode.flexible (object, nullable)", "automatic_tax.disabled_reason
  // (enum, nullable)", invoice_settings.account_tax_ids, .custom_fields, .description, .footer each nullable
  // (and cancellation_details.feedback_option, nullable in the served spec: "Customized feedback options that provide
  // deeper insight into why the subscription was canceled")
  subscription: { automatic_tax: ['disabled_reason'], billing_mode: ['flexible'], invoice_settings: ['account_tax_ids', 'custom_fields', 'description', 'footer'], cancellation_details: ['comment', 'feedback', 'feedback_option', 'reason'] },
  // docs.stripe.com/api/payment_methods/object: billing_details.tax_id, card.fingerprint, card.generated_from,
  // card.regulated_status each "(…, nullable)"
  // docs.stripe.com/api/invoices/object: automatic_tax.disabled_reason "(enum, nullable)", automatic_tax.provider
  // "(string, nullable)"
  invoice: { automatic_tax: ['disabled_reason', 'provider'] },
  // docs.stripe.com/api/customers/object: invoice_settings.custom_fields, .default_payment_method, .footer,
  // .rendering_options each nullable
  customer: { invoice_settings: ['custom_fields', 'default_payment_method', 'footer', 'rendering_options'] },
  // docs.stripe.com/api/accounts/object: a fresh account's business_profile answers each of these null
  account: { business_profile: ['annual_revenue', 'estimated_worker_count', 'mcc', 'minority_owned_business_designation', 'name', 'product_description', 'specified_commercial_transactions_act_url', 'support_address', 'support_email', 'support_phone', 'support_url', 'url'] },
  // docs.stripe.com/api/charges/object: billing_details.tax_id and each of these payment_method_details.card fields
  // "(…, nullable)"; extended_authorization, incremental_authorization, multicapture and overcapture are not nullable
  // in the served spec, so an unmodelled one is left out rather than answered null
  charge: {
    billing_details: ['tax_id'],
    'payment_method_details.card': ['amount_authorized', 'authorization_code', 'electronic_commerce_indicator', 'network_token', 'network_transaction_id', 'regulated_status', 'transaction_link_id'],
  },
  payment_method: { billing_details: ['tax_id'], card: ['fingerprint', 'generated_from', 'regulated_status'] },
  // the served spec's person_relationship: legal_guardian and authorizer, each "(boolean, nullable)"
  person: { relationship: ['legal_guardian', 'authorizer'] },
  // the served spec's source_owner: each field "(…, nullable)"; the sources create page's example answers them null
  source: { owner: ['address', 'email', 'name', 'phone', 'verified_address', 'verified_email', 'verified_name', 'verified_phone'] },
  // the served spec's address_api_resource_terminal: each line "(string, nullable)"; the location fixture answers line2 null
  'terminal.location': { address: ['city', 'country', 'line1', 'line2', 'postal_code', 'state'] },
  // the served spec's issuing_cardholder_individual (dob, verification, card_issuing), its address and its authorization
  // controls (allowed_card_presences, blocked_card_presences, spending_limits_currency): each "(…, nullable)"
  'issuing.cardholder': { 'billing.address': ['city', 'country', 'line1', 'line2', 'postal_code', 'state'], individual: ['dob', 'verification', 'card_issuing'], spending_controls: ['allowed_card_presences', 'blocked_card_presences', 'spending_limits_currency'] },
  // and a card's authorization controls (the served spec's issuing_card_authorization_controls), likewise nullable
  'issuing.card': { spending_controls: ['allowed_card_presences', 'blocked_card_presences', 'spending_limits_currency'] },
  // the served spec's issuing_dispute_fraudulent_evidence: additional_documentation and explanation, each nullable
  'issuing.dispute': { 'evidence.fraudulent': ['additional_documentation', 'explanation'] },
  // the served spec's issuing_personalization_design_carrier_text: its four texts, each nullable
  'issuing.personalization_design': { carrier_text: ['footer_body', 'footer_title', 'header_body', 'header_title'] },
  // the served spec's treasury_shared_resource_billing_details.address: each line "(string, nullable)"
  'treasury.received_credit': { 'initiating_payment_method_details.billing_details.address': ['city', 'country', 'line1', 'line2', 'postal_code', 'state'], linked_flows: ['credit_reversal', 'issuing_authorization', 'issuing_transaction', 'source_flow', 'source_flow_details', 'source_flow_type'] },
  // (and its linked flows: every one nullable in the served spec's treasury_received_debits_resource_linked_flows, and
  // likewise the credit's)
  'treasury.received_debit': { 'initiating_payment_method_details.billing_details.address': ['city', 'country', 'line1', 'line2', 'postal_code', 'state'], linked_flows: ['debit_reversal', 'inbound_transfer', 'issuing_authorization', 'issuing_transaction', 'payout', 'topup'] },
  'treasury.inbound_transfer': { 'origin_payment_method_details.billing_details.address': ['city', 'country', 'line1', 'line2', 'postal_code', 'state'] },
};

// A field the vendor fills with its default when the request set none, by object, each from its object's page.
const CARD_DISPLAY: Record<string, string> = { amex: 'american_express', diners: 'diners_club', eftpos_au: 'eftpos_australia', unionpay: 'union_pay' };
const DEFAULTS: Record<string, (o: Row) => Row> = {
  // docs.stripe.com/api/payment_methods/object: allow_redisplay "defaults to “unspecified”"; card.display_brand is "The
  // brand to use when displaying the card … Can be `american_express`, …, `visa`", the brand's display name
  payment_method: (o) => {
    const card = o.card && typeof o.card === 'object' ? (o.card as Row) : undefined;
    const brand = typeof card?.brand === 'string' ? card.brand : undefined;
    return {
      ...(o.allow_redisplay === undefined ? { allow_redisplay: 'unspecified' } : {}),
      ...(card && brand && card.display_brand === undefined ? { card: { ...card, display_brand: CARD_DISPLAY[brand] ?? (brand === 'unknown' ? 'other' : brand) } } : {}),
    };
  },
  // a line names "The ID of the invoice that contains this line item" (docs.stripe.com/api/invoice-line-item/object)
  invoice: (o) => {
    const lines = o.lines && typeof o.lines === 'object' ? (o.lines as Row) : undefined;
    if (!Array.isArray(lines?.data) || typeof o.id !== 'string') return {};
    return { lines: { ...lines, data: (lines!.data as Row[]).map((l) => (l && typeof l === 'object' && (l.invoice === undefined || l.invoice === null) ? { ...l, invoice: o.id } : l)) } };
  },
  // docs.stripe.com/api/invoiceitems/object: net_amount, "The amount after discounts, but before credits and taxes. This
  // field is `null` for `discountable=true` items" (the twin puts no discount on an item itself)
  invoiceitem: (o) => (o.net_amount === undefined ? { net_amount: o.discountable === false ? (typeof o.amount === 'number' ? o.amount : null) : null } : {}),
  // docs.stripe.com/api/payment_intents/object: confirmation_method `automatic` "(Default)"; amount_details as its
  // example answers it for a card payment, `{"tip": {}}`
  payment_intent: (o) => ({
    ...(o.confirmation_method === undefined ? { confirmation_method: 'automatic' } : {}),
    ...(o.amount_details === undefined ? { amount_details: { tip: {} } } : {}),
  }),
};
const fill = (o: Row, keys: string[]): Row => (keys.some((k) => !(k in o)) ? { ...o, ...Object.fromEntries(keys.filter((k) => !(k in o)).map((k) => [k, null])) } : o);
// every object whose served spec gives it a `metadata` it never answers null answers `{}` when none was set: "Set of
// key-value pairs that you can attach to an object" (docs.stripe.com/api/metadata), `metadata (map)` on each object's
// page, and its example `"metadata": {}` (the PaymentIntent object's, docs.stripe.com/api/payment_intents/object)
const METADATA = new Set((surface.resources as Array<{ schema: string; fields: Array<{ name: string; nullable?: boolean }> }>).filter((r) => r.fields.some((f) => f.name === 'metadata' && !f.nullable)).map((r) => r.schema));
const withNulls = (o: Row, kind: string): Row => {
  let out = fill(DEFAULTS[kind] ? { ...o, ...DEFAULTS[kind]!(o) } : o, NULLABLE.get(kind) ?? []);
  if (METADATA.has(kind) && (out.metadata === undefined || out.metadata === null)) out = { ...out, metadata: {} };
  // a dotted path reaches a sub-object's own sub-object (a charge's payment_method_details.card)
  const at = (o: Row, path: string[], keys: string[]): Row => {
    const [head, ...rest] = path;
    const sub = o[head!];
    if (!sub || typeof sub !== 'object' || Array.isArray(sub)) return o;
    return { ...o, [head!]: rest.length ? at(sub as Row, rest, keys) : fill(sub as Row, keys) };
  };
  for (const [path, keys] of Object.entries(NESTED_NULLABLE[kind] ?? {})) out = at(out, path.split('.'), keys);
  return out;
};

// A field Stripe includes only when the request expands it: the Checkout Session object's page
// (docs.stripe.com/api/checkout/sessions/object) marks `line_items` "includable (not returned by default; request it
// with the `expand` request parameter)". The twin keeps it on the object for its rules; the answer carries it only
// where the request's `expand[]` names it (`line_items`, or `data.line_items` on a list).
const INCLUDABLE: Record<string, string[]> = {
  'checkout.session': ['line_items'],
  // docs.stripe.com/api/charges/object: `refunds` "(object, nullable, includable (not returned by default; …))"
  charge: ['refunds'],
  // docs.stripe.com/api/payment-link/object: `line_items` "object Includable", and its example answers none
  payment_link: ['line_items'],
  // docs.stripe.com/api/quotes/object: `line_items` "object Includable", and its example answers none
  quote: ['line_items'],
  // docs.stripe.com/api/secret_management: `payload` "nullable string Includable": a secret's value is answered only
  // when the request expands it
  'apps.secret': ['payload'],
  // docs.stripe.com/api/tax/calculations/object and /tax/transactions/object: `line_items` "nullable object Includable"
  'tax.calculation': ['line_items'],
  'tax.transaction': ['line_items'],
  // docs.stripe.com/api/invoices/object: `confirmation_secret` "(object, nullable, includable (not returned by default;
  // request it with the `expand` request parameter))"
  invoice: ['confirmation_secret'],
};

/** The `expand[]` paths a request names, in its query or its body (JSON or form). */
export async function expandOf(request: Request): Promise<string[]> {
  const url = new URL(request.url);
  const out = [...url.searchParams.entries()].filter(([k]) => /^expand(\[\d*\])?$/.test(k)).map(([, v]) => v);
  if (request.method === 'GET' || request.method === 'HEAD') return out;
  const text = await request.text().catch(() => '');
  if (!text) return out;
  if ((request.headers.get('content-type') ?? '').includes('json') || text.trim().startsWith('{')) {
    try { const e = (JSON.parse(text) as { expand?: unknown }).expand; if (Array.isArray(e)) out.push(...e.map(String)); } catch { /* not JSON */ }
    return out;
  }
  for (const [k, v] of new URLSearchParams(text)) if (/^expand(\[\d*\])?$/.test(k)) out.push(v);
  return out;
}

/** An answer with every webhook endpoint's `secret` left out: Stripe answers it only when the endpoint is created. */
export function withoutEndpointSecret(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutEndpointSecret);
  if (!value || typeof value !== 'object') return value;
  const o = value as Row;
  const out = Object.fromEntries(Object.entries(o).filter(([k]) => !(k === 'secret' && o.object === 'webhook_endpoint')).map(([k, v]) => [k, withoutEndpointSecret(v)]));
  return out;
}

/** An answer (any JSON) rendered for the version a caller is served, with only the includable fields `expand` names. */
export function render(value: unknown, pinned?: string | null, expand: string[] = []): unknown {
  if (!servesCurrent(pinned)) return value;
  const expands = (at: string): boolean => expand.some((e) => e === at || e.startsWith(`${at}.`));
  const walk = (v: unknown, at = ''): unknown => {
    if (Array.isArray(v)) return v.map((x) => walk(x, at));
    if (!v || typeof v !== 'object') return v;
    const kindOf = typeof (v as Row).object === 'string' ? String((v as Row).object) : undefined;
    // `expand` is a request parameter, never a field of any object (the served spec gives none one); a handler that
    // keeps its parameters keeps it too, and the answer leaves it out
    const hidden: string[] = [...((kindOf ? INCLUDABLE[kindOf]?.filter((k) => !expands(at ? `${at}.${k}` : k)) : undefined) ?? []), ...(kindOf ? ['expand'] : [])];
    const o = Object.fromEntries(Object.entries(v as Row).filter(([k]) => !hidden.includes(k)).map(([k, x]) => [k, walk(x, at ? `${at}.${k}` : k)]));
    const kind = typeof o.object === 'string' ? o.object : undefined;
    // a deleted object answers only that it is gone
    if (!kind || o.deleted === true) return o;
    // metadata holds strings ("key-value pairs", each value up to 500 characters, docs.stripe.com/metadata); the form
    // reader coerces a numeric-looking value to a number, which the answer gives back as the string it was sent as
    // reads the same, and a key posted "" to remove it is not there (../semantics/shared.ts withMetadata)
    if (o.metadata && typeof o.metadata === 'object' && !Array.isArray(o.metadata)) o.metadata = Object.fromEntries(Object.entries(o.metadata as Row).filter(([, v]) => v !== '').map(([k, v]) => [k, typeof v === 'number' || typeof v === 'boolean' ? String(v) : v]));
    // source: spec:/components/schemas/checkout.session/properties/ui_mode "Defaults to `hosted_page`."
    // Endive names hosted/custom Checkout hosted_page/elements; older SDK versions keep their own names.
    if (kind === 'checkout.session' && (!pinned || pinned >= '2026-09-30')) {
      if (o.ui_mode === 'hosted') o.ui_mode = 'hosted_page';
      if (o.ui_mode === 'custom') o.ui_mode = 'elements';
    }
    const kept = KEPT[kind] ? omit(o, KEPT[kind]!) : o;
    // an includable field a version's change adds (an invoice's confirmation_secret) is hidden as its stored ones are
    // source: https://docs.stripe.com/changelog/clover/2025-09-30/polymorphic-coupon "Moves the top-level coupon field on Promotion Codes to promotion.coupon"
    const changed = kind === 'promotion_code' && pinned && pinned < CLOVER ? omit(kept, ['promotion']) : BASIL_CHANGES[kind] ? BASIL_CHANGES[kind]!(kept) : kept;
    return omit(withNulls(changed, kind), hidden);
  };
  return walk(value);
}
