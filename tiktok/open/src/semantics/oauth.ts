import type { HandlerContext } from '@volter/world-core';
import { CODE, PERSON, REFRESH, appByKey, bySha, clientSecret, issue, oauthError, pkceRefused, seconds, type Row } from './shared.ts';

// source: https://developers.tiktok.com/doc/oauth-user-access-token-management "Its value should always be set as"
export async function oauthToken(ctx: HandlerContext): Promise<Response> {
  const p = ctx.params as Row;
  const app = appByKey(ctx, p.client_key);
  if (!app || typeof p.client_secret !== 'string' || p.client_secret !== await clientSecret(ctx, app)) return oauthError(ctx, 'invalid_client', 'Client key or secret is incorrect.');
  const now = seconds(ctx.occurredAt);
  if (p.grant_type === 'authorization_code') {
    const code = typeof p.code === 'string' ? bySha(ctx, CODE, decodeURIComponent(p.code)) : undefined;
    if (!code || code.used === true || code.app !== app.id || Number(code.expires_at) <= now) return oauthError(ctx, 'invalid_grant', 'Authorization code is expired.');
    // source: https://developers.tiktok.com/doc/oauth-user-access-token-management "Its value must be the same as the"
    if (p.redirect_uri !== code.redirect_uri) return oauthError(ctx, 'invalid_request', 'Redirect_uri is not matched with the uri when requesting code.');
    // PKCE is checked when the authorize request named a challenge ("Required for mobile and desktop app only")
    if (pkceRefused(ctx, code, p.code_verifier)) return oauthError(ctx, 'invalid_grant', 'Code verifier or code challenge is invalid.');
    await ctx.record(CODE, { ...code, used: true }, String(code.id));
    return issue(ctx, app, ctx.row(PERSON, String(code.person))!, String(code.scope));
  }
  if (p.grant_type === 'refresh_token') {
    const held = typeof p.refresh_token === 'string' ? bySha(ctx, REFRESH, p.refresh_token) : undefined;
    if (!held || held.used === true || held.app !== app.id || Number(held.expires_at) <= now) return oauthError(ctx, 'invalid_grant', 'Refresh token is invalid or expired.');
    await ctx.record(REFRESH, { ...held, used: true }, String(held.id));
    return issue(ctx, app, ctx.row(PERSON, String(held.person))!, String(held.scope));
  }
  return oauthError(ctx, 'unsupported_grant_type', 'The grant type is not supported.');
}
