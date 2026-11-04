import type { HandlerContext } from '@volter/world-core';
import { KEY, readKey, xaiError } from './shared.ts';

export async function around(ctx: HandlerContext, next: (request?: Request) => Promise<Response>): Promise<Response> {
  const bearer = /^Bearer\s+(\S+)$/i.exec(ctx.call.request.headers.get('authorization') ?? '')?.[1];
  if (bearer) {
    const row = ctx.rowsRaw(KEY).find((row) => row.sha256 === ctx.crypto.sha256(bearer));
    if (row && await readKey(ctx, row) === undefined) return xaiError(401, 'Client specified an invalid argument', 'Incorrect API key provided.');
  }
  return next();
}
