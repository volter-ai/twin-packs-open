// The `/clients` family: a handshake's payload, which the application's server reads back after the Frontend API's
// handshake redirected the browser to it with a nonce (../../fapi/src/semantics/client.ts `handshakeClient`).
import type { HandlerContext } from '@volter/world-core';
import { clerkError } from './shared.ts';

/** `GET /v1/clients/handshake_payload?nonce=`: the cookie directives the handshake decided, each for the application to
 *  set (@clerk/backend's `getCookiesFromHandshake` reads `directives`). A nonce is read once. */
// source: https://unpkg.com/@clerk/backend@2.30.1/dist/internal.js "cookiesToSet.push(...handshakePayload.directives)"
export async function GetHandshakePayload(ctx: HandlerContext): Promise<Response> {
  const nonce = typeof ctx.params.nonce === 'string' ? ctx.params.nonce : '';
  const held = nonce === '' ? undefined : ctx.row('_handshake', nonce);
  if (held === undefined) return clerkError(404, 'resource_not_found', 'not found', 'Resource not found');
  await ctx.remove('_handshake', nonce, 'handshake.consume');
  return ctx.reply({ directives: Array.isArray(held.directives) ? held.directives : [] });
}
