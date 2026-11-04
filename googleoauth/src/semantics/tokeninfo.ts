import type { HandlerContext } from '@volter/world-core';
import { bearer, nowSeconds, oauthError } from './shared.ts';

// source: https://unpkg.com/google-auth-library@10.9.1/build/src/auth/oauth2client.js "async getTokenInfo(accessToken)"
export async function tokeninfoPost(ctx: HandlerContext): Promise<Response> {
  const held = bearer(ctx);
  if (!held) return oauthError(400, 'invalid_token', 'Invalid Value');
  return Response.json({ aud: String(held.clientId), scope: String(held.scope ?? ''), expires_in: Number(held.expiresAt) - nowSeconds(ctx) });
}
