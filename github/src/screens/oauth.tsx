// GITHUB'S OAUTH WEB FLOW — github.com/login/oauth/authorize and /login/oauth/access_token (a hosted flow,
// https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps): an application sends its user
// to the consent with its `client_id`, `redirect_uri`, `scope`, `state` and an optional PKCE challenge; the user's
// answer sends them back with a `code` and the `state` (or `error=access_denied`); the application exchanges the code —
// once, within ten minutes, with its secret (and PKCE verifier) — for a token, answered as its Accept header asks. An
// OAuth app's token is `gho_…` with the scopes consented; a GitHub App's is `ghu_…`, for eight hours, with a refresh token
// (`ghr_…`, six months) that `grant_type=refresh_token` exchanges for a new pair
// (https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/refreshing-user-access-tokens).
// A person who granted an application every scope it asks goes back at once, unasked.
import { sha256, type HandlerContext } from '@volter/world-core';
import { issueToken, nowSeconds, serial, TOKENS, tokenKey } from '../semantics/shared.ts';
import { back, clientOf, DEVICES, field, page, person, refused, scopesOf, seeOther, toSignIn } from './shared.tsx';

type Row = Record<string, unknown>;
const CODES = '_oauth_code';
const DOCS = 'https://docs.github.com/apps/managing-oauth-apps/troubleshooting-oauth-app-access-token-request-errors';



/** GitHub's rule for a redirect URI against the application's callback URLs: the same host and port, and a path at or
 *  under one's (https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#redirect-urls). */
function redirectAllowed(uri: string, app: Row): boolean {
  const callbacks = [...((app._callback_urls as string[] | undefined) ?? []), ...(typeof app.callback_url === 'string' ? [app.callback_url] : [])];
  if (!callbacks.length) return true;
  let to: URL;
  try { to = new URL(uri); } catch { return false; }
  return callbacks.some((c) => { const cb = new URL(c); const base = cb.pathname.replace(/\/+$/, ''); return to.host === cb.host && (to.pathname === cb.pathname || to.pathname === base || to.pathname.startsWith(`${base}/`)); });
}

/** The token's answer as the Accept header asks: JSON, XML, or GitHub's default form encoding. */
function answer(ctx: HandlerContext, fields: Record<string, string | number>): Response {
  const accept = ctx.call.request.headers.get('accept') ?? '';
  const text = Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, String(v)]));
  if (accept.includes('json')) return Response.json(fields);
  if (accept.includes('xml')) return new Response(`<OAuth>${Object.entries(text).map(([k, v]) => `<${k}>${v.replace(/[<>&]/g, '')}</${k}>`).join('')}</OAuth>`, { headers: { 'content-type': 'application/xml; charset=utf-8' } });
  return new Response(new URLSearchParams(text).toString(), { headers: { 'content-type': 'application/x-www-form-urlencoded; charset=utf-8' } });
}
const tokenError = (ctx: HandlerContext, error: string, description: string): Response => answer(ctx, { error, error_description: description, error_uri: `${DOCS}#${error.replace(/_/g, '-')}` });

export async function screen(ctx: HandlerContext): Promise<Response> {
  const path = new URL(ctx.call.request.url).pathname.replace(/\/+$/, '');
  if (path === '/login/oauth/access_token' && ctx.call.request.method === 'POST') return exchange(ctx);
  if (path !== '/login/oauth/authorize') return unknownPath();
  return consent(ctx);
}

/** The consent: who asks, for what, and the person's answer. */
async function consent(ctx: HandlerContext): Promise<Response> {
  const clientId = field(ctx, 'client_id');
  const c = clientOf(ctx, clientId);
  if (!c) return refused(404, 'Not Found');
  const redirect = field(ctx, 'redirect_uri') || [...((c.app._callback_urls as string[] | undefined) ?? []), ...(typeof c.app.callback_url === 'string' ? [c.app.callback_url] : [])][0] || '';
  if (!redirect || !redirectAllowed(redirect, c.app)) return refused(400, 'The redirect_uri is not associated with this application.');
  const login = person(ctx);
  if (!login) return toSignIn(ctx, field(ctx, 'login') || undefined);
  // source: https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps "Must be S256 - the plain code challenge method is not supported."
  // source: https://www.rfc-editor.org/rfc/rfc7636 "If the server supporting PKCE does not support the requested transformation, the authorization endpoint MUST return the authorization error response with \"error\" value set to \"invalid_request\"."
  // source: https://www.rfc-editor.org/rfc/rfc6749 "the authorization server informs the client by adding the following parameters to the query component of the redirection URI"
  const challenge = field(ctx, 'code_challenge'), challengeMethod = field(ctx, 'code_challenge_method');
  const state = field(ctx, 'state') || undefined;
  if ((challenge || challengeMethod) && (!/^[A-Za-z0-9_-]{43}$/.test(challenge) || challengeMethod !== 'S256')) return seeOther(back(redirect, { error: 'invalid_request', error_description: 'code_challenge requires a SHA-256 challenge and code_challenge_method S256.', state }));
  const scopes = c.kind === 'oauth' ? scopesOf(field(ctx, 'scope')) : [];
  const grant = ctx.row('oauth_grant', `${login}#${clientId}`);
  const granted = grant && scopes.every((s) => ((grant.scopes as string[] | undefined) ?? []).includes(s));
  const choice = field(ctx, 'authorize');
  if (ctx.call.request.method === 'POST' || granted) {
    if (ctx.call.request.method === 'POST' && choice !== '1') return seeOther(back(redirect, { error: 'access_denied', error_description: 'The user has denied your application access.', error_uri: `${DOCS}#access-denied`, state }));
    await ctx.write('oauth_grant', `${login}#${clientId}`, { login, client_id: clientId, scopes: [...new Set([...((grant?.scopes as string[] | undefined) ?? []), ...scopes])].sort(), at: nowSeconds(ctx) }, 'oauth_grant.set');
    const code = ctx.crypto.digest('sha256', await ctx.secret(`code:${clientId}:${login}:${ctx.occurredAt}:${await serial(ctx, 'oauth_code')}`), 'hex').slice(0, 20);
    await ctx.write(CODES, sha256(code), {
      client_id: clientId, login, scopes, redirect_uri: redirect, at: nowSeconds(ctx), used: false,
      ...(field(ctx, 'code_challenge') ? { challenge: field(ctx, 'code_challenge'), method: 'S256' } : {}),
    }, 'oauth_code.create');
    return seeOther(back(redirect, { code, state }));
  }
  const name = String(c.app.name);
  return page(`Authorize ${name}`, (
    <>
      <h1>Authorize {name}</h1>
      <form className="gh-box" method="post" action="/login/oauth/authorize">
        <p><strong>{name}</strong>{c.app.owner ? <span className="gh-muted"> by {String((c.app.owner as Row).login)}</span> : null} wants to access your <strong>{login}</strong> account</p>
        {c.kind === 'github_app' ? <p className="gh-muted">Verify your GitHub identity ({login}), and know which resources you can access.</p>
          : scopes.length ? <ul>{scopes.map((s) => <li key={s}><code>{s}</code></li>)}</ul> : <p className="gh-muted">Public data only: limited access to your public data.</p>}
        {(['client_id', 'scope', 'state', 'code_challenge', 'code_challenge_method'] as const).map((k) => <input key={k} type="hidden" name={k} value={field(ctx, k)} />)}
        <input type="hidden" name="redirect_uri" value={redirect} />
        <button type="submit" name="authorize" value="1">Authorize {name}</button>
        <button type="submit" name="authorize" value="0" className="gh-quiet">Cancel</button>
        <p className="gh-muted">Authorizing will redirect to <code>{new URL(redirect).origin}</code></p>
      </form>
    </>
  ));
}

/** The exchange of a code (or a GitHub App's refresh token, or a device's code) for a token. */
async function exchange(ctx: HandlerContext): Promise<Response> {
  const clientId = field(ctx, 'client_id');
  const c = clientOf(ctx, clientId);
  if (field(ctx, 'grant_type') === 'urn:ietf:params:oauth:grant-type:device_code') return c ? deviceToken(ctx, clientId, c.kind) : tokenError(ctx, 'incorrect_client_credentials', 'The client_id and/or client_secret passed are incorrect.');
  if (field(ctx, 'grant_type') === 'refresh_token') {
    const refresh = field(ctx, 'refresh_token');
    const kept = refresh ? ctx.row(TOKENS, tokenKey(refresh)) : undefined;
    // the secret: "Required unless the user access token was generated using the device flow"
    if (!c || (kept?.device !== true && c.app._client_secret !== field(ctx, 'client_secret'))) return tokenError(ctx, 'incorrect_client_credentials', 'The client_id and/or client_secret passed are incorrect.');
    if (!kept || kept.kind !== 'refresh' || kept.client_id !== clientId || kept.revoked === true || Number(kept.expires) <= nowSeconds(ctx)) return tokenError(ctx, 'bad_refresh_token', 'The refresh token passed is incorrect or expired.');
    // "Once you use a refresh token, that refresh token and the old user access token will no longer work"
    await ctx.write(TOKENS, tokenKey(refresh), { revoked: true }, 'token.refresh');
    if (typeof kept.access === 'string' && ctx.row(TOKENS, kept.access)) await ctx.write(TOKENS, kept.access, { revoked: true }, 'token.refreshed');
    return pair(ctx, clientId, String(kept.login), kept.device === true);
  }
  if (!c || c.app._client_secret !== field(ctx, 'client_secret')) return tokenError(ctx, 'incorrect_client_credentials', 'The client_id and/or client_secret passed are incorrect.');
  const code = field(ctx, 'code');
  const held = code ? ctx.row(CODES, sha256(code)) : undefined;
  if (!held || held.client_id !== clientId || held.used === true || nowSeconds(ctx) - Number(held.at) > 600) return tokenError(ctx, 'bad_verification_code', 'The code passed is incorrect or expired.');
  if (field(ctx, 'redirect_uri') && field(ctx, 'redirect_uri') !== held.redirect_uri) return tokenError(ctx, 'redirect_uri_mismatch', 'The redirect_uri MUST match the registered callback URL for this application.');
  if (typeof held.challenge === 'string') {
    const verifier = field(ctx, 'code_verifier');
    const computed = ctx.crypto.digest('sha256', verifier, 'base64url');
    if (!verifier || computed !== held.challenge) return tokenError(ctx, 'bad_verification_code', 'The code passed is incorrect or expired.');
  }
  await ctx.write(CODES, sha256(code), { used: true }, 'oauth_code.use');
  if (c.kind === 'github_app') return pair(ctx, clientId, String(held.login));
  const scopes = (held.scopes as string[] | undefined) ?? [];
  const token = await issueToken(ctx, 'gho_', { kind: 'oauth', login: held.login, client_id: clientId, scopes });
  return answer(ctx, { access_token: token, token_type: 'bearer', scope: scopes.join(',') });
}

/** The device flow's poll (https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow):
 *  a device's code, before its person enters it, `authorization_pending`; polled sooner than its interval, `slow_down`
 *  (the interval then five seconds longer); after fifteen minutes `expired_token`; declined, `access_denied`; entered and
 *  authorized, the token, once. No client secret is asked. */
async function deviceToken(ctx: HandlerContext, clientId: string, kind: 'oauth' | 'github_app'): Promise<Response> {
  const code = field(ctx, 'device_code');
  const d = code ? ctx.row(DEVICES, sha256(code)) : undefined;
  if (!d || d.client_id !== clientId) return tokenError(ctx, 'incorrect_device_code', 'The device_code provided is not valid.');
  const now = nowSeconds(ctx);
  if (now - Number(d.at) > 899) return tokenError(ctx, 'expired_token', 'The device_code has expired.');
  if (d.state === 'denied') return tokenError(ctx, 'access_denied', 'The authorization request was denied.');
  if (d.state === 'used') return tokenError(ctx, 'bad_verification_code', 'The code passed is incorrect or expired.');
  if (d.state !== 'authorized') {
    const interval = Number(d.interval ?? 5);
    const early = d.polled !== undefined && now - Number(d.polled) < interval;
    await ctx.write(DEVICES, sha256(code), { polled: now, ...(early ? { interval: interval + 5 } : {}) }, 'device_code.poll');
    return early ? answer(ctx, { error: 'slow_down', error_description: 'Too many requests have been made in the same timeframe.', error_uri: `${DOCS}#slow-down`, interval: interval + 5 })
      : tokenError(ctx, 'authorization_pending', 'The authorization request is still pending.');
  }
  await ctx.write(DEVICES, sha256(code), { state: 'used' }, 'device_code.use');
  if (kind === 'github_app') return pair(ctx, clientId, String(d.login), true);
  const scopes = (d.scopes as string[] | undefined) ?? [];
  const token = await issueToken(ctx, 'gho_', { kind: 'oauth', login: d.login, client_id: clientId, scopes });
  return answer(ctx, { access_token: token, token_type: 'bearer', scope: scopes.join(',') });
}

/** A GitHub App's user token and its refresh token ("The value will always be 28800 (8 hours)"; "The value will always
 *  be 15897600 (6 months)"), the refresh token remembering its access token and whether the device flow began them. */
async function pair(ctx: HandlerContext, clientId: string, login: string, device = false): Promise<Response> {
  const token = await issueToken(ctx, 'ghu_', { kind: 'user_app', login, client_id: clientId, expires: nowSeconds(ctx) + 28800 });
  const refresh = await issueToken(ctx, 'ghr_', { kind: 'refresh', login, client_id: clientId, expires: nowSeconds(ctx) + 15897600, access: tokenKey(token), ...(device ? { device: true } : {}) });
  return answer(ctx, { access_token: token, expires_in: 28800, refresh_token: refresh, refresh_token_expires_in: 15897600, scope: '', token_type: 'bearer' });
}

/** A malformed peer path beneath this screen's prefix. */
function unknownPath(): Response {
  return refused(404, 'Not Found');
}
