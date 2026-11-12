import { redis, type HandlerContext } from '@volter/world-core';
import { DIALECT, wireKey, WIRE_HEADER, wireFailure } from './shared.ts';

// The capability is local to the stream and cannot be a vendor credential or a public mutation door.
// source: https://redis.io/docs/latest/develop/reference/protocol-spec/ "The server's reply type is command-specific."
export async function around(ctx: HandlerContext, next: (request?: Request) => Promise<Response>): Promise<Response> {
  if (ctx.call.request.method !== 'POST' || ctx.call.request.headers.get(WIRE_HEADER) !== wireKey()) return next();
  const input = await ctx.call.request.json() as { commands: string[][]; database: string };
  return ctx.redis(input.commands, { dialect: DIALECT, database: input.database }).then((result) => Response.json(redis.wireValue(result)), (e) => wireFailure(e, input.commands));
}
