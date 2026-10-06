// What Stripe does itself once a payment succeeds, which no API call asks for:
// - a test card that is disputed opens a dispute on its charge (docs.stripe.com/testing#disputes: 4000000000000259
//   "charge succeeds, then disputed as fraudulent", 4000000000002685 disputed as product not received,
//   4000000000001976 an inquiry), and Stripe debits the disputed
//   amount and its dispute fee from the balance (docs.stripe.com/disputes/how-disputes-work);
// - a test card Radar scores as elevated risk opens a review of its charge (docs.stripe.com/testing#fraud-prevention:
//   4000000000009235, "elevated risk", which Radar places in review; docs.stripe.com/radar/reviews);
// - a charge a platform makes with `application_fee_amount` earns the platform an application fee, from the connected
//   account it pays (a destination charge's `transfer_data.destination`, or the account a direct charge is made on;
//   docs.stripe.com/connect/destination-charges, docs.stripe.com/connect/direct-charges);
// - a bank account verified by micro-deposits for a payment or a setup carries a mandate, the customer's acceptance
//   of debits (docs.stripe.com/payments/ach-direct-debit/accept-a-payment, docs.stripe.com/api/mandates).
//
// Where the documentation stops and the twin decides: evidence is due seven days after a dispute opens (Stripe's
// deadline depends on the card network); the dispute fee is 1500 cents in any currency (Stripe's US fee is $15); an
// elevated-risk review's risk score is 67 (Radar's elevated band); the application is `ca_twin`.
import { BYPASS_PENDING_CARDS } from './test-cards.ts';
export type Outcome = 'dispute' | 'dispute_not_received' | 'inquiry' | 'review' | 'available';

/** The test cards whose success Stripe follows with its own act, by number and by their documented test names. */
export const AFTER_SUCCESS_CARDS: Record<string, { brand: string; number: string; outcome: Outcome }> = {
  pm_card_createDispute: { brand: 'visa', number: '4000000000000259', outcome: 'dispute' },
  pm_card_createDisputeProductNotReceived: { brand: 'visa', number: '4000000000002685', outcome: 'dispute_not_received' },
  pm_card_createDisputeInquiry: { brand: 'visa', number: '4000000000001976', outcome: 'inquiry' },
  pm_card_riskLevelElevated: { brand: 'visa', number: '4000000000009235', outcome: 'review' },
  // its funds go straight to the available balance (ledger.ts reads it; no act follows here)
  ...Object.fromEntries(Object.entries(BYPASS_PENDING_CARDS).map(([name, c]) => [name, { ...c, outcome: 'available' as const }])),
};
export const BY_NUMBER: Record<string, Outcome> = Object.fromEntries(Object.values(AFTER_SUCCESS_CARDS).map((c) => [c.number, c.outcome]));
