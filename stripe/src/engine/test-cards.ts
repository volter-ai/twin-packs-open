// Stripe's test cards whose funds bypass the pending balance, by their test names and numbers
// (docs.stripe.com/testing#available-balance: "Funds are added directly to your available balance, bypassing your
// pending balance"). A leaf: ledger.ts reads it to settle a charge, after-payment.ts to record it on a PaymentMethod.
export const BYPASS_PENDING_CARDS: Record<string, { brand: string; number: string }> = {
  pm_card_bypassPending: { brand: 'visa', number: '4000000000000077' },
  pm_card_bypassPendingInternational: { brand: 'visa', number: '4000003720000278' },
};
