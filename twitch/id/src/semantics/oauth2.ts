// The oauth2 family of id.twitch.tv: the token endpoint (an app access token for the client credentials grant, a user's
// for an authorization code, and a new one for a refresh token), validate and revoke.
import type { HandlerContext } from '@volter/world-core';
import { applicationOf, AUTHORIZATION_CODE, clientSecretMatches, digestOf, heldAccessToken, idError, issueAccess, secondsLeft, TOKEN, userById, type Row } from './shared.ts';

const param = (ctx: HandlerContext, name: string): string => String((ctx.params as Row)[name] ?? '');

/** The application the request names by its client id and secret, or the refusal. Where the documentation stops:
 *  Twitch documents no answer for an unknown client or a wrong secret at the token endpoint; the twin answers the class's
 *  documented form, a 400 with the status and a message. */
function authenticatedClient(ctx: HandlerContext, requireSecret: boolean): Row | Response {
  const clientId = param(ctx, 'client_id');
  const app = applicationOf(ctx, clientId);
  if (!app) return idError(400, 'invalid client');
  if (requireSecret && !clientSecretMatches(ctx, clientId, param(ctx, 'client_secret'))) return idError(403, 'invalid client secret');
  return app;
}

/** The client credentials grant: an app access token, no user, no refresh token. */
// source: https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/ "Must be set to client_credentials ."
async function clientCredentials(ctx: HandlerContext, app: Row): Promise<Response> {
  const issued = await issueAccess(ctx, { clientId: String(app.client_id), scopes: [] });
  // source: https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/ "If the request succeeds, it returns an access token."
  return Response.json({ access_token: issued.access_token, expires_in: issued.expires_in, token_type: 'bearer' });
}

/** The authorization code grant: the code the authorize page issued, spent once, for the user's tokens. */
// source: https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/ "Must be set to authorization_code ."
async function authorizationCode(ctx: HandlerContext, app: Row): Promise<Response> {
  const key = digestOf(ctx, param(ctx, 'code'));
  const code = param(ctx, 'code') ? ctx.row(AUTHORIZATION_CODE, key) : undefined;
  // a code is spent once, by the app it was issued to, at the redirect URI it was sent to, within its lifetime. Where the
  // documentation stops: Twitch documents no answer for a bad code: the class's, as for a bad refresh token
  // source: https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/ "The code that the /authorize response returned in the code query parameter."
  if (!code || code.status !== 'issued' || code.client_id !== app.client_id || code.redirect_uri !== param(ctx, 'redirect_uri') || Date.parse(String(code.expires_at)) <= Date.parse(ctx.occurredAt)) return idError(400, 'Invalid authorization code', 'Bad Request');
  const refused = ctx.legal('_authorization_code', 'status', 'oauth2Token', code.status, 'spent', key);
  if (refused) return ctx.refuse(refused);
  await ctx.record(AUTHORIZATION_CODE, { status: 'spent', spent_at: ctx.occurredAt }, key, 'oauth2Token');
  const scopes = (code.scopes as string[]) ?? [];
  const issued = await issueAccess(ctx, { clientId: String(app.client_id), userId: String(code.user_id), scopes });
  // source: https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/ "If the request succeeds, it returns an access token and refresh token."
  return Response.json({ access_token: issued.access_token, expires_in: issued.expires_in, refresh_token: issued.refresh_token, scope: scopes, token_type: 'bearer' });
}

/** The refresh token grant: a new access token for the grant, and the same refresh token back. */
// source: https://dev.twitch.tv/docs/authentication/refresh-tokens/ "Must be set to refresh_token ."
async function refreshToken(ctx: HandlerContext, app: Row): Promise<Response> {
  const refresh = param(ctx, 'refresh_token');
  const held = refresh ? ctx.row(TOKEN, digestOf(ctx, refresh)) : undefined;
  // source: https://dev.twitch.tv/docs/authentication/refresh-tokens/ "Invalid refresh token"
  if (!held || held.kind !== 'refresh' || held.status !== 'active' || held.client_id !== app.client_id || !userById(ctx, String(held.user_id))) return idError(400, 'Invalid refresh token', 'Bad Request');
  const scopes = (held.scopes as string[]) ?? [];
  const issued = await issueAccess(ctx, { clientId: String(app.client_id), userId: String(held.user_id), scopes, refresh });
  // source: https://dev.twitch.tv/docs/authentication/refresh-tokens/ "the response contains the new access token, refresh token, and scopes associated with the new grant."
  return Response.json({ access_token: issued.access_token, expires_in: issued.expires_in, refresh_token: issued.refresh_token, scope: scopes, token_type: 'bearer' });
}

/** The grants the token endpoint serves. Where the twin stops: the device code grant (and its POST /oauth2/device) is
 *  Twitch's, and no demanded app uses it: the gap. */
const GRANTS: Record<string, (ctx: HandlerContext, app: Row) => Promise<Response>> = { client_credentials: clientCredentials, authorization_code: authorizationCode, refresh_token: refreshToken };

export async function oauth2Token(ctx: HandlerContext): Promise<Response> {
  const grant = GRANTS[param(ctx, 'grant_type')];
  if (!grant) return ctx.gap();
  // source: https://dev.twitch.tv/docs/authentication/refresh-tokens/ "This field is not required if your application"
  const app = authenticatedClient(ctx, true);
  return app instanceof Response ? app : grant(ctx, app);
}

export async function oauth2Validate(ctx: HandlerContext): Promise<Response> {
  // source: https://dev.twitch.tv/docs/authentication/validate-tokens/ "You may also use the Bearer prefix in place of OAuth in the Authorization header."
  const token = /^(?:OAuth|Bearer)\s+(\S+)$/i.exec((ctx.call.request.headers.get('authorization') ?? '').trim())?.[1] ?? '';
  const held = heldAccessToken(ctx, token);
  // source: https://dev.twitch.tv/docs/authentication/validate-tokens/ "invalid access token"
  if (!held) return idError(401, 'invalid access token');
  const user = held.user_id ? userById(ctx, String(held.user_id)) : undefined;
  // source: https://dev.twitch.tv/docs/authentication/validate-tokens/ "If the access token is an App Access Token, this field will be null ."
  return Response.json({ client_id: held.client_id, login: user ? user.login : null, scopes: held.scopes ?? [], user_id: user ? user.id : null, expires_in: secondsLeft(held, ctx.occurredAt) });
}

export async function oauth2Revoke(ctx: HandlerContext): Promise<Response> {
  const app = applicationOf(ctx, param(ctx, 'client_id'));
  // source: https://dev.twitch.tv/docs/authentication/revoke-tokens/ "404 Not Found if the client ID is not valid."
  if (!app) return idError(404, 'client does not exist');
  const key = digestOf(ctx, param(ctx, 'token'));
  const held = heldAccessToken(ctx, param(ctx, 'token'));
  // source: https://dev.twitch.tv/docs/authentication/revoke-tokens/ "400 Bad Request if the client ID is valid but the access token is not."
  if (!held || held.client_id !== app.client_id) return idError(400, 'Invalid token');
  const refused = ctx.legal('_token', 'status', 'oauth2Revoke', held.status, 'revoked', key);
  if (refused) return ctx.refuse(refused);
  await ctx.record(TOKEN, { status: 'revoked', revoked_at: ctx.occurredAt }, key, 'oauth2Revoke');
  // source: https://dev.twitch.tv/docs/authentication/revoke-tokens/ "If the revocation succeeds, the request returns HTTP status code 200 OK (with no body)."
  return new Response(null, { status: 200 });
}
