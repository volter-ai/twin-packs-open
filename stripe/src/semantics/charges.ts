// Stripe's charges operations (docs/contributing/architecture.md, "What an author writes"): each handler over the
// handler contract's context, computing with the engine (../engine/).
import type { HandlerContext } from '@volter/world-core';
import { at, chargeBody, chargeMissing, expanded, list, newest, where } from './shared.ts';
export async function GetCharges(ctx: HandlerContext): Promise<Response> {
  const items = where(ctx, newest(ctx, 'charge'), {
    customer: (c, v) => c.customer === v,
    payment_intent: (c, v) => c.payment_intent === v,
  });
  return list(ctx, 'charge', items.map((c) => chargeBody(ctx, c)));
}

export async function GetChargesCharge(ctx: HandlerContext): Promise<Response> {
  const c = ctx.get('charge', at(ctx, 'charge'));
  return c ? ctx.reply(expanded(ctx, 'charge', chargeBody(ctx, c))) : chargeMissing(ctx, at(ctx, 'charge'));
}
