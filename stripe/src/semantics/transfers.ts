// Stripe's transfers operations (docs/contributing/architecture.md, "What an author writes"): each handler over the
// handler contract's context, computing with the engine (../engine/).
import type { HandlerContext } from '@volter/world-core';
import type { Row } from '../engine/common.ts';
import { nowUnix, validateMoney } from '../engine/stripe.ts';
import { emptyList } from '../engine/transfers.ts';
import { created, fail, refusePayout, send, settledSourceRefused, settleTransfer, transfersInactive } from './shared.ts';
export async function PostTransfers(ctx: HandlerContext): Promise<Response> {
  const bad = validateMoney(ctx.params);
  if (bad) return send(ctx, bad);
  const destination = typeof ctx.params.destination === 'string' ? ctx.params.destination : '';
  if (!destination) return fail(ctx, 'Missing required param: destination.', 400, 'parameter_missing');
  const account = ctx.get('account', destination);
  if (!account) return fail(ctx, `No such destination: '${destination}'`, 400, 'resource_missing');
  if (((account.capabilities as Row | undefined)?.transfers) !== 'active') return transfersInactive(ctx);
  const amount = Math.trunc(Number(ctx.params.amount) || 0);
  const currency = String(ctx.params.currency ?? 'usd');
  const sourceId = typeof ctx.params.source_transaction === 'string' ? ctx.params.source_transaction : undefined;
  let availableOn: number | undefined;
  let group: string | undefined;
  if (sourceId) {
    const charge = ctx.get('charge', sourceId);
    if (!charge) return fail(ctx, `No such charge: '${sourceId}'`, 400, 'resource_missing');
    if (charge.status !== 'succeeded') return fail(ctx, `The source_transaction ${sourceId} has not succeeded.`, 400, 'invalid_request_error');
    // an authorization holds no funds to transfer
    if (charge.captured === false) return fail(ctx, `The source_transaction ${sourceId} has not been captured; capture it before transferring its funds.`, 400);
    if (String(charge.currency ?? 'usd') !== currency) return fail(ctx, `The currency of source_transaction ${sourceId} (${String(charge.currency)}) does not match the transfer's (${currency}).`, 400, 'invalid_request_error');
    const already = ctx.rowsRaw('transfer').filter((t) => t.source_transaction === sourceId).reduce((sum, t) => sum + (Number(t.amount) || 0) - (Number(t.amount_reversed) || 0), 0);
    if (already + amount > Number(charge.amount ?? 0)) return fail(ctx, `The transfers from source_transaction ${sourceId} would exceed its amount (${String(charge.amount)}).`, 400, 'invalid_request_error');
    const bt = typeof charge.balance_transaction === 'string' ? ctx.get('balance_transaction', charge.balance_transaction) : undefined;
    // a charge that has settled waives nothing: the transfer comes out of what is available
    const settledRefusal = bt && Number(bt.available_on) <= Number(nowUnix(ctx.occurredAt)) ? settledSourceRefused(ctx, amount, currency) : undefined;
    if (settledRefusal) return settledRefusal;
    availableOn = Math.max(Number(nowUnix(ctx.occurredAt)), Number(bt?.available_on) || 0);
    group = typeof charge.transfer_group === 'string' ? charge.transfer_group : typeof charge.payment_intent === 'string' ? `group_${charge.payment_intent}` : undefined;
    // the generated group is the charge's too
    if (group && charge.transfer_group !== group) await ctx.write('charge', sourceId, { transfer_group: group }, 'charge.transfer_group_assigned');
  } else {
    const refused = refusePayout(ctx, amount, currency, undefined);
    if (refused) return refused;
  }
  const id = ctx.mint('transfer');
  const bt = await settleTransfer(ctx, id, amount, currency, destination, availableOn, sourceId !== undefined);
  return ctx.reply(
    await created(ctx, 'transfer', { id, ...ctx.params, ...(group ? { transfer_group: group } : {}) }, {
      amount_reversed: 0, balance_transaction: bt, livemode: false, metadata: {},
      reversed: false, source_type: 'card', source_transaction: null,
      reversals: emptyList(`/v1/transfers/${id}/reversals`),
      destination_payment: `py_${id.replace(/^tr_/, '')}`,
    }),
  );
}
