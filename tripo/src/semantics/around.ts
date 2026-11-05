import type { HandlerContext } from '@volter/world-core';
import { accountOf } from './shared.ts';

export async function around(ctx: HandlerContext, next: (request?: Request) => Promise<Response>): Promise<Response> {
  if (/^\/(?:v2\/openapi|v3)(?:\/|$)/.test(new URL(ctx.call.request.url).pathname) && !accountOf(ctx)) {
    return ctx.refuse({ status: 401, code: 1002, message: 'Authentication failed' });
  }
  return next();
}
