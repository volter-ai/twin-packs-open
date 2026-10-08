import { digest } from '@volter/world-core';
import { ownFields, type TwinResource } from '@volter/world-core';
import { SERVED_VERSION } from './version.ts';

export type StripeResponse = { status: number; body: unknown };

/** Stripe's error body: an invalid_request_error with the message, and the code when there is one. */
export function err(message: string, status = 404, code?: string): StripeResponse {
  return { status, body: { error: { type: 'invalid_request_error', message, ...(code ? { code } : {}) } } };
}

// The Stripe API version a request that pins none is served in: the vendored spec's (./version.ts renders
// every answer in it). A request may override it via the `Stripe-Version` header (apiVersion);
// the value is echoed onto every event the request produces, exactly like real Stripe,
// whose stored Event.api_version reflects the version in force when the event was created.
export const TWIN_API_VERSION = SERVED_VERSION;
// Stripe API versions are dates (YYYY-MM-DD) optionally suffixed with a release channel
// (e.g. 2024-06-20.acacia). A malformed Stripe-Version is rejected with a 400, like Stripe.
const API_VERSION_RE = /^\d{4}-\d{2}-\d{2}(\.[a-z_]+)?$/;
export function isValidApiVersion(v: string): boolean {
  return API_VERSION_RE.test(v);
}

// Fidelity: real Stripe rejects a charge/payment_intent missing or with a non-positive
// amount, or missing currency, before any state change.
export function validateMoney(params: Record<string, unknown>): StripeResponse | null {
  const amount = params.amount;
  if (amount === undefined) return err('Missing required param: amount.', 400, 'parameter_missing');
  if (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0) return err('Invalid integer: amount must be a positive integer.', 400, 'parameter_invalid_integer');
  if (params.currency === undefined || params.currency === '') return err('Missing required param: currency.', 400, 'parameter_missing');
  return null;
}

// ---- TEST-CARD DECLINE MODEL (vendor-faithful) ----
// Real Stripe resolves the card behind a charge/PaymentIntent confirm and, for its
// documented test cards, produces a deterministic outcome: success or a typed
// card_error (HTTP 402). The twin reproduces that so the unmodified `stripe` SDK gets
// vendor-faithful decline behavior. The card is resolved from the raw PAN (card[number]
// / source) OR from Stripe's well-known test payment-method tokens (pm_card_visa,
// tok_visa, pm_card_chargeDeclined, …). UNKNOWN cards/tokens always succeed — this
// keeps every existing success-path test green (they pass no card, or a non-test one).
//
// A DeclineOutcome carries the real Stripe card-error fields. `code` is the top-level
// card-error code; `decline_code` is only present for `card_declined` (the issuer's
// reason). HTTP status is always 402 for card errors.
type DeclineOutcome = { code: string; decline_code?: string; message: string };

// Raw test-PAN → outcome (null = success). Mirrors Stripe's documented test cards.
const TEST_CARD_DECLINES: Record<string, DeclineOutcome | null> = {
  '4242424242424242': null, // Visa — always succeeds
  '4000000000000002': { code: 'card_declined', decline_code: 'generic_decline', message: 'Your card was declined.' },
  '4000000000009995': { code: 'card_declined', decline_code: 'insufficient_funds', message: 'Your card has insufficient funds.' },
  '4000000000000069': { code: 'expired_card', message: 'Your card has expired.' },
  '4000000000000127': { code: 'incorrect_cvc', message: "Your card's security code is incorrect." },
  '4000000000000119': { code: 'processing_error', message: 'An error occurred while processing your card. Try again in a little bit.' },
  // attaching it to a customer succeeds; charging it is declined (docs.stripe.com/testing#declined-payments)
  '4000000000000341': { code: 'card_declined', decline_code: 'generic_decline', message: 'Your card was declined.' },
};

// Stripe's well-known test payment-method / source tokens → outcome (null = success).
// These map to the same outcomes as the PANs above (pm_card_visa ≡ 4242…, etc.).
export const TEST_TOKEN_DECLINES: Record<string, DeclineOutcome | null> = {
  pm_card_visa: null,
  tok_visa: null,
  pm_card_mastercard: null,
  tok_mastercard: null,
  pm_card_amex: null,
  tok_amex: null,
  pm_card_discover: null,
  tok_discover: null,
  pm_card_chargeDeclined: TEST_CARD_DECLINES['4000000000000002']!,
  tok_chargeDeclined: TEST_CARD_DECLINES['4000000000000002']!,
  pm_card_chargeDeclinedInsufficientFunds: TEST_CARD_DECLINES['4000000000009995']!,
  tok_chargeDeclinedInsufficientFunds: TEST_CARD_DECLINES['4000000000009995']!,
  // the Visa-branded names docs.stripe.com/testing#declined-payments lists for the same two cards
  pm_card_visa_chargeDeclined: TEST_CARD_DECLINES['4000000000000002']!,
  tok_visa_chargeDeclined: TEST_CARD_DECLINES['4000000000000002']!,
  pm_card_visa_chargeDeclinedInsufficientFunds: TEST_CARD_DECLINES['4000000000009995']!,
  tok_visa_chargeDeclinedInsufficientFunds: TEST_CARD_DECLINES['4000000000009995']!,
  pm_card_chargeDeclinedExpiredCard: TEST_CARD_DECLINES['4000000000000069']!,
  tok_chargeDeclinedExpiredCard: TEST_CARD_DECLINES['4000000000000069']!,
  pm_card_chargeDeclinedIncorrectCvc: TEST_CARD_DECLINES['4000000000000127']!,
  tok_chargeDeclinedIncorrectCvc: TEST_CARD_DECLINES['4000000000000127']!,
  pm_card_chargeDeclinedProcessingError: TEST_CARD_DECLINES['4000000000000119']!,
  tok_chargeDeclinedProcessingError: TEST_CARD_DECLINES['4000000000000119']!,
  pm_card_chargeCustomerFail: TEST_CARD_DECLINES['4000000000000341']!,
  tok_chargeCustomerFail: TEST_CARD_DECLINES['4000000000000341']!,
};

// Pull a card identifier out of whatever the caller attached, in Stripe's accepted
// shapes: a raw PAN under card[number] / source[number], or a token/pm id under
// payment_method / source / card (string). Returns either a normalized PAN (digits
// only) or a token string, or undefined when nothing card-shaped is present.
function resolveCardRef(params: Record<string, unknown>): string | undefined {
  const fromObj = (o: unknown): string | undefined => {
    // the form reader (the kernel's readParams) coerces an all-digit card[number] to a JS number, so accept both.
    const n = o && typeof o === 'object' ? (o as Record<string, unknown>).number : undefined;
    if (typeof n === 'string' || typeof n === 'number') return String(n).replace(/\D/g, '');
    return undefined;
  };
  const pan = fromObj(params.card) ?? fromObj(params.source);
  if (pan) return pan;
  // a payment method or token by name, or payment_method_data[card][number] (a raw PAN in the modern nested shape)
  const named = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : v && typeof v === 'object' ? fromObj((v as Record<string, unknown>).card) : undefined);
  return ['payment_method', 'source', 'card', 'payment_method_data'].map((key) => named(params[key])).find((ref) => ref !== undefined);
}

// Resolve the decline outcome for an attached card, considering both the confirm-time
// params AND the params the PaymentIntent/charge was created with (Stripe accepts the
// payment_method at either step). null = explicit success; undefined = no known test
// card (→ default success, keeps existing tests green); object = decline.
//
// `find` additionally lets a ref that isn't a raw PAN or named token —
// i.e. a real attached PaymentMethod id like `pm_twin_3` — resolve against the decline
// outcome captured on that PaymentMethod at creation time (see `_declineOutcome` in the
// POST /v1/payment_methods handler). Without this, a card created from a declining test
// PAN would only ever decline on the SAME request that created it — any later charge
// that references it purely by id (the normal shape for a saved-card/off-session charge,
// e.g. an invoice retry) could never reproduce the decline.
/** A stored subject by stored type and id, in the pack's view (tombstones included): how the
 *  semantics hand these helpers the tree they read (./common.ts `finder`). */
export type FindStored = (storedType: string, id: string) => Record<string, unknown> | undefined;

export function declineFor(find: FindStored, ...paramSets: Array<Record<string, unknown>>): DeclineOutcome | null | undefined {
  for (const params of paramSets) {
    const ref = resolveCardRef(params);
    if (ref === undefined) continue;
    if (ref in TEST_CARD_DECLINES) return TEST_CARD_DECLINES[ref];
    if (ref in TEST_TOKEN_DECLINES) return TEST_TOKEN_DECLINES[ref];
    const pm = find('payment_method', ref);
    if (pm && Object.prototype.hasOwnProperty.call(pm, '_declineOutcome')) {
      return pm._declineOutcome as DeclineOutcome | null;
    }
  }
  return undefined;
}

// Stripe's well-known 3DS / SCA test instruments: confirming with one of these does NOT
// immediately succeed — it returns the PaymentIntent in `requires_action` with a
// `next_action` of type use_stripe_sdk (the client must run the 3DS challenge), exactly
// like a card that requires authentication. A SECOND confirm (after the simulated
// challenge) completes it. Covers both the PM tokens and the raw 3DS test PANs.
const THREE_DS_PANS = new Set(['4000002500003155', '4000002760003184', '4000003800000446', '4000000000003220']);
const THREE_DS_TOKENS = new Set(['pm_card_authenticationRequired', 'pm_card_authenticationRequiredOnSetup', 'pm_card_threeDSecure2Required', 'tok_threeDSecure2Required']);
export function requiresAuthentication(...paramSets: Array<Record<string, unknown>>): boolean {
  for (const params of paramSets) {
    const ref = resolveCardRef(params);
    if (ref === undefined) continue;
    if (THREE_DS_PANS.has(ref) || THREE_DS_TOKENS.has(ref)) return true;
  }
  return false;
}

// The canonical next_action Stripe attaches to a PaymentIntent that needs a 3DS challenge.
export function threeDsNextAction(): Record<string, unknown> {
  return {
    type: 'use_stripe_sdk',
    use_stripe_sdk: { type: 'three_d_secure_redirect', stripe_js: 'https://js.stripe.com/v3' },
  };
}

// ---- MICRO-DEPOSIT VERIFICATION (ACH / SEPA delayed bank debit) ----
// Confirming a PaymentIntent/SetupIntent with a us_bank_account PM that requires
// micro-deposit verification leaves it in `requires_action` with a
// `verify_with_microdeposits` next_action. Verification finishes by submitting the two
// deposit amounts (Stripe's documented test descriptor verifies with amounts 32 + 45) OR
// a `descriptor_code` (the test value `SM11AA`). We model that exact pair so the verify
// can FAIL with the wrong amounts. The well-known token that triggers this flow:
const MICRODEPOSIT_TOKENS = new Set(['pm_usBankAccount_requiresVerification', 'pm_us_bank_account']);
export function requiresMicrodeposits(...paramSets: Array<Record<string, unknown>>): boolean {
  for (const params of paramSets) {
    const ref = resolveCardRef(params);
    if (ref !== undefined && MICRODEPOSIT_TOKENS.has(ref)) return true;
  }
  return false;
}
// The canonical next_action for a PI/SI awaiting micro-deposit verification.
export function microdepositsNextAction(): Record<string, unknown> {
  return {
    type: 'verify_with_microdeposits',
    verify_with_microdeposits: {
      arrival_date: 0, hosted_verification_url: 'https://payments.twin.local/microdeposit', microdeposit_type: 'amounts',
    },
  };
}
// Build the real Stripe card-error envelope (HTTP 402). `param` is 'card' for card
// errors; charge/payment_intent ids are attached when known so SDK error objects carry
// them (Stripe does this for confirm/charge failures).
/** A card error's body: `charge` "For card errors, the ID of the failed charge", and `payment_intent` "The PaymentIntent
 *  object for errors returned on a request involving a PaymentIntent" (docs.stripe.com/api/errors). */
export function cardError(outcome: DeclineOutcome, attach: { charge?: string; payment_intent?: Record<string, unknown> } = {}): StripeResponse {
  return {
    status: 402,
    body: {
      error: {
        type: 'card_error',
        code: outcome.code,
        ...(outcome.decline_code ? { decline_code: outcome.decline_code } : {}),
        message: outcome.message,
        param: 'card',
        ...(attach.charge ? { charge: attach.charge } : {}),
        ...(attach.payment_intent ? { payment_intent: attach.payment_intent } : {}),
      },
    },
  };
}
export function nowUnix(occurredAt?: string): number {
  return Math.floor((occurredAt ? Date.parse(occurredAt) : 0) / 1000);
}
// Real Stripe embeds the resource's OWN id inside its client_secret (format
// `<id>_secret_<random>`) — Stripe.js's confirmPayment/confirmSetup parse the id back
// out of the client_secret (splitting on `_secret`) to build the same-origin confirm
// URL (`/v1/payment_intents/<id>/confirm`), rather than being told the id separately.
// A secret that doesn't carry the real id breaks that round trip: a browser Stripe.js
// call would try to confirm a resource whose id it invented from the string
// (`'pi_twin_secret'` → `'pi_twin'`, which was never actually created). Every PI/SI a
// caller might confirm CLIENT-SIDE (real Stripe.js) must mint a secret this way.
/** An intent's client secret: its id, `_secret_`, and a secret the World holds for it (ctx.secret, passed in), so no one
 *  derives it from the intent's id; Stripe.js confirms an intent with it and the publishable key. */
export function mintClientSecret(id: string, secret: string): string {
  return `${id}_secret_${secret.replace(/[^A-Za-z0-9]/g, '').slice(0, 24)}`;
}
// A few Stripe objects have a DOTTED `object` value that differs from the twin's (identifier-safe) resource type: type
// 'checkout_session' is object 'checkout.session'.
export const OBJECT_NAME: Record<string, string> = {
  checkout_session: 'checkout.session',
  billing_portal_session: 'billing_portal.session',
  billing_portal_configuration: 'billing_portal.configuration',
  // Stripe Tax: the TaxRate object is `tax_rate`, but a Tax calculation/registration
  // emit the dotted object names `tax.calculation` / `tax.registration`.
  tax_calculation: 'tax.calculation',
  tax_registration: 'tax.registration',
  // Billing Meters live under the `billing.meter` object; a test clock is `test_helpers.test_clock`.
  billing_meter: 'billing.meter',
  test_clock: 'test_helpers.test_clock',
  // A connected account's external account is the `bank_account` object; an application-fee
  // refund is `fee_refund`; a transfer reversal is `transfer_reversal` (1:1, no mapping).
  external_account: 'bank_account',
  // Stripe Tax transactions emit the dotted object name `tax.transaction`. Radar objects
  // are `radar.review` (NOTE: the public review object is just `review`), `radar.value_list`,
  // `radar.value_list_item`, `radar.rule`.
  tax_transaction: 'tax.transaction',
  radar_review: 'review',
  radar_value_list: 'radar.value_list',
  radar_value_list_item: 'radar.value_list_item',
  radar_rule: 'radar.rule',
  // Issuing objects carry dotted `object` names.
  issuing_cardholder: 'issuing.cardholder',
  issuing_card: 'issuing.card',
  issuing_authorization: 'issuing.authorization',
  issuing_transaction: 'issuing.transaction',
  issuing_dispute: 'issuing.dispute',
  // Terminal objects carry dotted `object` names.
  terminal_location: 'terminal.location',
  terminal_reader: 'terminal.reader',
  terminal_configuration: 'terminal.configuration',
  // Identity VerificationReport + Reporting ReportRun.
  verification_report: 'identity.verification_report',
  report_run: 'reporting.report_run',
  // Customer cash-balance ledger entry.
  cash_balance_transaction: 'customer_cash_balance_transaction',
  // Billing: prepaid credit grants + usage alerts.
  credit_grant: 'billing.credit_grant', billing_alert: 'billing.alert',
  // Entitlements: account feature + per-customer active entitlement.
  entitlements_feature: 'entitlements.feature', active_entitlement: 'entitlements.active_entitlement',
  // Connect: embedded account session + apps secret.
  account_session: 'account_session', apps_secret: 'apps.secret',
  // Issuing: network token + personalization design.
  issuing_token: 'issuing.token', personalization_design: 'issuing.personalization_design',
  // Treasury: financial account + money-movement flows + ledger.
  financial_account: 'treasury.financial_account',
  outbound_payment: 'treasury.outbound_payment', outbound_transfer: 'treasury.outbound_transfer',
  inbound_transfer: 'treasury.inbound_transfer',
  received_credit: 'treasury.received_credit', received_debit: 'treasury.received_debit',
  treasury_transaction: 'treasury.transaction', treasury_transaction_entry: 'treasury.transaction_entry',
  // Climate.
  climate_order: 'climate.order',
  verification_session: 'identity.verification_session',
  // Financial Connections.
  fc_session: 'financial_connections.session', fc_account: 'financial_connections.account',
  fc_transaction: 'financial_connections.transaction',
  // Forwarding + Crypto onramp.
  forwarding_request: 'forwarding.request', onramp_session: 'crypto.onramp_session',
};
/** A stored row as Stripe answers it: its `object`, its own fields (the vendor's `type` among them, which the tree's
 *  shadows: world-core ownFields) without the twin's `_` bookkeeping, and its id. */
export function view(type: string, r: TwinResource): Record<string, unknown> {
  const own = Object.fromEntries(Object.entries(ownFields(r)).filter(([k]) => !k.startsWith('_') && k !== 'updatedAt'));
  return { object: OBJECT_NAME[type] ?? type, ...own, id: r.id };
}
// Real Stripe list pagination. Honors limit (default 10, max 100, min 1),
// starting_after (cursor: exclude up to & including that id), ending_before
// (cursor: take the page ending just before that id); computes has_more against
// the FULL filtered set. Items must already be in Stripe's list order (newest
// first by `created`). Unknown params are ignored, like Stripe.
/** The page ending just before a cursor: the limit items immediately preceding it (docs.stripe.com/api/pagination). */
function pageBefore(items: Array<Record<string, unknown>>, endingBefore: string, limit: number): { page: Array<Record<string, unknown>>; hasMore: boolean } {
  const idx = items.findIndex((r) => r.id === endingBefore);
  const upTo = idx === -1 ? items.length : idx; // unknown cursor → from the start
  const start = Math.max(0, upTo - limit);
  return { page: items.slice(start, upTo), hasMore: start > 0 };
}

/** Where a page after a cursor starts (docs.stripe.com/api/pagination); an unknown cursor starts from the first. */
function afterCursor(items: Array<Record<string, unknown>>, startingAfter: string): number {
  const idx = items.findIndex((r) => r.id === startingAfter);
  return idx === -1 ? 0 : idx + 1;
}

export function paginate(items: Array<Record<string, unknown>>, params: Record<string, unknown>): { page: Array<Record<string, unknown>>; hasMore: boolean } {
  let limit = 10;
  if (params.limit !== undefined) {
    const n = Number(params.limit);
    if (Number.isFinite(n)) limit = Math.min(100, Math.max(1, Math.trunc(n)));
  }
  const startingAfter = typeof params.starting_after === 'string' ? params.starting_after : undefined;
  const endingBefore = typeof params.ending_before === 'string' ? params.ending_before : undefined;

  if (endingBefore) return pageBefore(items, endingBefore, limit);
  const from = startingAfter ? afterCursor(items, startingAfter) : 0;
  const page = items.slice(from, from + limit);
  return { page, hasMore: from + limit < items.length };
}
// Stripe's `active=true|false` filters arrive as strings/booleans; normalize.
export function asBool(v: unknown): boolean {
  return v === true || v === 'true' || v === 1 || v === '1';
}

// ---- SEARCH QUERY LANGUAGE (vendor-faithful subset) ----
// Stripe's Search API (GET /v1/<resource>/search?query=…) uses a small query language:
//   field:"value"  field>num  field<num  field>=num  field<=num  field:num  field:null
//   metadata["k"]:"v"   and combine clauses with AND/OR (case-insensitive).
// We parse a conjunction/disjunction of comparison clauses and evaluate each against a
// resource view. This is the vendor's OWN per-field semantics (A4: not a cross-vendor query
// engine — it lives in the Stripe pack and speaks Stripe's language only). Unsupported
// constructs cause the clause to not match (safe), never a fabricated hit.
type SearchClause = { field: string; op: ':' | '~' | '>' | '<' | '>=' | '<='; value: string };
// Tokenize on top-level AND/OR (we treat the whole query as either all-AND or all-OR; mixed
// precedence is uncommon in practice and Stripe groups with parens we don't model — kept simple).
function parseSearchQuery(query: string): { clauses: SearchClause[]; disjunction: boolean } | null {
  const trimmed = query.trim();
  if (!trimmed) return null;
  const disjunction = / OR /i.test(trimmed) && !/ AND /i.test(trimmed);
  const parts = trimmed.split(disjunction ? / OR /i : / AND /i);
  const clauses: SearchClause[] = [];
  const re = /^\s*([A-Za-z0-9_]+(?:\[[^\]]+\])?)\s*(>=|<=|>|<|:|~)\s*(.+?)\s*$/;
  for (const part of parts) {
    const m = re.exec(part);
    if (!m) return null;
    let value = m[3]!.trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (m[2] === '~' && (!['email', 'name'].includes(m[1]!) || value.length < 3)) return null;
    clauses.push({ field: m[1]!, op: m[2] as SearchClause['op'], value });
  }
  return { clauses, disjunction };
}
// Resolve a query field path to a value on a resource view: supports plain fields and the
// metadata["key"] accessor, its key quoted either way (docs.stripe.com/search writes both `metadata["key"]:"value"` and,
// in its "Charges metadata search" example, `metadata['key']:'value'`).
function searchFieldValue(item: Record<string, unknown>, field: string): unknown {
  const meta = /^metadata\[["']?([^"'\]]+)["']?\]$/.exec(field);
  if (meta) {
    const m = item.metadata;
    return m && typeof m === 'object' ? (m as Record<string, unknown>)[meta[1]!] : undefined;
  }
  return item[field];
}
/** A search's numeric comparison other than `>=` (docs.stripe.com/search#search-query-language). */
function otherComparison(op: string, a: number, n: number): boolean {
  return op === '>' ? a > n : op === '<' ? a < n : a <= n;
}

function evalSearchClause(item: Record<string, unknown>, c: SearchClause): boolean {
  const actual = searchFieldValue(item, c.field);
  // source: https://docs.stripe.com/search "Substring match operator (substrings must be a minimum of 3 characters)"
  if (c.op === '~') return actual != null && String(actual).toLowerCase().includes(c.value.toLowerCase());
  if (c.op === ':') {
    if (c.value === 'null') return actual === null || actual === undefined;
    // numeric exact when both look numeric; else string-equality (case-sensitive, like Stripe tokens)
    if (typeof actual === 'number' && /^-?\d+(\.\d+)?$/.test(c.value)) return actual === Number(c.value);
    if (typeof actual === 'boolean') return String(actual).toLowerCase() === c.value.toLowerCase();
    return String(actual).toLowerCase() === c.value.toLowerCase();
  }
  const n = Number(c.value);
  const a = Number(actual);
  if (!Number.isFinite(n) || !Number.isFinite(a)) return false;
  return c.op === '>=' ? a >= n : otherComparison(c.op, a, n);
}
// A Stripe search over rows in list order: the search-result envelope (object 'search_result',
// has_more, data, next_page), or a vendor 400 when `query` is missing or unparseable. The page
// size honors `limit`.
export function searchOver(items: Array<Record<string, unknown>>, params: Record<string, unknown>, path: string): StripeResponse {
  const query = typeof params.query === 'string' ? params.query : '';
  if (!query) return err('Missing required param: query.', 400, 'parameter_missing');
  const parsed = parseSearchQuery(query);
  if (!parsed) return err(`Invalid search query: '${query}'.`, 400, 'parameter_invalid');
  const all = items.filter((item) =>
    parsed.disjunction ? parsed.clauses.some((c) => evalSearchClause(item, c)) : parsed.clauses.every((c) => evalSearchClause(item, c)),
  );
  const { page, hasMore } = paginate(all, params);
  return { status: 200, body: { object: 'search_result', url: path, has_more: hasMore, data: page, next_page: null, total_count: null } };
}
// Subscriptions `?price=` filters to subs that include that price. The twin stores
// items in whatever shape the caller sent (commonly items[].data[].price[.id]); be
// lenient about the nesting and also accept a flat stored `price` field.
export function subscriptionHasPrice(sub: Record<string, unknown>, priceId: string): boolean {
  if (sub.price === priceId) return true;
  const items = sub.items as { data?: unknown } | undefined;
  const data = Array.isArray(items?.data) ? items!.data : Array.isArray(sub.items) ? (sub.items as unknown[]) : [];
  return (data as Array<Record<string, unknown>>).some((it) => it?.price === priceId || (!!it?.price && typeof it.price === 'object' && (it.price as Record<string, unknown>).id === priceId));
}

// The `coupon` a subscription create/update is attaching, accepting both the top-level
// `coupon=` shorthand and Stripe's discounts[0][coupon] array form. Returns undefined when
// no coupon param was sent at all (so update can distinguish "not set" from "clear" = '').
export function subscriptionCouponParam(params: Record<string, unknown>): string | undefined {
  if ('coupon' in params) return typeof params.coupon === 'string' ? params.coupon : '';
  const ds = params.discounts;
  return Array.isArray(ds) && ds[0] && typeof ds[0] === 'object' ? couponOfDiscounts(ds[0] as Record<string, unknown>) : undefined;
}

/** discounts[0][coupon], Stripe's array form of a subscription's coupon (docs.stripe.com/api/subscriptions/create#create_subscription-discounts). */
function couponOfDiscounts(first: Record<string, unknown>): string | undefined {
  return typeof first.coupon === 'string' ? first.coupon : undefined;
}

// Build Stripe's canonical `discount` object from a coupon (the shape a subscription /
// customer carries once a coupon is applied). id `di_`, references the source coupon +
// customer; end is null for a forever/repeating coupon (we don't compute repeat windows).
/** A coupon applied: the Discount object, naming what it applies to ("customer: The ID of the customer associated
 *  with this discount"; "subscription: The subscription that this coupon is applied to, if it is applied to a
 *  particular subscription", docs.stripe.com/api/discounts/object). */
export function buildDiscount(coupon: Record<string, unknown>, customer: string, at: number, on: { subscription?: string } = {}): Record<string, unknown> {
  return {
    id: `di_twin_${coupon.id}`, object: 'discount', coupon, customer: customer || null,
    start: at, end: null, subscription: on.subscription ?? null, subscription_item: null,
    invoice: null, invoice_item: null, promotion_code: null, checkout_session: null,
  };
}

// The raw item entries a subscription/checkout-derived-subscription create sent,
// normalized to an ordered array. The form reader already turns the bracket form
// items[0][price]=… into an array of objects (see lineItemEntries() above for the
// identical `line_items` case); accept that, and a single-object shape defensively.
export function subscriptionItemEntries(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? (value.filter((x) => x && typeof x === 'object') as Array<Record<string, unknown>>) : [];
}

// Real Stripe billing cadences a Price's `recurring` can carry.
type BillingInterval = 'day' | 'week' | 'month' | 'year';
const BILLING_INTERVALS = new Set<BillingInterval>(['day', 'week', 'month', 'year']);

// Resolve the (interval, interval_count) a new subscription bills on, from the FIRST
// entry's price (Stripe requires every item on a subscription to share one
// billing_cycle_anchor, so the first item's cadence drives current_period_end).
// `entries` is whatever subscriptionItemEntries()/lineItemEntries() produced — each
// entry's `price` may be a price id string or an already-resolved Price object
// (the checkout-session line_items shape). Falls back to a defensive month/1 default
// (`resolved: false`) when no entry resolves to a stored recurring price — e.g. an
// inline price_data with no persisted Price, or (real Stripe would 400) no item at
// all. This should not happen for a well-formed subscription create; it exists so
// current_period_end is always populated rather than silently NaN/undefined.
export function resolveSubscriptionBillingInterval(entries: Array<Record<string, unknown>>, find: FindStored): { interval: BillingInterval; interval_count: number; resolved: boolean } {
  // the first item whose price recurs sets the billing interval
  const recurring = entries.map((entry) => {
    const p = entry.price;
    const priceId = typeof p === 'string' ? p : (p && typeof p === 'object' ? String((p as Record<string, unknown>).id ?? '') : '');
    return (priceId ? find('price', priceId)?.recurring : undefined) as Record<string, unknown> | undefined;
  }).find((r) => r && typeof r === 'object' && typeof r.interval === 'string' && BILLING_INTERVALS.has(r.interval as BillingInterval));
  return recurring
    ? { interval: recurring.interval as BillingInterval, interval_count: Math.max(1, Math.trunc(Number(recurring.interval_count) || 1)), resolved: true }
    : { interval: 'month', interval_count: 1, resolved: false };
}

// Add one billing period to a unix timestamp, real-Stripe-faithful: `month`/`year`
// add CALENDAR months clamped to the target month's last day (Jan 31 + 1 month ->
// Feb 28/29, not an overflow into March, matching how Stripe advances a billing_
// cycle_anchor); `day`/`week` are exact multiples of 86400/604800 seconds.
export function addBillingInterval(atUnix: number, interval: BillingInterval, count: number): number {
  const n = Math.max(1, Math.trunc(count) || 1);
  if (interval === 'day') return atUnix + n * 24 * 3600;
  if (interval === 'week') return atUnix + n * 7 * 24 * 3600;
  const months = interval === 'year' ? n * 12 : n;
  const d = new Date(atUnix * 1000);
  const anchorDay = d.getUTCDate();
  const first = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1, d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()));
  const daysInTargetMonth = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(anchorDay, daysInTargetMonth));
  return Math.floor(first.getTime() / 1000);
}

// Build the canonical items.data list Stripe returns on a subscription: a real
// SubscriptionItem per entry, carrying the resolved Price object plus the
// deprecated-but-still-served `plan` mirror (some integrations still read
// item.plan.interval / .product / .id off a subscription item). `subId` is the
// subscription's own (already-assigned, see the `id` pre-generation in the POST
// handler) id, so each item's `subscription` back-reference round-trips. Fixes the
// prior always-empty `items.data` on subscription create — real Stripe's create
// response includes the actual items, mirroring what was requested.
/** What a subscription item carries of its price: the Price itself and its plan view (a subscription item answers both,
 *  docs.stripe.com/api/subscription_items/object), by the price's id or an already-resolved Price. */
// source: https://docs.stripe.com/api/plans/create "It replaces the Plans API and is backwards compatible to simplify your migration."
// source: spec:/components/schemas/plan "amount_decimal"

export function subscriptionItemPrice(p: unknown, find: FindStored): { price: Record<string, unknown> | string | null; plan: Record<string, unknown> | null } {
  const priceId = typeof p === 'string' ? p : (p && typeof p === 'object' ? String((p as Record<string, unknown>).id ?? '') : '');
  const price = priceId ? find('price', priceId) : undefined;
  const plan = price ? planView(price) : null;
  return { price: price ?? (priceId || null), plan };
}

export function buildSubscriptionItemsList(entries: Array<Record<string, unknown>>, subId: string, at: number, find: FindStored): Record<string, unknown> {
  const data = entries.map((entry, i) => {
    const quantity = entry.quantity !== undefined ? Math.max(1, Math.trunc(Number(entry.quantity) || 1)) : 1;
    const { price, plan } = subscriptionItemPrice(entry.price, find);
    return {
      id: `si_twin_${subId}_${i + 1}`, object: 'subscription_item',
      price, plan, quantity, subscription: subId,
      created: at, metadata: {}, discounts: [], billing_thresholds: null, tax_rates: [],
    };
  });
  return { object: 'list', data, has_more: false, total_count: data.length, url: `/v1/subscription_items?subscription=${subId}` };
}

/** What a per-unit price bills for a quantity: its `unit_amount` times the quantity, or, for a price given only as a
 *  decimal (`unit_amount_decimal`, "represented as a decimal string with at most 12 decimal places", spec/openapi.json.gz),
 *  the decimal times the quantity rounded to a whole amount: "rounding occurs after multiplying the quantity by the
 *  decimal amount ... `0.05 * 30 = 1.5`, which rounds up to 2 cents" (docs.stripe.com/products-prices/manage-prices).
 *  Where the documentation stops and the twin decides: the rounding is to the nearest whole amount, halves up. */
export function priceAmount(price: Record<string, unknown> | undefined | null, quantity: number): number {
  if (!price) return 0;
  if (typeof price.unit_amount === 'number') return price.unit_amount * quantity;
  const decimal = Number(price.unit_amount_decimal);
  return Number.isFinite(decimal) ? Math.round(decimal * quantity) : 0;
}

// Apply a coupon's discount to a subtotal (percent_off or amount_off), clamped at 0.
export function applyCouponDiscount(subtotal: number, coupon: Record<string, unknown> | undefined): number {
  return !coupon ? 0 : typeof coupon.percent_off === 'number' ? Math.round((subtotal * coupon.percent_off) / 100) : typeof coupon.amount_off === 'number' ? amountOffDiscount(subtotal, coupon.amount_off) : 0;
}

/** A fixed-amount coupon's discount, never more than the subtotal (docs.stripe.com/api/coupons/object#coupon_object-amount_off). */
function amountOffDiscount(subtotal: number, amountOff: number): number {
  return Math.min(subtotal, Math.trunc(amountOff));
}

// Resolve a subscription/checkout trial window from trial_period_days or trial_end. A
// trial_end of "now" / 0 / absent means no trial. Returns {start,end} unix or undefined.
export function resolveTrial(params: Record<string, unknown>, at: number): { start: number; end: number } | undefined {
  if (params.trial_period_days !== undefined) {
    const days = Math.trunc(Number(params.trial_period_days) || 0);
    if (days > 0) return { start: at, end: at + days * 24 * 3600 };
  }
  if (params.trial_end !== undefined && params.trial_end !== 'now') {
    const end = Math.trunc(Number(params.trial_end) || 0);
    if (end > at) return { start: at, end };
  }
  return undefined;
}

// The closed interval set for spending_controls[spending_limits][][interval]
// (stripe@22.3.0 Issuing/Cards.d.ts SpendingLimit.Interval — a documented closed enum).
const SPENDING_LIMIT_INTERVALS = new Set(['all_time', 'daily', 'monthly', 'per_authorization', 'weekly', 'yearly']);

// The stored SpendingControls shape (stripe@22.3.0 Card.SpendingControls): categories and
// countries are nullable arrays, spending_limits an array of {amount, categories, interval}.
export function emptySpendingControls(): Record<string, unknown> {
  return {
    allowed_categories: null, allowed_merchant_countries: null,
    blocked_categories: null, blocked_merchant_countries: null,
    spending_limits: [], spending_limits_currency: null,
  };
}

/** A malformed spending_controls dictionary's refusal, by what is wrong with it (normalizeSpendingControls). */
function controlsRefused(what: 'dictionary' | 'categories' | 'countries' | 'limit' | 'amount' | 'interval', i = 0): { error: StripeResponse } {
  switch (what) {
    case 'dictionary': return { error: err('Invalid spending_controls: must be a dictionary.', 400, 'parameter_invalid_dictionary') };
    case 'categories': return { error: err('spending_controls[allowed_categories] cannot be set with spending_controls[blocked_categories].', 400) };
    case 'countries': return { error: err('spending_controls[allowed_merchant_countries] cannot be set with spending_controls[blocked_merchant_countries].', 400) };
    case 'limit': return { error: err(`Invalid spending_controls[spending_limits][${i}]: must be a dictionary.`, 400, 'parameter_invalid_dictionary') };
    case 'amount': return { error: err(`Invalid integer: spending_controls[spending_limits][${i}][amount] must be a positive integer.`, 400, 'parameter_invalid_integer') };
    case 'interval': return { error: err(`Invalid spending_controls[spending_limits][${i}][interval]: must be one of 'all_time', 'daily', 'monthly', 'per_authorization', 'weekly', or 'yearly'.`, 400, 'parameter_invalid_string_enum') };
  }
}

// Validate + normalize a caller-provided spending_controls dictionary (card create/update).
// Vendor rules enforced: interval must be in the closed enum; a spending limit amount is a
// positive integer; allowed_categories "Cannot be set with blocked_categories" (and the
// merchant-country pair likewise) — both restrictions verbatim from the SDK's field docs.
export function normalizeSpendingControls(raw: unknown, currency: string | null, previous?: Record<string, unknown>): { controls?: Record<string, unknown>; error?: StripeResponse } {
  if (raw === undefined) return {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return controlsRefused('dictionary');
  const sc = { ...previous, ...(raw as Record<string, unknown>) };
  const strArr = (v: unknown): string[] | undefined => (Array.isArray(v) ? v.map(String) : undefined);
  const allowedCats = strArr(sc.allowed_categories);
  const blockedCats = strArr(sc.blocked_categories);
  if (allowedCats?.length && blockedCats?.length) return controlsRefused('categories');
  const allowedCountries = strArr(sc.allowed_merchant_countries);
  const blockedCountries = strArr(sc.blocked_merchant_countries);
  if (allowedCountries?.length && blockedCountries?.length) return controlsRefused('countries');
  const limits: Array<Record<string, unknown>> = [];
  const rawLimits = Array.isArray(sc.spending_limits) ? sc.spending_limits : [];
  for (let i = 0; i < rawLimits.length; i++) {
    const l = rawLimits[i];
    if (!l || typeof l !== 'object' || Array.isArray(l)) return controlsRefused('limit', i);
    const { amount, interval, categories } = l as Record<string, unknown>;
    if (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0) return controlsRefused('amount', i);
    if (typeof interval !== 'string' || !SPENDING_LIMIT_INTERVALS.has(interval)) return controlsRefused('interval', i);
    const cats = strArr(categories);
    limits.push({ amount, categories: cats?.length ? cats : null, interval });
  }
  const arrOrNull = (v: string[] | undefined) => (v === undefined ? undefined : v.length ? v : null);
  const controls: Record<string, unknown> = {
    ...emptySpendingControls(),
    // source: spec:/paths/~1v1~1issuing~1cards~1{card}/post/requestBody/content/application~1x-www-form-urlencoded/schema/properties/spending_controls "Rules that control spending for this card."
    // Keep every documented control, including allowed_card_presences and blocked_card_presences.
    ...sc,
    spending_limits: limits,
    ...(limits.length ? { spending_limits_currency: typeof sc.spending_limits_currency === 'string' ? sc.spending_limits_currency : currency } : {}),
  };
  for (const [key, v] of [
    ['allowed_categories', arrOrNull(allowedCats)], ['blocked_categories', arrOrNull(blockedCats)],
    ['allowed_merchant_countries', arrOrNull(allowedCountries)], ['blocked_merchant_countries', arrOrNull(blockedCountries)],
  ] as Array<[string, unknown]>) {
    if (v !== undefined) controls[key] = v;
  }
  return { controls };
}

// Start of the current spending-limit window, seconds since epoch (UTC calendar windows;
// weekly starts Monday 00:00 UTC — the week-start day is not vendor-documented).
function issuingWindowStartSec(interval: string, nowSec: number): number {
  if (interval === 'all_time') return 0;
  const d = new Date(nowSec * 1000);
  if (interval === 'daily') return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 1000;
  if (interval === 'weekly') {
    const monOffset = (d.getUTCDay() + 6) % 7; // Monday = 0
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - monOffset) / 1000;
  }
  if (interval === 'monthly') return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000;
  if (interval === 'yearly') return Date.UTC(d.getUTCFullYear(), 0, 1) / 1000;
  return 0;
}

type PriorAuthorization = { amount: number; created: number; category: string };

// Evaluate one spending_controls dictionary against a presented authorization. Returns a
// human-readable reason_message when a control declines the authorization, else null.
// (The request_history.reason for any violation is 'spending_controls' — the vendor enum's
// single value for controls declines.)
export function spendingControlsViolation(
  controls: unknown,
  opts: { amount: number; category: string; country: string | null; nowSec: number; priorApproved: PriorAuthorization[] },
): string | null {
  if (!controls || typeof controls !== 'object') return null;
  const sc = controls as Record<string, unknown>;
  const list = (v: unknown): string[] | null => (Array.isArray(v) && v.length ? v.map(String) : null);
  const allowedCats = list(sc.allowed_categories);
  if (allowedCats && !allowedCats.includes(opts.category)) return `merchant category ${opts.category} is not in allowed_categories`;
  const blockedCats = list(sc.blocked_categories);
  if (blockedCats?.includes(opts.category)) return `merchant category ${opts.category} is in blocked_categories`;
  const allowedCountries = list(sc.allowed_merchant_countries);
  if (allowedCountries && (!opts.country || !allowedCountries.includes(opts.country))) return `merchant country ${opts.country ?? '(none)'} is not in allowed_merchant_countries`;
  const blockedCountries = list(sc.blocked_merchant_countries);
  if (blockedCountries && opts.country && blockedCountries.includes(opts.country)) return `merchant country ${opts.country} is in blocked_merchant_countries`;
  for (const rawLimit of Array.isArray(sc.spending_limits) ? sc.spending_limits : []) {
    if (!rawLimit || typeof rawLimit !== 'object') continue;
    const l = rawLimit as Record<string, unknown>;
    const limit = Number(l.amount) || 0;
    if (limit <= 0) continue;
    const limCats = list(l.categories);
    if (limCats && !limCats.includes(opts.category)) continue;
    const interval = String(l.interval ?? '');
    if (interval === 'per_authorization') {
      if (opts.amount > limit) return `amount exceeds the per_authorization spending limit of ${limit}`;
      continue;
    }
    const start = issuingWindowStartSec(interval, opts.nowSec);
    const spent = opts.priorApproved
      .filter((a) => a.created >= start && (!limCats || limCats.includes(a.category)))
      .reduce((s, a) => s + a.amount, 0);
    if (spent + opts.amount > limit) return `amount exceeds the ${interval} spending limit of ${limit}`;
  }
  return null;
}

// Stripe's dispute.evidence is a flat bag of (mostly null) string fields; the twin
// emits the canonical empty shape so the object is shaped right without fabricating
// content. Callers can overwrite individual fields via POST /v1/disputes/:id.
export function disputeEvidence(): Record<string, unknown> {
  return {
    access_activity_log: null, billing_address: null, cancellation_policy: null,
    cancellation_policy_disclosure: null, cancellation_rebuttal: null, customer_communication: null,
    customer_email_address: null, customer_name: null, customer_purchase_ip: null, customer_signature: null,
    duplicate_charge_documentation: null, duplicate_charge_explanation: null, duplicate_charge_id: null,
    product_description: null, receipt: null, refund_policy: null, refund_policy_disclosure: null,
    refund_refusal_explanation: null, service_date: null, service_documentation: null,
    shipping_address: null, shipping_carrier: null, shipping_date: null, shipping_documentation: null,
    shipping_tracking_number: null, uncategorized_file: null, uncategorized_text: null,
    // required by the served spec; empty for a dispute not eligible for enhanced evidence (Visa CE 3.0 eligibility
    // comes from its own test card, pm_card_createCe3EligibleDispute: docs.stripe.com/disputes/api/visa-ce3)
    enhanced_evidence: {},
  };
}

// Synthesize the type-specific sub-object a PaymentMethod carries, keyed by `type`. Stripe
// nests the instrument detail under a field named for the type (card / sepa_debit /
// us_bank_account / link / etc.). We model the non-card rails the QA stack uses (SEPA
// direct debit, ACH us_bank_account, Link, and the wallet pass-through) with their canonical
// shapes — never echoing the raw PAN/account number, only the safe last4-style fields.
type Params = Record<string, unknown>;
const subParams = (params: Params, k: string): Params => (params[k] && typeof params[k] === 'object' ? (params[k] as Params) : {});

// source: https://docs.stripe.com/testing
// The documented brand cards keep their brand and funding type when Checkout or the portal saves them.
// Where the documentation stops and the twin decides: other numbers retain the existing synthetic Visa default.
const TEST_CARD_PROFILES: Record<string, { brand: string; funding: string }> = {
  '4000056655665556': { brand: 'visa', funding: 'debit' },
  '5555555555554444': { brand: 'mastercard', funding: 'credit' },
  '2223003122003222': { brand: 'mastercard', funding: 'credit' },
  '5200828282828210': { brand: 'mastercard', funding: 'debit' },
  '5105105105105100': { brand: 'mastercard', funding: 'prepaid' },
  '378282246310005': { brand: 'amex', funding: 'credit' },
  '371449635398431': { brand: 'amex', funding: 'credit' },
  '6011111111111117': { brand: 'discover', funding: 'credit' },
  '6011000990139424': { brand: 'discover', funding: 'credit' },
  '6011981111111113': { brand: 'discover', funding: 'debit' },
  '3056930009020004': { brand: 'diners', funding: 'credit' },
  '36227206271667': { brand: 'diners', funding: 'credit' },
  '3566002020360505': { brand: 'jcb', funding: 'credit' },
  '6200000000000005': { brand: 'unionpay', funding: 'credit' },
  '6200000000000047': { brand: 'unionpay', funding: 'debit' },
  '6205500000000000004': { brand: 'unionpay', funding: 'credit' },
};

/** A card's own sub-object, from the number and expiry given. */
function cardSubObject(params: Params): Params {
  const c = subParams(params, 'card');
  // the form reader (the kernel's readParams) coerces an all-digit card[number] to a JS number (same as any
  // other numeric-looking form field) — accept both shapes so a raw test PAN still
  // produces its real last4 instead of silently falling back to the '4242' default.
  const number = typeof c.number === 'string' ? c.number.replace(/\D/g, '')
    : typeof c.number === 'number' ? String(c.number).replace(/\D/g, '') : '';
  const profile = TEST_CARD_PROFILES[number] ?? { brand: 'visa', funding: 'credit' };
  return { card: {
    brand: profile.brand, last4: number ? number.slice(-4) : '4242',
    exp_month: Number(c.exp_month) || 12, exp_year: Number(c.exp_year) || 2034,
    funding: profile.funding, country: 'US',
    // source: spec:/components/schemas/payment_method_card/properties/fingerprint/description "Uniquely identifies this particular card number."
    // The synthetic fingerprint is stable for a number; Stripe's opaque fingerprint algorithm is not published.
    fingerprint: digest('sha256', number || '4242424242424242').slice(0, 16),
    checks: { address_line1_check: null, address_postal_code_check: null, cvc_check: 'pass' },
    networks: { available: [profile.brand], preferred: null },
    three_d_secure_usage: { supported: true }, wallet: null,
  } };
}

/** A SEPA Direct Debit account's sub-object, from its IBAN. */
function sepaDebitSubObject(params: Params): Params {
  const s = subParams(params, 'sepa_debit');
  const iban = typeof s.iban === 'string' ? s.iban.replace(/\s/g, '') : '';
  return { sepa_debit: {
    bank_code: '37040044', branch_code: '', country: iban ? iban.slice(0, 2).toUpperCase() : 'DE',
    fingerprint: 'twin_sepa_fp', last4: iban ? iban.slice(-4) : '3000',
    generated_from: { charge: null, setup_attempt: null }, mandate: null,
  } };
}

/** A US bank account's sub-object, from its numbers. */
function usBankAccountSubObject(params: Params): Params {
  const a = subParams(params, 'us_bank_account');
  const num = typeof a.account_number === 'string' ? a.account_number.replace(/\D/g, '') : '';
  return { us_bank_account: {
    account_holder_type: (a.account_holder_type as string) ?? 'individual',
    account_type: (a.account_type as string) ?? 'checking',
    bank_name: 'STRIPE TEST BANK', financial_connections_account: null,
    fingerprint: 'twin_ach_fp', last4: num ? num.slice(-4) : '6789',
    networks: { preferred: 'ach', supported: ['ach'] },
    routing_number: typeof a.routing_number === 'string' ? a.routing_number : '110000000',
    status_details: {},
  } };
}

/** A Link or Cash App Pay method's sub-object, which carries nothing the twin knows. */
function walletSubObject(pmType: string): Params {
  return pmType === 'link' ? { link: { email: null, persistent_token: null } } : { cashapp: { buyer_id: null, cashtag: null } };
}

/** Wallet / other rails the twin doesn't deep-model: an empty type bag, like Stripe's for a minimally-specified
 *  PaymentMethod (the `type` field is the truth). */
function otherSubObject(pmType: string): Params {
  return { [pmType]: {} };
}

const SUB_OBJECTS: Record<string, (params: Params, pmType: string) => Params> = {
  card: cardSubObject, sepa_debit: sepaDebitSubObject, us_bank_account: usBankAccountSubObject,
  link: (_p, t) => walletSubObject(t), cashapp: (_p, t) => walletSubObject(t),
};

export function paymentMethodSubObject(pmType: string, params: Record<string, unknown>): Record<string, unknown> {
  return SUB_OBJECTS[pmType] ? SUB_OBJECTS[pmType]!(params, pmType) : otherSubObject(pmType);
}

// ---- CONNECT: connected accounts (vendor-faithful) ----
// A connected account (Stripe Connect) represents a business onboarded onto the
// platform. We model the OBJECT (id `acct_`, object 'account', type express|standard|
// custom, country, email, charges_enabled/payouts_enabled/details_submitted booleans,
// capabilities map, and the `requirements` hash) plus transfers to those accounts and
// payout-to-account links. The hosted Connect onboarding flow is Stripe's own page — we
// model the Account API object + its login_links, the API surface apps depend on. A freshly-created account is NOT yet active: charges/payouts disabled,
// details_submitted false, and `requirements` lists the outstanding onboarding fields,
// exactly like real Stripe before onboarding completes.
export const ACCOUNT_TYPES = new Set(['express', 'standard', 'custom']);
// The fixed id of the platform's OWN account (GET/POST /v1/account, singular).
export const PLATFORM_ACCOUNT_ID = 'acct_twin_self';

// Stripe's canonical "freshly created, not yet onboarded" requirements hash: a set of
// currently-due fields, empty arrays for the other buckets, and a null deadline. This
// matches the shape real Stripe returns for a brand-new account before onboarding.
export function accountRequirements(): Record<string, unknown> {
  return {
    alternatives: [],
    current_deadline: null,
    currently_due: ['business_profile.mcc', 'business_profile.url', 'external_account', 'tos_acceptance.date', 'tos_acceptance.ip'],
    disabled_reason: 'requirements.past_due',
    errors: [],
    eventually_due: ['business_profile.mcc', 'business_profile.url', 'external_account', 'tos_acceptance.date', 'tos_acceptance.ip'],
    past_due: [],
    pending_verification: [],
  };
}

// Normalize the requested `capabilities` create param (Stripe sends
// capabilities[card_payments][requested]=true) into the account.capabilities map,
// whose values are the capability STATUS enum (active|inactive|pending). A requested
// capability on a brand-new account starts `inactive` (not yet granted), like Stripe.
export function accountCapabilities(params: Record<string, unknown>): Record<string, unknown> {
  const requested = params.capabilities;
  const out: Record<string, unknown> = {};
  if (requested && typeof requested === 'object') {
    for (const key of Object.keys(requested as Record<string, unknown>)) out[key] = 'inactive';
  }
  return out;
}

// Normalize an account's `settings`, focusing on the payout SCHEDULE (the automatic-payout
// cadence: settings.payouts.schedule.{interval, weekly_anchor, monthly_anchor, delay_days}).
// Stripe's default is a daily automatic schedule with a default delay; an explicit schedule
// merges over the existing one. Other settings sub-objects are emitted with canonical empty
// shapes so the object is shaped right without fabricating values.
export function accountSettings(input: unknown, existing?: Record<string, unknown>): Record<string, unknown> {
  const base = existing ?? {};
  const prevPayouts = (base.payouts && typeof base.payouts === 'object' ? base.payouts : {}) as Record<string, unknown>;
  const prevSchedule = (prevPayouts.schedule && typeof prevPayouts.schedule === 'object' ? prevPayouts.schedule : {}) as Record<string, unknown>;
  const inObj = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const inPayouts = (inObj.payouts && typeof inObj.payouts === 'object' ? inObj.payouts : {}) as Record<string, unknown>;
  const inSchedule = (inPayouts.schedule && typeof inPayouts.schedule === 'object' ? inPayouts.schedule : {}) as Record<string, unknown>;
  const interval = typeof inSchedule.interval === 'string' ? inSchedule.interval : (typeof prevSchedule.interval === 'string' ? prevSchedule.interval : 'daily');
  const schedule: Record<string, unknown> = {
    interval,
    delay_days: inSchedule.delay_days !== undefined ? Math.trunc(Number(inSchedule.delay_days) || 0) : (prevSchedule.delay_days ?? 2),
    weekly_anchor: interval === 'weekly' ? ((inSchedule.weekly_anchor as string) ?? prevSchedule.weekly_anchor ?? 'monday') : null,
    monthly_anchor: interval === 'monthly' ? (inSchedule.monthly_anchor !== undefined ? Math.trunc(Number(inSchedule.monthly_anchor)) : (prevSchedule.monthly_anchor ?? 1)) : null,
  };
  // the sections a new account's settings answer with, as the Account object's example shows a fresh account's
  // (docs.stripe.com/api/accounts/object); what the account has set is kept
  const fresh: Record<string, unknown> = {
    bacs_debit_payments: { display_name: null, service_user_number: null },
    branding: { icon: null, logo: null, primary_color: null, secondary_color: null },
    card_issuing: { tos_acceptance: { date: null, ip: null } },
    card_payments: { decline_on: { avs_failure: false, cvc_failure: false }, statement_descriptor_prefix: null, statement_descriptor_prefix_kanji: null, statement_descriptor_prefix_kana: null },
    dashboard: { display_name: null, timezone: 'Etc/UTC' },
    invoices: { default_account_tax_ids: null, hosted_payment_method_save: null },
    payments: { statement_descriptor: null, statement_descriptor_kana: null, statement_descriptor_kanji: null },
    sepa_debit_payments: {},
  };
  const sections = Object.fromEntries(Object.entries(fresh).map(([k, v]) => [k, base[k] && typeof base[k] === 'object' ? { ...(v as object), ...(base[k] as object) } : v]));
  return {
    ...base,
    ...sections,
    payouts: { ...prevPayouts, schedule, statement_descriptor: (inPayouts.statement_descriptor as string) ?? prevPayouts.statement_descriptor ?? null, debit_negative_balances: inPayouts.debit_negative_balances ?? prevPayouts.debit_negative_balances ?? true },
  };
}

// ---- CHECKOUT SESSIONS (vendor-faithful) ----
// Stripe's Checkout Session is an API object that represents a hosted-payment-page
// instance. We model the OBJECT (id `cs_`, object 'checkout.session', mode/url/status/
// payment_status, computed amount_total) and its line_items sub-list. The hosted page is
// Stripe's own HTML — the SDK creates/retrieves/lists/expires the Session and reads its
// line_items; that is the API surface apps depend on.
//
// A session's line_items arrive in Stripe's bracket form: either a reference to an
// existing price (line_items[n][price]=price_…, line_items[n][quantity]=q) or inline
// price_data (line_items[n][price_data][unit_amount]=…&[currency]=…). We normalize
// each to a Checkout `item` (object 'item', amount_subtotal/total/discount/tax,
// currency, quantity, price) and compute amount_subtotal/amount_total by summing.
export type CheckoutItem = {
  object: 'item'; id: string; amount_discount: number; amount_subtotal: number;
  amount_tax: number; amount_total: number; currency: string; description: string | null;
  price: Record<string, unknown> | string | null; quantity: number;
};

// Resolve the unit amount + currency for one line_items entry, preferring an existing
// price (looked up in the action log) then inline price_data. Unknown/missing price →
// 0 amount with the session currency (faithful: Stripe would 400, but we keep the
// referenced-price path strict and leave amount 0 only when nothing is resolvable).
export function resolveLineItem(entry: Record<string, unknown>, index: number, fallbackCurrency: string, find: FindStored): { item: CheckoutItem; priceMissing?: string } {
  const quantity = entry.quantity === undefined ? 1 : Math.max(0, Math.trunc(Number(entry.quantity) || 0));
  let billed: Record<string, unknown> | undefined;
  let currency = fallbackCurrency;
  let priceField: Record<string, unknown> | string | null = null;
  let priceMissing: string | undefined;
  // a line item's description "Defaults to product name" (spec/openapi.json.gz, the `item` schema)
  let description: string | null = null;
  const priceRef = typeof entry.price === 'string' ? entry.price : undefined;
  const priceData = entry.price_data && typeof entry.price_data === 'object' ? (entry.price_data as Record<string, unknown>) : undefined;
  if (priceRef) {
    const price = find('price', priceRef);
    if (!price) { priceMissing = priceRef; }
    else {
      billed = price;
      currency = typeof price.currency === 'string' ? price.currency : currency;
      priceField = price;
      const product = typeof price.product === 'string' ? find('product', price.product) : undefined;
      description = typeof product?.name === 'string' ? product.name : null;
    }
  } else if (priceData) {
    billed = { unit_amount: priceData.unit_amount_decimal !== undefined ? undefined : Number(priceData.unit_amount) || 0, unit_amount_decimal: priceData.unit_amount_decimal };
    currency = typeof priceData.currency === 'string' ? priceData.currency : currency;
    priceField = null; // inline price_data is not persisted as a Price object
    const productData = priceData.product_data as Record<string, unknown> | undefined;
    const product = typeof priceData.product === 'string' ? find('product', priceData.product) : undefined;
    description = typeof productData?.name === 'string' ? productData.name : typeof product?.name === 'string' ? product.name : null;
  }
  const amount_subtotal = priceAmount(billed, quantity);
  const item: CheckoutItem = {
    object: 'item', id: `li_twin_${index + 1}`, amount_discount: 0, amount_subtotal,
    amount_tax: 0, amount_total: amount_subtotal, currency, description,
    price: priceField, quantity,
  };
  return { item, priceMissing };
}

// Normalize the bracket-form line_items param to an ordered array. The form reader
// turns line_items[0][price]=… into an array of objects already; accept that, and a
// single-object shape defensively.
export function lineItemEntries(params: Record<string, unknown>): Array<Record<string, unknown>> {
  const li = params.line_items;
  return Array.isArray(li) ? (li.filter((x) => x && typeof x === 'object') as Array<Record<string, unknown>>) : [];
}

// ── THE MONEY MODEL: a charge and the refunds taken out of it ──────────────────────────
//
// The rule this section exists to hold: A FACT RECORDED ON ONE MONEY OBJECT IS VISIBLE FROM
// THE OBJECT IT CONCERNS. A twin that mints a `succeeded` Refund and leaves the Charge saying
// `amount_refunded: 0` hands a consumer reconciling a ledger the wrong answer with NO error to
// tell them it is wrong — worse than refusing, because it looks like it worked.
//
// Every Charge carries the same money spine: the captured/refunded scalars, and a `refunds`
// sub-list (real Stripe's Charge always has one, empty or not).
function emptyRefundsList(chargeId: string): Record<string, unknown> {
  return { object: 'list', data: [], has_more: false, total_count: 0, url: `/v1/charges/${chargeId}/refunds` };
}
export function chargeDefaults(chargeId: string, amount: number, captured: boolean, occurredAt?: string): Record<string, unknown> {
  return {
    status: 'succeeded', paid: true, captured, refunded: false, disputed: false,
    amount_captured: captured ? amount : 0, amount_refunded: 0, metadata: {},
    refunds: emptyRefundsList(chargeId),
    ...(captured ? {} : { capture_before: nowUnix(occurredAt) + 7 * 24 * 3600 }),
    billing_details: { address: null, email: null, name: null, phone: null }, livemode: false,
  };
}

// collection path segment → resource type, for the generic list of a collection Stripe does not
// list at that path (the twin's test clocks, which Stripe lists under /v1/test_helpers).


export function planView(price: Record<string, unknown>): Record<string, unknown> {
  const recurring = price.recurring as Record<string, unknown> | undefined;
  return {
    id: price.id, object: 'plan', active: price.active ?? true, amount: price.unit_amount ?? null,
    amount_decimal: price.unit_amount_decimal ?? (price.unit_amount == null ? null : String(price.unit_amount)),
    billing_scheme: price.billing_scheme ?? 'per_unit', created: price.created, currency: price.currency,
    interval: recurring?.interval ?? null, interval_count: recurring?.interval_count ?? 1,
    livemode: price.livemode ?? false, metadata: price.metadata ?? {}, nickname: price.nickname ?? null,
    product: price.product ?? null, tiers_mode: price.tiers_mode ?? null,
    meter: recurring?.meter ?? null, trial_period_days: recurring?.trial_period_days ?? null,
    transform_usage: price.transform_quantity ?? null, usage_type: recurring?.usage_type ?? 'licensed',
  };
}
