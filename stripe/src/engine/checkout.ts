// Checkout Session semantics. The machine in ../manifest.ts says an open session expires or
// completes and nothing else does. Stripe completes a session when the customer pays on its hosted
// page (src/screens/checkout.tsx, the session's url), which has no API verb; completing links what
// the payment made: a succeeded PaymentIntent, an active (or
// trialing) subscription, or a succeeded SetupIntent. List and retrieve are the derived core's.
import type { Row } from './common.ts';
export const CS = 'checkout.session';

/** The payment method types a session takes: the list a caller pinned to an earlier version gives as
 *  payment_method_types ("A list of the types of payment methods (e.g., `card`) this Checkout Session can accept", the
 *  parameter the served version's allowed_payment_method_types is described against: "Unlike `payment_method_types`,
 *  this acts as a filter on the dynamically computed set of eligible payment methods", docs.stripe.com/api/checkout/
 *  sessions/create), else the allowed_payment_method_types of the served one, else card. Where the documentation stops
 *  and the twin decides: an allowed list is answered whole (the twin does not compute eligibility), and without one the
 *  session takes card (the account's enabled methods are not modelled). */
export function sessionMethodTypes(params: Row): string[] {
  const given = Array.isArray(params.payment_method_types) ? params.payment_method_types : params.allowed_payment_method_types;
  return Array.isArray(given) && given.length ? given.map(String) : ['card'];
}

/** Metadata passed on to what a session makes (payment_intent_data[metadata], subscription_data[metadata]) as a
 *  create's own is kept: "Individual keys can be unset by posting an empty value to them. All keys can be unset by
 *  posting an empty value to `metadata`" (every metadata parameter, docs.stripe.com/api/metadata), so a key posted
 *  empty is not set, and metadata posted empty is {} (./front.ts createMetadata, the top-level case). */
export function nestedMetadata(given: unknown): Row | undefined {
  if (given === '') return {};
  if (!given || typeof given !== 'object' || Array.isArray(given)) return undefined;
  return Object.fromEntries(Object.entries(given as Row).filter(([, v]) => v !== ''));
}

/** The card the customer entered on the page. */
export type EnteredCard = { number: string; exp_month: number; exp_year: number };

/** A line item of a one-time Price: a stored Price, or an inline `price_data`, without `recurring` ("Line items with
 *  one-time Prices will be on the initial invoice only", docs.stripe.com/api/checkout/sessions/create). */
export function isOneTime(item: Row, priceData?: Row | null): boolean {
  if (priceData) return !priceData.recurring;
  return !!item.price && typeof item.price === 'object' && !(item.price as Row).recurring;
}
