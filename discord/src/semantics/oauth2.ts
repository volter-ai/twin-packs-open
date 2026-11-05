// OAuth2 as Discord runs it: the token URL (a code or a refresh token spent once for a token pair; a bot install's
// answer carries the guild), the current authorization, and a bot's read of its application. The authorize page is
// ../screens/authorize.ts. Codes and tokens are drawn from the World's secret and kept by SHA-256.
import type { HandlerContext } from '@volter/world-core';
import { ACCESS, APP, appView, authorized, CODE, gap, GUILD, guildView, publicAppView, REFRESH, type Row, SECRET, sha256, stamp, tokenValue, userView } from './shared.ts';

// source: https://docs.discord.com/developers/topics/oauth2 "expires_in"
const ACCESS_TTL = 604800;

/** An OAuth2 error body (RFC 6749 section 5.2), as the token URL answers. */
const oauthError = (status: number, error: string, description?: string): Response => Response.json({ error, ...(description ? { error_description: description } : {}) }, { status });

/** The application a token request authenticates as: HTTP Basic, or client_id and client_secret in the form. */
// source: https://docs.discord.com/developers/topics/oauth2 "All calls to the OAuth2 endpoints require either HTTP Basic authentication"
function client(ctx: HandlerContext, form: URLSearchParams): Row | undefined {
  const basic = /^Basic\s+(\S+)$/i.exec(ctx.call.request.headers.get('authorization') ?? '')?.[1];
  const [id, secret] = basic ? Buffer.from(basic, 'base64').toString('utf8').split(':') : [form.get('client_id') ?? '', form.get('client_secret') ?? ''];
  const app = ctx.row(APP, String(id));
  if (!app || app.deleted === true || !secret) return undefined;
  return ctx.rowsRaw(SECRET).some((s) => s.application === app.id && s.revoked !== true && s.sha256 === sha256(ctx, secret)) ? app : undefined;
}

/** A token pair for a grant: the access token and its refresh token, each kept by its SHA-256. */
async function issue(ctx: HandlerContext, grant: { application: string; user: string; scope: string }): Promise<{ access_token: string; refresh_token: string }> {
  // source: https://docs.discord.com/developers/resources/application "Approximate count of users that have OAuth2 authorizations for the app"
  const users = new Set(ctx.rowsRaw(ACCESS).filter((r) => r.application === grant.application).map((r) => r.user));
  users.add(grant.user);
  await ctx.write(APP, grant.application, { approximate_user_authorization_count: users.size }, 'application.update');
  const aid = ctx.mint(ACCESS);
  const access = await tokenValue(ctx, `discord-access:${aid}`);
  await ctx.record(ACCESS, { ...grant, sha256: sha256(ctx, access), expires: new Date(Date.parse(ctx.occurredAt) + ACCESS_TTL * 1000).toISOString() }, aid);
  const rid = ctx.mint(REFRESH);
  const refresh = await tokenValue(ctx, `discord-refresh:${rid}`);
  await ctx.record(REFRESH, { ...grant, sha256: sha256(ctx, refresh), access: aid }, rid);
  return { access_token: access, refresh_token: refresh };
}

// source: https://docs.discord.com/developers/topics/oauth2 "is now exchanged for the user"
export async function oauth2_token(ctx: HandlerContext): Promise<Response> {
  // source: https://docs.discord.com/developers/topics/oauth2 "will only accept a content type of"
  // Where the documentation stops: "JSON content is not permitted and will return an error"; the twin answers the
  // error a body it cannot read the grant type from draws
  if (!(ctx.call.request.headers.get('content-type') ?? '').startsWith('application/x-www-form-urlencoded')) return oauthError(400, 'unsupported_grant_type', 'Invalid "grant_type" in request.');
  const form = new URLSearchParams(ctx.text);
  const app = client(ctx, form);
  if (!app) return oauthError(401, 'invalid_client');
  const grant = form.get('grant_type');
  if (grant === 'authorization_code') {
    const value = form.get('code') ?? '';
    const code = ctx.rowsRaw(CODE).find((c) => c.sha256 === sha256(ctx, value) && c.application === app.id);
    if (!code || code.used === true || Date.parse(String(code.expires)) <= Date.parse(ctx.occurredAt)) return oauthError(400, 'invalid_grant', 'Invalid "code" in request.');
    // source: https://docs.discord.com/developers/topics/oauth2 "the redirect_uri associated with this authorization"
    if (code.redirect_uri && form.get('redirect_uri') !== code.redirect_uri) return oauthError(400, 'invalid_grant', 'Invalid "redirect_uri" in request.');
    await ctx.record(CODE, { ...code, used: true }, String(code.id));
    const pair = await issue(ctx, { application: String(app.id), user: String(code.user), scope: String(code.scope) });
    const answer: Row = { token_type: 'Bearer', access_token: pair.access_token, expires_in: ACCESS_TTL, refresh_token: pair.refresh_token, scope: code.scope };
    // source: https://docs.discord.com/developers/topics/oauth2 "also receive information about the guild to which your bot was added"
    if (code.guild) {
      const g = ctx.row(GUILD, String(code.guild));
      if (g && g.deleted !== true) answer.guild = guildView(ctx, g);
    }
    return Response.json(answer);
  }
  if (grant === 'refresh_token') {
    const value = form.get('refresh_token') ?? '';
    const held = ctx.rowsRaw(REFRESH).find((r) => r.sha256 === sha256(ctx, value) && r.application === app.id);
    if (!held || held.revoked === true) return oauthError(400, 'invalid_grant', 'Invalid "refresh_token" in request.');
    await ctx.record(REFRESH, { ...held, revoked: true }, String(held.id));
    const pair = await issue(ctx, { application: String(app.id), user: String(held.user), scope: String(held.scope) });
    return Response.json({ token_type: 'Bearer', access_token: pair.access_token, expires_in: ACCESS_TTL, refresh_token: pair.refresh_token, scope: held.scope });
  }
  // source: https://docs.discord.com/developers/topics/oauth2 "you will be returned an access token for the bot owner"
  // the client credentials grant is Discord's, and the twin's gap: no application of the demand and no step of the life
  // asks for a bot owner's own token, so the twin answers it as it answers what it does not serve
  if (grant === 'client_credentials') return gap();
  return oauthError(400, 'unsupported_grant_type', 'Invalid "grant_type" in request.');
}

// source: https://docs.discord.com/developers/topics/oauth2 "Returns info about the current authorization. Requires authentication with a bearer token."
export async function get_my_oauth2_authorization(ctx: HandlerContext): Promise<Response> {
  const c = authorized(ctx);
  if (c instanceof Response) return c;
  if (c.kind !== 'bearer') return Response.json({ message: '401: Unauthorized', code: 0 }, { status: 401 });
  const scopes = c.scopes;
  return Response.json({
    application: publicAppView(ctx, c.app), scopes, expires: stamp(String(c.token.expires)),
    ...(scopes.includes('identify') ? { user: userView(c.user) } : {}),
  });
}

// source: https://docs.discord.com/developers/topics/oauth2 "Get Current Bot Application Information"
export async function get_my_oauth2_application(ctx: HandlerContext): Promise<Response> {
  const c = authorized(ctx);
  if (c instanceof Response) return c;
  return Response.json(appView(ctx, c.app));
}
