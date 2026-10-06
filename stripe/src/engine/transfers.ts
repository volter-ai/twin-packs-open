// Transfer and application-fee semantics: money the platform moves to a connected account and
// claws back (reversals), and the platform's fee on a connected charge and its refunds. A
// reversal or fee refund never exceeds what is left, and lands on its parent's totals and list.
// A transfer goes only to an account whose transfers capability is active, comes out of the
// platform's available balance, and lands in the destination's (docs.stripe.com/connect/separate-
// charges-and-transfers); a reversal moves it back.
// A transfer tied to a charge (`source_transaction`, "Transfer availability" in the same guide) "returns success
// regardless of your available balance if the related charge hasn't settled yet", but "the funds don't become
// available in the destination account until the funds from the associated charge are available"; a charge whose funds
// are already available by the World's clock is no exception, and the transfer is held to the available balance as any
// other. "The amount of the transfer must not exceed the amount of the source charge", several transfers may share one
// charge while "the sum of the transfers doesn't exceed the source charge", and the charge's balance currency must
// match. "If the source charge has a `transfer_group` value, Stripe assigns the same value to the transfer's
// `transfer_group`. If it doesn't, then Stripe generates a string in the format `group_` plus the associated
// PaymentIntent ID ... It assigns that string as the `transfer_group` for both the charge and the transfer."
// Where the documentation stops and the twin decides: the sum from one charge counts each transfer less what was
// reversed of it; a transfer_group the request names is kept only when the charge has none and no PaymentIntent to
// name one after; an uncaptured charge (an authorization, docs silent) is refused as a source_transaction until it is
// captured; the refusals' wording is the twin's.
// Transfer list, retrieve and update and application-fee list and retrieve are the derived core's.
import type { Row } from './common.ts';
export const emptyList = (url: string): Row => ({ object: 'list', data: [], has_more: false, total_count: 0, url });
