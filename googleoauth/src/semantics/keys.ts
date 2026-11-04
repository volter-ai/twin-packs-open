// The keys Google signs ID tokens with.
import type { HandlerContext } from '@volter/world-core';
import { jwksOf } from './shared.ts';

// source: https://developers.google.com/identity/openid-connect/openid-connect "access other Google APIs by including relevant scopes in the authentication request"
export async function certs(ctx: HandlerContext): Promise<Response> {
  return Response.json(await jwksOf(ctx));
}
