// Stripe's test_helpers operations (docs/contributing/architecture.md, "What an author writes"): each handler over the
// handler contract's context, computing with the engine (../engine/).
import type { HandlerContext } from '@volter/world-core';
import type { Row } from '../engine/common.ts';
import { AUTH, CARD, cardId, CH, historyEntry, holderId, merchantData, TXN } from '../engine/issuing.ts';
import { isValidApiVersion, nowUnix, spendingControlsViolation, TWIN_API_VERSION } from '../engine/stripe.ts';
import { stripeEventMatches } from '../engine/webhooks.ts';
import { answeredByEndpoint, approvedAtOnce, askForAuthorization, at, authMissing, balanceOf, capture, created, fail, issuingRefusal, withCard } from './shared.ts';
export async function PostTestHelpersIssuingAuthorizations(ctx: HandlerContext): Promise<Response> {
  const params = ctx.params;
  const card = typeof params.card === 'string' ? params.card : '';
  if (!card) return fail(ctx, 'Missing required param: card.', 400, 'parameter_missing');
  const c = ctx.get(CARD, card);
  if (!c) return fail(ctx, `No such card: '${card}'`, 400, 'resource_missing');
  if (params.amount === undefined) return fail(ctx, 'Missing required param: amount.', 400, 'parameter_missing');
  const amount = Math.trunc(Number(params.amount) || 0);
  const currency = String(params.currency ?? c.currency ?? 'usd');
  const createdSec = Number(nowUnix(ctx.occurredAt));
  const cardholderId = holderId(c);
  const merchant = merchantData(params.merchant_data);
  const isAmountControllable = params.is_amount_controllable === true;
  const authMethod = typeof params.authorization_method === 'string' ? params.authorization_method : 'online';
  if (!['chip', 'contactless', 'keyed_in', 'online', 'swipe'].includes(authMethod)) return issuingRefusal(ctx, 'authorization_method');
  const merchantAmount = params.merchant_amount !== undefined ? Math.trunc(Number(params.merchant_amount) || 0) : amount;
  const merchantCurrency = typeof params.merchant_currency === 'string' ? params.merchant_currency : currency;
  const authId = ctx.mint(AUTH);
  const baseFields: Row = {
    amount, amount_details: null, authorization_method: authMethod,
    balance_transactions: [], transactions: [],
    currency, fleet: null, fuel: null, livemode: false,
    merchant_amount: merchantAmount, merchant_currency: merchantCurrency, merchant_data: merchant,
    metadata: params.metadata && typeof params.metadata === 'object' ? params.metadata : {},
    network_data: null,
    verification_data: {
      address_line1_check: 'not_provided', address_postal_code_check: 'not_provided',
      authentication_exemption: null, cvc_check: 'match', expiry_check: 'match',
      postal_code: null, three_d_secure: null,
    },
    wallet: null,
  };
  const subject = { id: authId, card, cardholder: cardholderId };
  const entry = (o: { amount: number; approved: boolean; reason: string; reasonMessage: string | null }) => historyEntry({ ...o, currency, createdSec, merchantAmount, merchantCurrency });
  const decline = async (reason: string, reasonMessage: string | null) =>
    ctx.reply(withCard(ctx, await created(ctx, AUTH, subject, { ...baseFields, status: 'closed', approved: false, pending_request: null, request_history: [entry({ amount, approved: false, reason, reasonMessage })] })));
  if (c.status === 'canceled') return decline('card_canceled', 'The card has been canceled.');
  // source: https://docs.stripe.com/api/issuing/cards/create "Defaults to inactive"
  // source: spec:/components/schemas/issuing_authorization_request/properties/reason/enum "card_inactive"
  if (c.status !== 'active') return decline('card_inactive', 'The card is inactive.');
  // what earlier approved authorizations on the card (or cardholder) already spent, for the limits
  const prior = (key: 'card' | 'cardholder', value: string) =>
    ctx.rows(AUTH).filter((a) => a[key] === value && a.approved === true)
      .map((a) => ({ amount: Number(a.amount) || 0, created: Number(a.created) || 0, category: String((a.merchant_data as Row | undefined)?.category ?? '') }));
  const controlsOpts = { amount, category: String(merchant.category ?? ''), country: merchant.country == null ? null : String(merchant.country), nowSec: createdSec };
  const cardholderRow = cardholderId ? ctx.get(CH, cardholderId) : undefined;
  const violation =
    spendingControlsViolation(c.spending_controls, { ...controlsOpts, priorApproved: prior('card', card) }) ??
    spendingControlsViolation(cardholderRow?.spending_controls, { ...controlsOpts, priorApproved: prior('cardholder', cardholderId) });
  if (violation) return decline('spending_controls', violation);
  // an authorization is paid from the Issuing balance, and declined when it cannot cover it
  // (docs.stripe.com/issuing/funding/balance)
  if ((balanceOf(ctx).issuing.get(currency) ?? 0) < amount) return decline('insufficient_funds', 'Your Issuing balance does not have enough funds for this authorization.');
  const pendingRequest = {
    amount, amount_details: null, currency, is_amount_controllable: isAmountControllable,
    merchant_amount: merchantAmount, merchant_currency: merchantCurrency, network_risk_score: null,
  };
  const endpoint = ctx.rows('webhook_endpoint').find((w) => w.status === 'enabled' && stripeEventMatches(w.enabled_events, 'issuing_authorization.request'));
  // no real-time enrollment: "If you don't have a real-time authorization webhook, we approve the authorization without
  // sending the issuing_authorization.request" (docs.stripe.com/issuing/purchases/authorizations), its outcome
  // card_active, "approved according to your default Issuing settings"
  if (!endpoint) return approvedAtOnce(ctx, subject, baseFields, amount, entry({ amount, approved: true, reason: 'card_active', reasonMessage: null }));
  // the request event's authorization carries pending_request, non-null only during the request
  const requestObject = withCard(ctx, { object: 'issuing.authorization', id: authId, created: createdSec, ...baseFields, card, cardholder: cardholderId, status: 'pending', approved: false, pending_request: pendingRequest, request_history: [] });
  // the request asked of the endpoint and the stored event are one event under one id
  const pinned = ctx.call.request.headers.get('stripe-version');
  const requestEvent = {
    id: ctx.mint('event'), object: 'event', api_version: pinned && isValidApiVersion(pinned) ? pinned : TWIN_API_VERSION, created: createdSec,
    data: { object: requestObject }, livemode: false, pending_webhooks: 1, request: { id: null, idempotency_key: null }, type: 'issuing_authorization.request',
  };
  await ctx.write('event', requestEvent.id, requestEvent, 'event.record');
  const outcome = await askForAuthorization(ctx, String(endpoint.url), requestEvent, String(endpoint.secret ?? ''));
  // a request no one answered (the World refused the delivery, it failed, or it timed out) is not a decision: the
  // authorization stays pending with its request, for the deprecated approve or decline "within the timeout window of
  // the real-time authorization flow" (the served spec), until lapseRealtimeRequests decides it when the window ends
  if (outcome.kind === 'timeout') return ctx.reply(withCard(ctx, await created(ctx, AUTH, subject, { ...baseFields, status: 'pending', approved: false, request_history: [], pending_request: pendingRequest })));
  return answeredByEndpoint(ctx, outcome, { subject, fields: baseFields, amount, controllable: isAmountControllable, entry, decline });
}
export async function PostTestHelpersIssuingAuthorizationsAuthorizationCapture(ctx: HandlerContext): Promise<Response> {
  const id = at(ctx, 'authorization');
  const auth = ctx.get(AUTH, id);
  if (!auth) return authMissing(ctx, id);
  if (auth.approved !== true || auth.status !== 'pending') return issuingRefusal(ctx, 'not_capturable', auth);
  const closeAuthorization = ctx.params.close_authorization !== false;
  const refused = ctx.legal(AUTH, 'status', 'PostTestHelpersIssuingAuthorizationsAuthorizationCapture', auth.status, closeAuthorization ? 'closed' : 'pending');
  if (refused) return ctx.refuse(refused);
  const txns = Array.isArray(auth.transactions) ? auth.transactions : [];
  const capturedSoFar = txns.map((t) => ctx.get(TXN, String(t))).reduce((s, t) => s + Math.abs(Number(t?.amount) || 0), 0);
  const remaining = (Number(auth.amount) || 0) - capturedSoFar;
  const captureAmount = ctx.params.capture_amount !== undefined ? Math.trunc(Number(ctx.params.capture_amount) || 0) : remaining;
  if (captureAmount <= 0 || captureAmount > remaining) return fail(ctx, 'Invalid capture_amount: must be a positive integer no greater than the uncaptured authorized amount.', 400, 'parameter_invalid_integer');
  // the capture releases what the approval held and debits the transaction; a capture that closes the authorization
  // releases ALL it still holds, the uncaptured rest included: the amount is held "until the authorization is either
  // captured, voided, or expired without capture" (docs.stripe.com/issuing/purchases/authorizations), and a closed
  // authorization can be captured no further (close_authorization "Defaults to true. Set to false to enable
  // multi-capture flows", the served spec). A capture that keeps it open releases only what it captured.
  const currency = typeof auth.currency === 'string' ? auth.currency : 'usd';
  const released = closeAuthorization ? remaining : captureAmount;
  const release = await created(ctx, 'balance_transaction', {}, {
    amount: released, currency, fee: 0, net: released, type: 'issuing_authorization_release',
    status: 'available', balance_type: 'issuing', reporting_category: 'issuing_authorization_release',
    available_on: nowUnix(ctx.occurredAt), fee_details: [], source: id,
  });
  const captured = await capture(ctx, id, { ...auth, card: cardId(auth) }, captureAmount);
  return ctx.reply(withCard(ctx, await ctx.write(AUTH, id, {
      status: closeAuthorization ? 'closed' : 'pending',
      transactions: [...txns, captured.txnId],
      balance_transactions: [...(Array.isArray(auth.balance_transactions) ? auth.balance_transactions : []), release.id, captured.btId],
    }, 'issuing_authorization.updated'),
  ));
}
