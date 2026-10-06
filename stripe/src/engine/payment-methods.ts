// PaymentMethod semantics: a PaymentMethod is created detached, attached to a customer, and
// detached again. The list is the derived core's.
import { paymentMethodSubObject } from './stripe.ts';
import { AFTER_SUCCESS_CARDS } from './after-payment.ts';
import type { Row } from './common.ts';
export const PM = 'payment_method';
export const noBilling = { address: null, email: null, name: null, phone: null };

export const TEST_PM_CARDS: Record<string, { brand: string; number: string }> = {
  ...AFTER_SUCCESS_CARDS,
  pm_card_mastercard: { brand: 'mastercard', number: '5555555555554444' },
  pm_card_amex: { brand: 'amex', number: '378282246310005' },
  pm_card_discover: { brand: 'discover', number: '6011111111111117' },
};

/** Attach a payment method to a customer (both known to exist or be attachable): a stored one moves to the
 *  customer; a test name mints a new PaymentMethod on the customer carrying that card's outcome. */
/** The card a test name (pm_card_*, tok_*) stands for, never stored as a PaymentMethod (docs.stripe.com/testing#cards). */
export function testCardOf(ref: string): Row | undefined {
  const name = ref.replace(/^tok_/, 'pm_card_');
  if (!name.startsWith('pm_card_')) return undefined;
  const test = TEST_PM_CARDS[name] ?? { brand: 'visa', number: '4242424242424242' };
  return { ...(paymentMethodSubObject('card', { card: { number: test.number } }).card as Row), brand: test.brand };
}
