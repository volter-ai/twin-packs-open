// Stripe's balance_transactions operations (docs/contributing/architecture.md, "What an author writes"): each handler over the
// handler contract's context, computing with the engine (../engine/).
import type { HandlerContext } from '@volter/world-core';
import { inRange } from '../engine/common.ts';
import { BT } from '../engine/ledger.ts';
import { commonAsOf, kept, list, mine, newest, where } from './shared.ts';
export async function GetBalanceTransactions(ctx: HandlerContext): Promise<Response> {
  const own = mine(ctx);
  return list(ctx, BT, where(ctx, newest(ctx, BT).filter((t) => own.has(t.id)).map((t) => commonAsOf(ctx, t)), {
    type: (t, v) => t.type === v,
    currency: (t, v) => t.currency === v,
    source: (t, v) => t.source === v,
    // an automatic payout lists the entries it paid out, its own debit among them
    payout: (t, v) => t.source === v || kept(ctx, BT, t, '_payout') === v,
    // a range of creation times (docs.stripe.com/api/balance_transactions/list#balance_transaction_list-created)
    created: (t, v) => inRange(t.created, v),
  }));
}
