// Issuing semantics: cardholders, cards, authorizations, transactions, disputes, network tokens and
// personalization designs. An authorization's `card` is the full Card in every answer and webhook
// (the manifest's write hook embeds it on writes; reads embed it here). The machines in
// ../manifest.ts say how authorizations, disputes, cards, cardholders, tokens and designs move.
//
// The test-helper routes here (/v1/test_helpers/issuing/…) are Stripe's own doors for what no API
// verb makes: a card presented at a merchant, a capture, a force capture, a design's review. A
// presented authorization is decided in Stripe's order: card status, then spending controls
// (card, then cardholder), then the real-time issuing_authorization.request webhook delivered
// synchronously to the first enrolled endpoint; with none it is approved (card_active).
import type { Row } from './common.ts';
export const CH = 'issuing.cardholder';
/** The id of a card's cardholder: the card answers the cardholder in full (the served spec's issuing.card.cardholder is
 *  the Cardholder object, not an id); its id is read from it for filtering and for the objects that name it by id. */
export const holderId = (c: Row): string => (typeof c.cardholder === 'string' ? c.cardholder : String((c.cardholder as Row | undefined)?.id ?? ''));
export const CARD = 'issuing.card';
export const AUTH = 'issuing.authorization';
export const TXN = 'issuing.transaction';

/** One request_history entry; the authorization code is derived from the request time (Stripe's is not unique either). */
export function historyEntry(o: { amount: number; currency: string; approved: boolean; reason: string; reasonMessage: string | null; createdSec: number; merchantAmount: number; merchantCurrency: string }): Row {
  return {
    amount: o.amount, amount_details: null, approved: o.approved,
    authorization_code: o.approved ? `S${String(100000 + (o.createdSec % 900000))}` : null,
    created: o.createdSec, currency: o.currency,
    merchant_amount: o.merchantAmount, merchant_currency: o.merchantCurrency,
    network_risk_score: null, reason: o.reason, reason_message: o.reasonMessage,
    requested_at: o.createdSec,
  };
}

/** The test helper's default merchant, under any merchant_data the caller gives. */
export function merchantData(param: unknown): Row {
  const base: Row = {
    category: 'general', category_code: '5399', city: 'San Francisco', country: 'US',
    name: 'Twin Test Merchant', network_id: '1234567890', postal_code: '94103', state: 'CA',
    tax_id: null, terminal_id: null, url: null,
  };
  if (param && typeof param === 'object' && !Array.isArray(param)) Object.assign(base, param);
  return base;
}

/** The card's stored id (an embedded card answers with its id). */
export const cardId = (auth: Row): unknown => (auth.card && typeof auth.card === 'object' ? (auth.card as Row).id : auth.card);

/** The real-time window: "If Stripe doesn't receive your approve or decline response within 2 seconds, the
 *  Authorization is automatically approved or declined based on your timeout settings"
 *  (docs.stripe.com/issuing/controls/real-time-authorizations). */
export const REALTIME_WINDOW_SECONDS = 2;

/** A virtual card's number, drawn from the World: a 16-digit Visa number ("The brand of the card": the twin issues
 *  Visa) whose last digit is the Luhn check digit every card number carries. Where the documentation stops and the twin
 *  decides: the digits are the World's draw, Stripe's are the issuer's. */
export function cardNumberOf(drawn: string): string {
  const body = `4${[...drawn].map((ch) => String(ch.charCodeAt(0) % 10)).join('').padEnd(14, '0').slice(0, 14)}`;
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    let d = Number(body[body.length - 1 - i]);
    if (i % 2 === 0) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return `${body}${(10 - (sum % 10)) % 10}`;
}

/** A virtual card's CVC, drawn from the World: three digits. */
export const cvcOf = (drawn: string): string => [...drawn].map((ch) => String(ch.charCodeAt(0) % 10)).join('').padEnd(3, '0').slice(0, 3);
