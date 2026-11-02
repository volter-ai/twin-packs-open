// Revoking a token: an access token stops answering, a refresh token (and what it granted) is gone.
import type { HandlerContext } from '@volter/world-core';
import { ACCESS_TOKEN, live, oauthError, REFRESH, type Row } from './shared.ts';

// source: https://developers.google.com/identity/protocols/oauth2/web-server "Refresh tokens are valid until the user revokes access or the refresh token expires."
export async function revoke(ctx: HandlerContext): Promise<Response> {
  const t = String((ctx.params as Row).token ?? '');
  const access = live(ctx.row(ACCESS_TOKEN, t));
  if (access) { await ctx.write(ACCESS_TOKEN, t, { revoked: true }, 'access_token.revoke'); return new Response(null, { status: 200 }); }
  const key = ctx.crypto.digest('sha256', t, 'hex');
  if (live(ctx.row(REFRESH, key))) { await ctx.remove(REFRESH, key, 'refresh_token.revoke'); return new Response(null, { status: 200 }); }
  return oauthError(400, 'invalid_token', 'Token expired or revoked');
}
