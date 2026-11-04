import type { HandlerContext } from '@volter/world-core';
import { e2bError, teamOf } from './shared.ts';

export async function around(ctx: HandlerContext, next: (request?: Request) => Promise<Response>): Promise<Response> {
  if (/^\/(sandboxes|v2\/)/.test(new URL(ctx.call.request.url).pathname) && !teamOf(ctx)) return e2bError(401, 'Invalid API key');
  return next();
}
