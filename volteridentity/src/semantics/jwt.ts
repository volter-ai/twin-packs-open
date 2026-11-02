// The issuer's public keys.
import type { HandlerContext } from '@volter/world-core';
import { jwksOf } from './shared.ts';

// source: spec:getJSONWebKeySet "Get the JSON Web Key Set"
export async function getJSONWebKeySet(ctx: HandlerContext): Promise<Response> {
  return Response.json(await jwksOf(ctx));
}
