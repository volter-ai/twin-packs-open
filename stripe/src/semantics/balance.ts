// Stripe's balance operations (docs/contributing/architecture.md, "What an author writes"): each handler over the
// handler contract's context, computing with the engine (../engine/).
import type { HandlerContext } from '@volter/world-core';
import { balanceBody } from './shared.ts';
export async function GetBalance(ctx: HandlerContext): Promise<Response> {
  return ctx.reply(balanceBody(ctx));
}
