import type { HandlerContext } from '@volter/world-core';
import { codexGrant } from './shared.ts';
export async function around(ctx: HandlerContext, next: (request?: Request) => Promise<Response>): Promise<Response> {
  if (!new URL(ctx.call.request.url).pathname.startsWith('/backend-api/')) return next();
  const auth = codexGrant(ctx); return auth instanceof Response ? auth : next();
}
