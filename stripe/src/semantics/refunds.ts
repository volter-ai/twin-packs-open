import { type HandlerContext } from '@volter/world-core';
import { refundCharge, target } from './shared.ts';
export async function PostRefunds(ctx: HandlerContext): Promise<Response> {
  const ch = target(ctx);
  return ch instanceof Response ? ch : refundCharge(ctx, ch, ctx.params);
}
