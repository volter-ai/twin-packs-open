// The instance's public keys on its Frontend API host, the `/.well-known` family: what an application verifying a session
// token by hand fetches ("Manual JWT verification": https://clerk.com/docs/guides/sessions/manual-jwt-verification, the
// JWKS at `https://<YOUR_FRONTEND_API>/.well-known/jwks.json`). The same keys the Backend API's `GET /jwks` answers.
import type { HandlerContext } from '@volter/world-core';
import { buildJwks } from './shared.ts';

/** `GET /.well-known/jwks.json`: the instance's public keys. */
export async function getJWKS(ctx: HandlerContext): Promise<Response> {
  return ctx.reply(buildJwks(ctx));
}
