// PaymentIntent semantics. The machine in ../manifest.ts says which moves of `status` are legal and
// what Stripe answers otherwise; these handlers compute what each move does. List, retrieve and
// update are the derived core's; search is Stripe's query language over the intents.
import type { Row } from './common.ts';
export const PI = 'payment_intent';
/** Bookkeeping: the intents whose caller named the methods (payment_method_types, allowed_payment_method_types) on
 *  create. The twin's default list (['card']) stands for Stripe's choice and restricts nothing, so only a named list
 *  refuses a confirm with a method of another type. Kept apart from the intent: a `_` subject is never pushed
 *  (world-core isTwinBookkeeping). */
export const TYPES_GIVEN = '_payment_intent_types_given';

// ── THE MONEY MODEL, continued: a succeeded intent has a Charge ──
//
// Real Stripe always materializes a Charge when a PaymentIntent succeeds and points the intent's
// `latest_charge` at it: the charge is what a refund lands on, so an intent that succeeds without
// one cannot answer "refund this payment" at all. Idempotent against a repeated confirm: an intent
// that already names a successful charge keeps it (a second one would double the money collected); a
// declined attempt's failed charge is history, and the payment that succeeds makes its own. The id is
// returned so the caller folds `latest_charge` into the same intent write (one write, one event). The
// charge is written as the event Stripe sends for it, `charge.succeeded` ("Occurs whenever a charge is
// successful", docs.stripe.com/api/events/types); Stripe has no `charge.created`.
/** What every charge an intent makes carries of it: its transfer_group, which "identifies the resulting payment as part
 *  of a group" (docs.stripe.com/api/payment_intents/object), its description and its metadata. */
export function intentCarries(pi: Row): Row {
  return {
    ...(typeof pi.transfer_group === 'string' ? { transfer_group: pi.transfer_group } : {}),
    ...(typeof pi.description === 'string' ? { description: pi.description } : {}),
    // "When a PaymentIntent creates a Charge, the metadata copies to the Charge in a one-time snapshot"
    // (docs.stripe.com/metadata, "Copy metadata to another object")
    ...(pi.metadata && typeof pi.metadata === 'object' ? { metadata: { ...(pi.metadata as Row) } } : {}),
  };
}
