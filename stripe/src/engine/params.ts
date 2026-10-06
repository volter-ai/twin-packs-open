// STRIPE'S PARAMETER CHECK — every API request's top-level parameters against the operation's own in the vendored
// spec, before any handler reads them. Stripe refuses a parameter the operation does not take with
// `400 parameter_unknown` ("Received unknown parameter: …", docs.stripe.com/error-codes#parameter-unknown) and a
// required one left out with `400 parameter_missing` ("Missing required param: …",
// docs.stripe.com/error-codes#parameter-missing). Without this check a handler read whatever it was sent, so a
// parameter Stripe had removed (a promotion code's top-level `coupon`, replaced by `promotion[coupon]` in
// 2025-09-30.clover) was accepted.
//
// Where the evidence stops: the check knows only the served version's parameters (the spec's, surface.version). A
// request pinning an earlier version with Stripe-Version is not checked, since the pack holds no earlier spec, beyond
// the values of the payment_method_types it still takes (PAYMENT_METHOD_TYPES below); nested parameters are not checked.

import surface from '../generated/surface.gen.json' with { type: 'json' };
type Param = { name: string; required?: boolean };
type Op = { id: string; method: string; query?: Param[]; body?: Param[] };
export const OPS = new Map((surface.operations as Op[]).map((o) => [o.id, o]));

/** Parameters Stripe documents outside its published spec, each with the page that documents it. */
export const DOCUMENTED: Record<string, string[]> = {
  // a top-up into the Issuing balance (docs.stripe.com/issuing/funding/balance: "destination_balance=issuing")
  PostTopups: ['destination_balance'],
};

// PAYMENT_METHOD_TYPES. The operations that took `payment_method_types` until 2026-08-26.preview, which "Removes
// `payment_method_types` as a writable parameter from the create, update, and confirm methods on Payment Intents, and
// from the create and update methods on Setup Intents. Passing `payment_method_types` now returns a 400 error with the
// code `payment_method_types_no_longer_supported`", for a caller "at 2026-08-26.preview or later"
// (docs.stripe.com/changelog/dahlia/2026-08-26/removes-payment-method-types-parameter-from-payment-intents-setup-
// intents). The served spec (2026-09-30.endive) has no such parameter on them, nor on a Checkout Session's create,
// which the changelog does not name: there it is an unknown parameter for a caller on the served version, and taken
// from any caller pinned before it.
// A caller pinned before the removal (stripe-node sends the version it is configured with: Cal.com's 2020-08-27)
// still sends it, "The list of payment method types (e.g. card) that this PaymentIntent is allowed to use. A
// comprehensive list of valid payment method types can be found here" (the served spec's payment_intent object, the
// link being the PaymentMethod object's `type`). A PaymentIntent's or SetupIntent's value outside that list is refused
// as Stripe refuses one there: "The payment method type "us_bank_account" is invalid. See
// https://stripe.com/docs/api/setup_intents/create#create_setup_intent-payment_method_types for the full list of
// supported payment method types." (a real SetupIntent answer quoted in github.com/stripe/stripe-node/issues/1472).
// A Checkout Session's value outside its own enum is refused as Stripe refuses any value outside a parameter's enum:
// "Invalid payment_settings[payment_method_types][1]: must be one of ach_credit_transfer, …, or wechat_pay" (a real
// answer quoted in github.com/stripe/stripe-node/issues/1755), with no code. Where the evidence stops: the message
// Stripe gives with payment_method_types_no_longer_supported is not documented (the twin's own words below); the
// PaymentIntent's link is the SetupIntent's with its own resource (no PaymentIntent answer is quoted), and neither
// answer's param nor code is quoted (the twin gives param payment_method_types, no code); the lists are the served
// version's, not the pinned one's.
/** The version that removed payment_method_types from the intents: a caller pinned to it or later is refused. */
export const METHOD_TYPES_REMOVED_IN = '2026-08-26.preview';
/** Whether a pinned version is at or after the removal: versions order by their date (YYYY-MM-DD). */
export const methodTypesRemoved = (pinned: string): boolean => pinned.slice(0, 10) >= METHOD_TYPES_REMOVED_IN.slice(0, 10);
export const REMOVED_TYPES = new Set(['PostPaymentIntents', 'PostPaymentIntentsIntent', 'PostPaymentIntentsIntentConfirm', 'PostSetupIntents', 'PostSetupIntentsIntent']);
export const TYPED = new Set([...REMOVED_TYPES, 'PostCheckoutSessions']);
type Resource = { name: string; fields: Array<{ name: string; enum?: string[] }> };
/** The payment method types there are: the PaymentMethod object's `type` in the served spec. */
export const PAYMENT_METHOD_TYPES: readonly string[] = (surface.resources as Resource[]).find((r) => r.name === 'payment_method')?.fields.find((f) => f.name === 'type')?.enum ?? [];
/** The payment method types a Checkout Session takes: the vendored spec's (2026-09-30.endive) PostCheckoutSessions
 *  allowed_payment_method_types item enum, the parameter described as payment_method_types is ("A list of the types of
 *  payment methods (e.g., `card`) this Checkout Session can accept"). It holds no in-person type (card_present,
 *  interac_present) and no `custom`. The surface keeps no request enums, so it is copied here. */
export const CHECKOUT_METHOD_TYPES: readonly string[] = ['acss_debit', 'affirm', 'afterpay_clearpay', 'alipay', 'alma', 'amazon_pay', 'au_becs_debit', 'bacs_debit', 'bancontact', 'billie', 'bizum', 'blik', 'boleto', 'card', 'cashapp', 'crypto', 'customer_balance', 'eps', 'fpx', 'giropay', 'grabpay', 'ideal', 'kakao_pay', 'klarna', 'konbini', 'kr_card', 'link', 'mb_way', 'mobilepay', 'multibanco', 'naver_pay', 'nz_bank_account', 'oxxo', 'p24', 'pay_by_bank', 'payco', 'paynow', 'paypal', 'paypay', 'payto', 'pix', 'promptpay', 'revolut_pay', 'samsung_pay', 'satispay', 'scalapay', 'sepa_debit', 'sequra', 'sofort', 'sunbit', 'swish', 'twint', 'upi', 'us_bank_account', 'wechat_pay', 'zip'];
/** The create page each intent's refusal links to. */
export const TYPES_DOC: Record<string, string> = {
  payment_intents: 'https://stripe.com/docs/api/payment_intents/create#create_payment_intent-payment_method_types',
  setup_intents: 'https://stripe.com/docs/api/setup_intents/create#create_setup_intent-payment_method_types',
};

/** An enum's values as Stripe lists them in a refusal: "a, b, or c". */
export const oneOf = (values: readonly string[]): string => (values.length > 1 ? `${values.slice(0, -1).join(', ')}, or ${values.at(-1)}` : values.join(''));
