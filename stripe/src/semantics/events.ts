// Stripe's Events API (the events family: the account's stored events, which the kernel keeps as each is sent), and how
// Stripe renders the events its writes send (`data` and `values`, bound in the manifest's `events`).
import type { EventWrite, WriteHookContext } from '@volter/world-core';
import { isValidApiVersion, PLATFORM_ACCOUNT_ID, TWIN_API_VERSION } from '../engine/stripe.ts';
import { render } from '../engine/version.ts';
// ── the events Stripe's writes send (the manifest's `events`: ./shared.ts STRIPE_EVENTS) ──

/** An event's `data`: the object the write concerns, as Stripe sends it in the event's API version. An Issuing
 *  authorization carries its full card; the balance notice the drain writes carries the account's Balance. */
export function data(ctx: WriteHookContext, write: EventWrite): Record<string, unknown> {
  const object = write.storedType === '_balance_notice' ? (write.body.balance as Record<string, unknown>)
    : write.storedType === 'issuing_authorization' ? ctx.expand('issuing.authorization', write.body)
    : write.storedType === 'issuing_card' ? ctx.expand('issuing.card', write.body) : ctx.expand(String(write.body.object ?? write.storedType), write.body);
  return { object: render(object, eventVersion(write)) as Record<string, unknown> };
}

/** An event's further envelope values: the connected account it is about ("Each event for a connected account contains
 *  a top-level `account` property that identifies the connected account", docs.stripe.com/connect/webhooks) — the
 *  account a request acts as (Stripe-Account), a connected account's own account.updated, or the account whose books the
 *  written row is kept on (its `_account`) — and the API version it is rendered in. A connected account whose OAuth
 *  connection was revoked "can't be accessed by your platform" (docs.stripe.com/connect/oauth-reference): its events are
 *  kept but no longer sent (`$send: false`), except the account.application.deauthorized that says so. */
export function values(ctx: WriteHookContext, write: EventWrite, type: string): Record<string, unknown> {
  const id = write.body.id;
  const kept = typeof id === 'string' ? ctx.rowsRaw(write.storedType, { withDeleted: true }).find((r) => r.id === id)?._account : undefined;
  const account = write.request?.headers.get('stripe-account')
    ?? (write.storedType === 'account' && typeof id === 'string' && id !== PLATFORM_ACCOUNT_ID ? id : undefined)
    ?? (write.storedType === '_balance_notice' && typeof write.body.account === 'string' ? write.body.account : undefined)
    ?? (typeof kept === 'string' ? kept : undefined);
  return { $account: account, $version: eventVersion(write) };
}

/** The API version an event is rendered in: the one the writing request pinned, when it is one, else the served one. */
const eventVersion = (write: EventWrite): string => {
  const pinned = write.request?.headers.get('stripe-version');
  return pinned && isValidApiVersion(pinned) ? pinned : TWIN_API_VERSION;
};
