// The instance's public keys, the `/jwks` family.
import type { HandlerContext } from '@volter/world-core';
import { buildJwks } from './shared.ts';

/** `GET /jwks`: the instance's public keys, which verify every session token and ticket it signs. */
export async function GetJWKS(ctx: HandlerContext): Promise<Response> {
  return ctx.reply(buildJwks(ctx));
}
