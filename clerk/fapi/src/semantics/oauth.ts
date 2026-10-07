import type { HandlerContext } from '@volter/world-core';
import { frontendGap, ms, oauthApplication, oauthAuthorize, oauthError, oauthParams, oauthTokens, rootOf, sha256, text, type Row } from './shared.ts';

// source: spec:requestOAuthAuthorize "If successful, receive authorization grant via redirect."
export async function requestOAuthAuthorize(ctx: HandlerContext): Promise<Response> {
  return oauthAuthorize(ctx, oauthParams(ctx));
}
// source: spec:getOAuthToken "Exchange an authorization grant for OAuth2 tokens"
export async function getOAuthToken(ctx: HandlerContext): Promise<Response> {
  const clientId = text(ctx, 'client_id') ?? '';
  const app = await oauthApplication(ctx, clientId);
  const root = await rootOf(ctx);
  // source: spec:getOAuthToken "No client secret required."
  // Confidential client authentication is a separate flow outside the worker's public PKCE path.
  if (!app) return oauthError(401, 'invalid_client', 'Client authentication failed.');
  if (app.public !== true) return frontendGap(ctx, true);
  const grantType = text(ctx, 'grant_type');
  // Other OAuth grants are separate unmodeled flows, answered by the ordinary Frontend API gap.
  if (grantType !== 'authorization_code' && grantType !== 'refresh_token') return frontendGap(ctx, true);
  const raw = text(ctx, grantType === 'authorization_code' ? 'code' : 'refresh_token');
  if (!raw) return oauthError(400, 'invalid_request', 'The grant credential is required.');
  const resource = grantType === 'authorization_code' ? '_oauth_code' : '_oauth_refresh';
  const id = sha256(raw);
  const held = ctx.get(resource, id);
  // source: spec:/components/responses/OAuth.TokenError401 "Invalid or expired authorization code"
  if (!held || held.client_id !== clientId) return oauthError(401, 'invalid_grant', 'Invalid grant.');
  // source: spec:/components/responses/OAuth.TokenError400 "Expired authorization code"
  if (Number(held.expires_at) <= ms(ctx)) return oauthError(grantType === 'authorization_code' ? 400 : 401, 'invalid_grant', 'The grant has expired.');
  // source: spec:getOAuthToken "If provided, it must exactly match that resource."
  // source: spec:getOAuthToken "Only one `resource` value is supported."
  const resources = new URLSearchParams(ctx.text).getAll('resource');
  if (resources.length > 1) return oauthError(400, 'invalid_target', 'Only one resource is supported.');
  const target = text(ctx, 'resource');
  if (target !== undefined && target !== held.resource) return oauthError(400, 'invalid_target', 'Resource does not match the grant.');
  if (grantType === 'authorization_code') {
    // source: spec:getOAuthToken "Must match exactly."
    if (!text(ctx, 'redirect_uri')) return oauthError(400, 'invalid_request', 'redirect_uri is required.');
    if (text(ctx, 'redirect_uri') !== held.redirect_uri) return oauthError(400, 'invalid_grant', 'redirect_uri does not match.');
    // source: spec:/components/responses/OAuth.TokenError401 "Invalid `code_verifier` for PKCE flow"
    const verifier = text(ctx, 'code_verifier') ?? '';
    if (held.challenge && (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) || ctx.crypto.digest('sha256', verifier, 'base64url') !== held.challenge)) return oauthError(401, 'invalid_grant', 'Invalid code_verifier.');
    if (!root.get('User', String(held.user_id))) return oauthError(401, 'invalid_grant', 'The user no longer exists.');
    let refused: { status: number; message: string } | undefined;
    // source: https://clerk.com/docs/guides/configure/auth-strategies/oauth/how-clerk-implements-oauth "Each code can be exchanged once before it expires."
    await ctx.change(resource, id, (current: Row) => {
      refused = ctx.legal('_oauth_code', 'status', 'getOAuthToken', current.status, 'used', id);
      return refused ? undefined : { status: 'used' };
    }, 'oauth_code.exchange');
    if (refused) return oauthError(refused.status, 'invalid_grant', refused.message);
  }
  // source: spec:getOAuthToken "If provided, the requested scope must not exceed the scope originally granted."
  const scope = grantType === 'refresh_token' ? text(ctx, 'scope') ?? String(held.scope) : String(held.scope);
  if (scope.split(/\s+/).some((s) => !String(held.scope).split(/\s+/).includes(s) || !String(app.scopes).split(/\s+/).includes(s))) return oauthError(400, 'invalid_scope', 'Scope exceeds the grant.');
  return oauthTokens(ctx, { ...held, scope }, grantType === 'refresh_token' ? raw : undefined);
}
