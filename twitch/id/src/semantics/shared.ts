// What the id lane shares: the vendor's (../../../src/semantics/shared.ts), and what its token endpoint and its authorize
// page both need: the application a client id names, its client secret checked, the tokens issued, id.twitch.tv's
// refusal body, and the words the authorize page says each scope with.
import type { HandlerContext } from '@volter/world-core';
import { APP_TOKEN_SECONDS, AUTHORIZATION_CODE, CLIENT_SECRET, credentialString, digestOf, TOKEN, USER_TOKEN_SECONDS, type Row } from '../../../src/semantics/shared.ts';

export * from '../../../src/semantics/shared.ts';

/** id.twitch.tv's refusal: its status and message (`{ "status": 400, "message": "Invalid token" }`), and with `error`, the
 *  status's reason as well, as the token endpoint's refresh failure answers (`"error": "Bad Request"`). */
// source: https://dev.twitch.tv/docs/authentication/revoke-tokens/ "Invalid token"
// source: https://dev.twitch.tv/docs/authentication/refresh-tokens/ "Invalid refresh token"
export function idError(status: number, message: string, error?: string): Response {
  return Response.json({ ...(error ? { error } : {}), status, message }, { status });
}

/** The application a client id names, registered in the developer console. */
export const applicationOf = (ctx: Pick<HandlerContext, 'row'>, clientId: string): Row | undefined => {
  const app = clientId ? ctx.row('application', clientId) : undefined;
  return app && app.deleted !== true ? app : undefined;
};

/** Whether `secret` is the application's client secret (kept by its SHA-256). */
export const clientSecretMatches = (ctx: Pick<HandlerContext, 'row' | 'crypto'>, clientId: string, secret: string): boolean =>
  Boolean(secret) && ctx.row(CLIENT_SECRET, clientId)?.sha256 === digestOf(ctx, secret);

/** An access token issued (and, for a user, its refresh token): each a fresh credential drawn from the World's secret,
 *  kept by its SHA-256. A user access token lasts about four hours, an app access token weeks. */
export async function issueAccess(ctx: HandlerContext, grant: { clientId: string; userId?: string; scopes: string[]; refresh?: string }): Promise<{ access_token: string; expires_in: number; refresh_token?: string }> {
  const n = await ctx.record('_token_issue', { client_id: grant.clientId, at: ctx.occurredAt });
  const access = await credentialString(ctx, `access-token:${n}`);
  const seconds = grant.userId ? USER_TOKEN_SECONDS : APP_TOKEN_SECONDS;
  const expires = new Date(Date.parse(ctx.occurredAt) + seconds * 1000).toISOString();
  // a user's grant has a refresh token: a new one for a code, the same one again for a refresh
  // source: https://dev.twitch.tv/docs/authentication/refresh-tokens/ "When you get a user access token using the Authorization Code Grant flow, you also get a refresh token."
  const refresh = grant.userId ? grant.refresh ?? await credentialString(ctx, `refresh-token:${n}`, 50) : undefined;
  await ctx.record(TOKEN, { kind: 'access', status: 'active', client_id: grant.clientId, user_id: grant.userId ?? null, scopes: grant.scopes, issued_at: ctx.occurredAt, expires_at: expires, ...(refresh ? { refresh: digestOf(ctx, refresh) } : {}) }, digestOf(ctx, access), 'oauth2Token');
  if (refresh && !grant.refresh) await ctx.record(TOKEN, { kind: 'refresh', status: 'active', client_id: grant.clientId, user_id: grant.userId, scopes: grant.scopes, issued_at: ctx.occurredAt }, digestOf(ctx, refresh), 'oauth2Token');
  return { access_token: access, expires_in: seconds, ...(refresh ? { refresh_token: refresh } : {}) };
}

/** An authorization code the authorize page issues for a person's consent, kept by its SHA-256. Where the documentation
 *  stops: Twitch does not say how long a code lasts; the twin's lasts ten minutes, OAuth 2.0's recommended most. */
// source: https://www.rfc-editor.org/rfc/rfc6749 "A maximum authorization code lifetime of 10 minutes is RECOMMENDED."
export async function issueCode(ctx: HandlerContext, grant: { clientId: string; userId: string; scopes: string[]; redirectUri: string }): Promise<string> {
  const n = await ctx.record('_authorization_code_issue', { client_id: grant.clientId, at: ctx.occurredAt });
  const code = await credentialString(ctx, `authorization-code:${n}`);
  await ctx.record(AUTHORIZATION_CODE, { status: 'issued', client_id: grant.clientId, user_id: grant.userId, scopes: grant.scopes, redirect_uri: grant.redirectUri, expires_at: new Date(Date.parse(ctx.occurredAt) + 600_000).toISOString() }, digestOf(ctx, code));
  return code;
}

/** What the authorize page tells a person each scope lets the app do: the scopes page's words. */
export const SCOPE_WORDS: Record<string, string> = {
  // source: https://dev.twitch.tv/docs/authentication/scopes/ "Send chat messages to a chatroom."
  'user:write:chat': 'Send chat messages to a chatroom.',
  // source: https://dev.twitch.tv/docs/authentication/scopes/ "View a user"
  'user:read:email': 'View a user’s email address.',
  // source: https://dev.twitch.tv/docs/authentication/scopes/ "View chat messages sent in a chatroom using an IRC connection."
  'chat:read': 'View chat messages sent in a chatroom using an IRC connection.',
  // source: https://dev.twitch.tv/docs/authentication/scopes/ "including updating channel configuration and managing stream markers and stream tags."
  'channel:manage:broadcast': 'Manage a channel’s broadcast configuration, including updating channel configuration and managing stream markers and stream tags.',
  // source: https://dev.twitch.tv/docs/authentication/scopes/ "stream key."
  'channel:read:stream_key': 'View an authorized user’s stream key.',
};
