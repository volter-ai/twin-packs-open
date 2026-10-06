// Stripe's balance ledger (docs.stripe.com/api/balance_transactions): every movement of the account's money writes
// a balance transaction, and the balance is their sum. A captured charge adds its amount less Stripe's fee, pending
// until its available_on; a refund takes its amount back at once; a payout takes its amount out of what is available
// and is refused beyond it (balance_insufficient). A transaction's status is what the World clock says of its
// available_on (the machine's time move, pending → available), so a `wait` in a story settles funds as time does.
//
// Where the documentation stops and the twin decides: the fee is Stripe's standard US card pricing, 2.9% + 30¢
// (stripe.com/pricing), for every charge; funds become available two days after capture (Stripe's standard US
// payout schedule counts business days).
//
// Test mode (the twin serves livemode: false), as docs.stripe.com/testing documents it:
// - cards keep that delay but two: "Other test cards send funds from a successful payment to your pending balance",
//   while 4000000000000077 and 4000003720000278 (and their test names pm_card_bypassPending,
//   pm_card_bypassPendingInternational, tok_bypassPending, tok_bypassPendingInternational) "succeed. Funds are added
//   directly to your available balance, bypassing your pending balance" (#available-balance; test-cards.ts). A
//   PaymentMethod made from one keeps that (payment-methods.ts, after-payment.ts), so a saved card charged later by
//   id bypasses too;
// - a US bank account debit: "Test transactions settle instantly and are added to your available test balance. This
//   behavior differs from live mode" (ACH Direct Debit, "Test settlement behavior");
// - a source_transaction transfer "takes on the pending status of the associated charge"
//   (docs.stripe.com/connect/separate-charges-and-transfers), so it is available at once when its charge is;
// - "Test payouts simulate a live payout but aren't processed with the bank" (docs.stripe.com/payouts#test-payouts):
//   the payout clock (semantics/balance.ts) is live's.
// No other test-mode speed-up is documented, so 4242 4242 4242 4242 funds sit pending the two days.
//
// Where the documentation stops and the twin decides: every credit written available at once (a bypass or bank-debit
// charge, a transfer, a transfer from such a charge, an application fee, a top-up, an Issuing top-up included, a reversal) is marked not yet
// sent, and the drain sends its account balance.available for it ("Occurs whenever your Stripe balance has been
// updated (e.g., when a charge is available to be paid out). ... This event is not fired for negative
// transactions", docs.stripe.com/api/events/types), as it does for funds that came due after the delay. The Balance
// it carries is the account's at the drain: a debit or an automatic payout landing first shows in it.
//
// Each connected account keeps its own balance (docs.stripe.com/connect/account-balances): a transaction belongs to
// the account the request acts for (the Stripe-Account header), else to the platform. A transfer takes its amount out
// of the platform's available balance and adds it to the destination's; a destination charge transfers its amount
// less the application fee, available when the charge's funds are; a direct charge's application fee moves from the
// connected account to the platform.
import type { Row } from './common.ts';
import { BYPASS_PENDING_CARDS } from './test-cards.ts';
export const BT = 'balance_transaction';
/** A ledger entry's mark: available at once, its balance.available not yet sent (settleDueEntries). */
export const UNSENT = '_availableUnsent';
export const BYPASS_NUMBERS = new Set(Object.values(BYPASS_PENDING_CARDS).map((c) => c.number));

export const feeOf = (amount: number): number => (amount > 0 ? Math.round(amount * 0.029) + 30 : 0);

/** Whether a stored ledger entry is on this account's balance (undefined: the platform's). */
export const onAccount = (t: Row, account: string | undefined): boolean => (typeof t._account === 'string' ? t._account : undefined) === account;
