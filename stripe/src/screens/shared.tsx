// What Stripe's screens share (docs/contributing/architecture.md, "Pack layout": screens/shared.tsx): the skin over
// @volter/world-ui's consent piece for the flows where a person agrees to something (connected-account onboarding,
// identity verification, linking a bank), a page's form, and the card a customer types on Checkout and the portal.
export const STRIPE_CONSENT_SKIN = `
body { background: #f6f9fc; color: #1a1f36; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Ubuntu, sans-serif; }
.consent-badge { background: #ffffff; border: 1px solid #e3e8ee; color: #1a1f36; }
.consent-vendor { background: #635bff; border-color: #635bff; }
.consent-link { border-color: #c1c9d2; }
.consent-box { background: #ffffff; border-color: #e3e8ee; }
.consent-who small, .consent-permission summary small, .consent-note { color: #697386; }
.consent-actions { border-color: #e3e8ee; }
.consent-deny { background: #ffffff; border-color: #c1c9d2; color: #1a1f36; }
.consent-allow { background: #635bff; border-color: #635bff; color: #ffffff; }
`;

/** The form fields a page's POST carries, as a browser posts them. */
export async function formOf(request: Request): Promise<Record<string, string>> {
  return Object.fromEntries(new URLSearchParams(await request.text()));
}

export const seeOther = (location: string): Response => new Response(null, { status: 302, headers: { location } });

export const DECLINES: Record<string, string> = {
  '4000000000000002': 'Your card was declined.',
  '4000000000009995': 'Your card has insufficient funds.',
  '4000000000000069': 'Your card has expired.',
  '4000000000000127': "Your card's security code is incorrect.",
};

export const luhn = (digits: string): boolean => {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return digits.length >= 12 && sum % 10 === 0;
};

export const money = (minor: unknown, currency: unknown): string => {
  const c = typeof currency === 'string' ? currency.toUpperCase() : 'USD';
  const zeroDecimal = ['JPY', 'KRW', 'VND', 'CLP', 'ISK', 'UGX', 'XAF', 'XOF'].includes(c);
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: c }).format((Number(minor) || 0) / (zeroDecimal ? 1 : 100));
};

export const COUNTRIES = [['US', 'United States'], ['GB', 'United Kingdom'], ['CA', 'Canada'], ['DE', 'Germany'], ['FR', 'France'], ['AU', 'Australia'], ['JP', 'Japan']].map(([value, label]) => ({ value: value!, label: label! }));

/** Cards that are saved but decline when charged. */
export const DECLINES_WHEN_CHARGED: Record<string, string> = { '4000000000000341': 'Your card was declined.' };

/** The expiry as the customer typed it. Stripe's field formats itself as it is typed: the digits `1230` read `12 / 30`,
 *  and a first digit above 1 is a month on its own (`5` reads `05 / `), so a person types the digits straight through
 *  (Checkout's own field, seen on checkout.stripe.com; docs.stripe.com/payments/checkout names no format to type). The
 *  page's script (@volter/world-ui Payment, `format: 'card-expiry'`) shows it formatted; this reads what is posted either
 *  way: `MM / YY`, `MM/YYYY`, or the bare digits `MMYY`, `MYY` (`530`) and `MMYYYY`; a month past 12 is read, and refused
 *  as invalid by cardAnswer. */
export function parseExpiry(raw: string): { month: number; year: number } | undefined {
  const split = /^\s*(\d{1,2})\s*\/\s*(\d{2}|\d{4})\s*$/.exec(raw);
  const digits = raw.replace(/\s/g, '');
  const bare = split ? undefined : /^(\d{2})(\d{2}|\d{4})$/.exec(digits) ?? /^([2-9])(\d{2})$/.exec(digits);
  const m = split ?? bare;
  if (!m) return undefined;
  return { month: Number(m[1]), year: m[2]!.length === 2 ? 2000 + Number(m[2]) : Number(m[2]) };
}

/** The card's answer: undefined when it pays, else what Checkout says under the button. */
export function cardAnswer(v: Record<string, string>, nowSeconds: number, chargesNow: boolean): string | undefined {
  const digits = (v.cardNumber ?? '').replace(/\D/g, '');
  if (!digits) return 'Your card number is incomplete.';
  if (DECLINES[digits]) return DECLINES[digits];
  if (chargesNow && DECLINES_WHEN_CHARGED[digits]) return DECLINES_WHEN_CHARGED[digits];
  if (!luhn(digits)) return 'Your card number is invalid.';
  const exp = parseExpiry(v.cardExpiry ?? '');
  if (!exp) return "Your card's expiration date is incomplete.";
  const { month, year } = exp;
  if (month < 1 || month > 12) return "Your card's expiration date is invalid.";
  const now = new Date(nowSeconds * 1000);
  if (year < now.getUTCFullYear() || (year === now.getUTCFullYear() && month < now.getUTCMonth() + 1)) return "Your card's expiration year is in the past.";
  if (!/^\d{3,4}$/.test(v.cardCvc ?? '')) return "Your card's security code is incomplete.";
  return undefined;
}

/** Stripe's answer for a page of one of its hosts the twin does not serve. */
export const notFound = (): Response => new Response('Not Found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
