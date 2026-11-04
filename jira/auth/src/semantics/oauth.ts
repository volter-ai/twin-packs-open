// Atlassian's token URL (JSON bodies): a code spent once, or a rotating refresh token (each use issues a new one and
// retires the old), for an access token of an hour; and the sites a token reaches.
import type { HandlerContext } from '@volter/world-core';
import { ACCESS, ACCESS_TTL, APP, CODE, grantOf, obj, REFRESH, type Row, sha256, SITE, tokenValue } from '../../../src/semantics/shared.ts';

const oauthError = (status: number, error: string, description: string): Response => Response.json({ error, error_description: description }, { status });

async function pair(ctx: HandlerContext, grant: Row): Promise<Row> {
  const aid = ctx.mint(ACCESS);
  const access = await tokenValue(ctx, `jira-access:${aid}`);
  await ctx.record(ACCESS, { ...grant, sha256: sha256(ctx, access), expires: new Date(Date.parse(ctx.occurredAt) + ACCESS_TTL * 1000).toISOString() }, aid);
  const answer: Row = { access_token: access, expires_in: ACCESS_TTL, scope: grant.scope, token_type: 'Bearer' };
  // source: https://developer.atlassian.com/cloud/jira/platform/oauth-2-3lo-apps/ "To get a refresh token in your initial authorization flow, add offline_access to the scope parameter"
  if (String(grant.scope).split(' ').includes('offline_access')) {
    const rid = ctx.mint(REFRESH);
    const refresh = await tokenValue(ctx, `jira-refresh:${rid}`);
    await ctx.record(REFRESH, { ...grant, sha256: sha256(ctx, refresh) }, rid);
    answer.refresh_token = refresh;
  }
  return answer;
}

// source: https://developer.atlassian.com/cloud/jira/platform/oauth-2-3lo-apps/ "Exchange authorization code for access token"
export async function oauthToken(ctx: HandlerContext): Promise<Response> {
  const b = obj(ctx.body);
  const app = ctx.rowsRaw(APP).find((a) => a.deleted !== true && a.client_id === b.client_id && a.secret_sha256 === sha256(ctx, String(b.client_secret ?? '')));
  if (!app) return oauthError(401, 'access_denied', 'Unauthorized');
  if (b.grant_type === 'authorization_code') {
    const code = ctx.rowsRaw(CODE).find((c) => c.sha256 === sha256(ctx, String(b.code ?? '')) && c.app === app.id);
    if (!code || code.used === true || Date.parse(String(code.expires)) <= Date.parse(ctx.occurredAt) || b.redirect_uri !== code.redirect_uri) return oauthError(403, 'invalid_grant', 'Invalid authorization code');
    await ctx.record(CODE, { used: true }, String(code.id));
    return Response.json(await pair(ctx, { app: app.id, sites: code.sites, person: code.person, scope: code.scope }));
  }
  return b.grant_type === 'refresh_token' ? refreshPair(ctx, app, b) : unsupportedGrant(String(b.grant_type));
}

// source: https://developer.atlassian.com/cloud/jira/platform/oauth-2-3lo-apps/ "Make a GET request to https://api.atlassian.com/oauth/token/accessible-resources"
export async function accessibleResources(ctx: HandlerContext): Promise<Response> {
  const g = grantOf(ctx);
  if (!g) return Response.json({ code: 401, message: 'Unauthorized' }, { status: 401 });
  const scopes = g.scopes.filter((s) => s !== 'offline_access');
  return Response.json(g.sites.map((id) => ctx.row(SITE, id)).filter(Boolean).map((s) => ({ id: s!.id, name: s!.name, url: s!.url, scopes, avatarUrl: 'https://site-admin-avatar-cdn.prod.public.atl-paas.net/avatars/240/rocket.png' })));
}

const unsupportedGrant = (grant: string): Response => oauthError(400, 'unsupported_grant_type', 'Unsupported grant type: ' + grant);

async function refreshPair(ctx: HandlerContext, app: Row, b: Row): Promise<Response> {
    const held = ctx.rowsRaw(REFRESH).find((r) => r.sha256 === sha256(ctx, String(b.refresh_token ?? '')) && r.app === app.id);
    // source: https://developer.atlassian.com/cloud/jira/platform/oauth-2-3lo-apps/ "Unknown or invalid refresh token."
    if (!held || held.revoked === true) return oauthError(403, 'invalid_grant', 'Unknown or invalid refresh token.');
    // source: https://developer.atlassian.com/cloud/jira/platform/oauth-2-3lo-apps/ "Rotating refresh tokens issue a new, limited life refresh token each time they are used."
    await ctx.record(REFRESH, { revoked: true }, String(held.id));
    return Response.json(await pair(ctx, { app: app.id, sites: held.sites, person: held.person, scope: held.scope }));
}
