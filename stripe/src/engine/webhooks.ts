// Stripe's events as its handlers and its declared `events` need them (the kernel renders, stores, signs and delivers
// every event a write sends: ../manifest.ts `events`, ../semantics/shared.ts STRIPE_EVENTS): which write sends which
// event type, Stripe's own event types (the spec's list, ../generated/events.gen.json), and the one message Stripe decides
// by its receiver's answer, the real-time authorization request.
import { hmac } from '@volter/world-core';
import vendorEvents from '../generated/events.gen.json' with { type: 'json' };
/** Every event type Stripe's spec enumerates: a write whose operation is one sends it, and `<resource>.create`,
 *  `.update` and `.delete` send `<resource>.created`, `.updated` and `.deleted` when Stripe has that type. */
export const STRIPE_EVENT_TYPES: ReadonlyArray<string> = (vendorEvents as { types: string[] }).types;

/** The writes whose event is named otherwise than by their resource (the rest are STRIPE_EVENT_TYPES'). A refund sends
 *  `refund.created` for the Refund; the charge's own write is recorded as `charge.refunded`, the charge with its new
 *  totals. `issuing_authorization.request` is no write's: it is asked of the endpoint (askForAuthorization). */
export const NAMED_EVENTS: Record<string, string> = {
  'payment_intent.confirm': 'payment_intent.succeeded',
  'payment_method.attach': 'payment_method.attached',
  'payment_method.detach': 'payment_method.detached',
  'setup_intent.confirm': 'setup_intent.succeeded',
  'subscription.create': 'customer.subscription.created',
  'subscription.update': 'customer.subscription.updated',
  'subscription.cancel': 'customer.subscription.deleted',
  'invoice.finalize': 'invoice.finalized',
  'invoice.pay': 'invoice.paid',
  'invoice.void': 'invoice.voided',
  'dispute.create': 'charge.dispute.created',
};

/** Whether an endpoint's `enabled_events` takes a type: `*` takes all, `<family>.*` the family, else the type itself. */
export function stripeEventMatches(enabledEvents: unknown, type: string): boolean {
  if (!Array.isArray(enabledEvents)) return false;
  return enabledEvents.some((p) => {
    const s = String(p);
    return s === '*' || (s.endsWith('.*') && type.startsWith(s.slice(0, -1))) || s === type;
  });
}

/** A `Stripe-Signature` header: HMAC-SHA256 over `${timestamp}.${payload}` keyed by the endpoint's secret, as
 *  `t=<unix>,v1=<hex>` (docs.stripe.com/webhooks#verify-manually). */
export const stripeSignature = (payload: string, secret: string, timestamp: number): string => `t=${timestamp},v1=${hmac(secret, `${timestamp}.${payload}`)}`;

// ── Real-time authorization (issuing_authorization.request) ──────────────────────────────────────
// Stripe delivers issuing_authorization.request to the one enrolled endpoint while the card network holds the
// authorization open, and the endpoint must answer within Stripe's 2-second window ("This request should be made within
// the timeout window of the real-time authorization flow", stripe@22.3.0 Issuing/Authorizations.d.ts; the current method
// is to "respond directly to the webhook request to approve an authorization"). The answer's body carries the decision:
// a JSON object with a boolean `approved` (and, for an amount-controllable request, an optional integer `amount`).
// Outcomes map onto request_history.reason (stripe@22.3.0 RequestHistory.Reason): webhook_approved / webhook_declined,
// the endpoint answered in time; webhook_timeout, no answer inside the window (an unreachable endpoint too);
// webhook_error, "the direct webhook response is invalid (for example, parsing errors or missing parameters)": a
// non-2xx status, a body that is not JSON, or no `approved`.
export const STRIPE_REALTIME_AUTH_TIMEOUT_MS = 2_000;

export type StripeAuthRequestOutcome =
  | { kind: 'approved'; amount?: number }
  | { kind: 'declined' }
  | { kind: 'timeout'; message: string }
  | { kind: 'error'; message: string };

/** The endpoint's answer read as the decision: `approved` (and an optional `amount`), or an error for an answer Stripe
 *  cannot read. */
export function readDecision(res: { status: number; body: string }): StripeAuthRequestOutcome {
  if (res.status < 200 || res.status >= 300) return { kind: 'error', message: `Webhook endpoint responded with HTTP status ${res.status}.` };
  let parsed: unknown;
  try { parsed = JSON.parse(res.body); } catch { return { kind: 'error', message: 'Webhook response body was not valid JSON.' }; }
  const approved = (parsed as { approved?: unknown } | null)?.approved;
  if (typeof approved !== 'boolean') return { kind: 'error', message: 'Webhook response is missing the required `approved` parameter.' };
  if (!approved) return { kind: 'declined' };
  const amount = (parsed as { amount?: unknown }).amount;
  return { kind: 'approved', ...(typeof amount === 'number' && Number.isInteger(amount) && amount > 0 ? { amount } : {}) };
}
