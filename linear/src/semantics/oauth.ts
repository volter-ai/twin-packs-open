// Linear's OAuth token URL: a code (from ../screens/authorize.ts) or a refresh token spent once for a token pair;
// access tokens live 24 hours. Tokens are drawn from the World's secret and kept by SHA-256.
import type { HandlerContext } from '@volter/world-core';
import { ACCESS, APP, CODE, hexToken, REFRESH, type Row, sha256 } from './shared.ts';

// source: https://linear.app/developers/oauth-2-0-authentication "expires_in"
const ACCESS_TTL = 86399;
const oauthError = (error: string, description: string, status = 400): Response => Response.json({ error, error_description: description }, { status });

async function pair(ctx: HandlerContext, grant: Row): Promise<Row> {
  const aid = await ctx.issue(ACCESS);
  const access = await hexToken(ctx, `linear-access:${aid}`);
  await ctx.record(ACCESS, { ...grant, sha256: sha256(ctx, access), expires: new Date(Date.parse(ctx.occurredAt) + ACCESS_TTL * 1000).toISOString() }, aid);
  const rid = await ctx.issue(REFRESH);
  const refresh = await hexToken(ctx, `linear-refresh:${rid}`);
  await ctx.record(REFRESH, { ...grant, sha256: sha256(ctx, refresh) }, rid);
  // source: https://linear.app/developers/oauth-2-0-authentication "Example response"
  return { access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL, scope: grant.scope, refresh_token: refresh };
}

// source: https://linear.app/developers/oauth-2-0-authentication "The access token is valid for 24 hours and will need to be refreshed when it expires."
export async function oauthToken(ctx: HandlerContext): Promise<Response> {
  const form = new URLSearchParams(ctx.text);
  const app = ctx.rowsRaw(APP).find((a) => a.deleted !== true && a.client_id === form.get('client_id') && a.secret_sha256 === sha256(ctx, form.get('client_secret') ?? ''));
  if (!app) return oauthError('invalid_client', 'Client authentication failed', 401);
  const grant = form.get('grant_type');
  if (grant === 'authorization_code') {
    const code = ctx.rowsRaw(CODE).find((c) => c.sha256 === sha256(ctx, form.get('code') ?? '') && c.app === app.id);
    if (!code || code.used === true || Date.parse(String(code.expires)) <= Date.parse(ctx.occurredAt)) return oauthError('invalid_grant', 'Invalid authorization code');
    if (form.get('redirect_uri') !== code.redirect_uri) return oauthError('invalid_grant', 'redirect_uri does not match the authorization request');
    await ctx.record(CODE, { ...code, used: true }, String(code.id));
    return Response.json(await pair(ctx, { app: app.id, org: code.org, user: code.actor_user, scope: code.scope }));
  }
  if (grant === 'refresh_token') {
    const held = ctx.rowsRaw(REFRESH).find((r) => r.sha256 === sha256(ctx, form.get('refresh_token') ?? '') && r.app === app.id);
    if (!held) return oauthError('invalid_grant', 'Invalid refresh token');
    // source: https://linear.app/developers/oauth-2-0-authentication "30-minute grace period"
    if (held.revoked === true) {
      if (Date.parse(ctx.occurredAt) - Date.parse(String(held.consumedAt)) > 30 * 60_000) return oauthError('invalid_grant', 'Invalid refresh token');
      const next = ctx.row(REFRESH, String(held.nextRefresh))!;
      return Response.json({ access_token: await hexToken(ctx, `linear-access:${String(held.nextAccess)}`), refresh_token: await hexToken(ctx, `linear-refresh:${String(held.nextRefresh)}`), token_type: 'Bearer', expires_in: ACCESS_TTL, scope: next.scope });
    }
    const result = await pair(ctx, { app: app.id, org: held.org, user: held.user, scope: held.scope });
    const nextAccess = ctx.rowsRaw(ACCESS).find((r) => r.sha256 === sha256(ctx, String(result.access_token)))!.id;
    const nextRefresh = ctx.rowsRaw(REFRESH).find((r) => r.sha256 === sha256(ctx, String(result.refresh_token)))!.id;
    await ctx.record(REFRESH, { ...held, revoked: true, consumedAt: ctx.occurredAt, nextAccess, nextRefresh }, String(held.id));
    return Response.json(result);
  }
  // source: https://linear.app/developers/oauth-2-0-authentication "Client credentials"
  if (grant === 'client_credentials' && app.client_credentials === true) {
    const id = await ctx.issue(ACCESS);
    const access = await hexToken(ctx, `linear-access:${id}`);
    const scope = (form.get('scope') ?? 'read').split(/[ ,]+/).filter(Boolean).join(' ');
    if (scope.split(' ').some((s) => !['read','write','admin'].includes(s))) return oauthError('invalid_scope', 'Invalid scope');
    await ctx.record(ACCESS, { app: app.id, org: app.org, user: app.actor_user, scope, teamIds: app.teamIds, sha256: sha256(ctx, access), expires: new Date(Date.parse(ctx.occurredAt) + 2591999 * 1000).toISOString() }, id);
    return Response.json({ access_token: access, token_type: 'Bearer', expires_in: 2591999, scope });
  }
  return unsupportedGrant(grant);
}

// source: https://linear.app/developers/oauth-2-0-authentication "Client does not support the client_credentials grant type"
function unsupportedGrant(grant: string | null): Response {
  return grant === 'client_credentials' ? oauthError('Error', 'Client does not support the client_credentials grant type') : oauthError('unsupported_grant_type', `Unsupported grant_type: ${String(grant)}`);
}
