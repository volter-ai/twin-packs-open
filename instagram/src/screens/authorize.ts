// Business Login for Instagram's authorization window, `https://www.instagram.com/oauth/authorize?client_id=…&redirect_uri=…
// &response_type=code&scope=…&state=…` (and the same window at api.instagram.com/oauth/authorize, as its reference page
// writes it): the person logs in with their Instagram professional account and grants the app the permissions it asks;
// the browser goes back to the redirect URI with `code` (and `#_` after it) and the state, or with `error=access_denied`.
// In a World the person is one of the World's (the accounts door).
import type { HandlerContext } from '@volter/world-core';
import { ACCOUNT, BASIC, CODE, CODE_TTL, PERMISSIONS, SESSION, appById, professional, seconds, sha256, type Row } from '../semantics/shared.ts';

// Where the documentation stops: the pages do not say how long the window keeps a login; ten minutes
const SESSION_TTL = 600;
const esc = (v: unknown): string => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const page = (body: string, status = 200, headers: Record<string, string> = {}): Response => new Response(`<!doctype html><html><head><meta charset="utf-8"><title>Instagram</title></head><body>${body}</body></html>`, { status, headers: { 'content-type': 'text/html; charset=utf-8', ...headers } });
const PARAMS = ['client_id', 'redirect_uri', 'response_type', 'scope', 'state', 'force_reauth', 'enable_fb_login'];
const loginForm = (hidden: string, note = ''): string =>
  `<h1>Log in to Instagram</h1>${note}<form method="post">${hidden}<label>Username <input name="username" autocomplete="username"></label><label>Password <input name="password" type="password" autocomplete="current-password"></label><button type="submit">Log in</button></form>`;

export async function screen(ctx: HandlerContext): Promise<Response> {
  const request = ctx.call.request;
  const q = request.method === 'POST' ? new URLSearchParams(ctx.text) : new URL(request.url).searchParams;
  // source: https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login "Instagram App ID displayed in App Dashboard"
  const app = appById(ctx, q.get('client_id'));
  // Where the documentation stops: the pages do not show the window's own refusals; each is said on the page, and no
  // redirect is made to a URI the app did not register
  if (!app) return page('<p>Sorry, this page isn&#39;t available: Invalid app ID.</p>', 400);
  const redirect = q.get('redirect_uri') ?? '';
  // source: https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login "Make sure this exactly matches one of the base URIs in your list of valid OAuth URIs you set during API setup in the App Dashboard."
  if (!((app.redirect_uris as string[] | undefined) ?? []).includes(redirect)) return page('<p>Sorry, this page isn&#39;t available: Invalid redirect_uri.</p>', 400);
  // source: https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login "We will include this parameter and value when redirecting the user back to you."
  const back = (params: Record<string, string>, fragment?: string): Response => {
    const u = new URL(redirect);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    if (q.get('state') !== null) u.searchParams.set('state', q.get('state')!);
    if (fragment) u.hash = fragment;
    return new Response(null, { status: 302, headers: { location: u.toString() } });
  };
  // source: https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login "Set this value to code ."
  if (q.get('response_type') !== 'code') return page('<p>Sorry, this page isn&#39;t available: response_type must be code.</p>', 400);
  // source: https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login "A comma-separated or URL-encoded space-separated list of permissions to request from the app user."
  const asked = [...new Set((q.get('scope') ?? '').split(/[,\s]+/).map((s) => s.trim()).filter(Boolean))];
  // the scope values business_basic and its kind were replaced by the instagram_business_ ones
  // source: https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login "Please note that the old scope values will be deprecated on January 27, 2025 ."
  const unknown = asked.filter((s) => !PERMISSIONS.includes(s));
  if (unknown.length) return page(`<p>Sorry, this page isn&#39;t available: Invalid scope: ${esc(unknown.join(','))}.</p>`, 400);
  // source: https://developers.facebook.com/documentation/instagram-platform/reference/oauth-authorize "instagram_basic or instagram_business_basic is required."
  if (!asked.includes(BASIC)) return page(`<p>Sorry, this page isn&#39;t available: ${BASIC} is required.</p>`, 400);
  const hidden = PARAMS.filter((k) => q.get(k) !== null).map((k) => `<input type="hidden" name="${k}" value="${esc(q.get(k))}">`).join('');
  if (request.method !== 'POST') return page(loginForm(hidden));
  // the login carried across the consent step: a session the window makes at login, single-use and short-lived, named
  // by the sessionid cookie and kept by its SHA-256; the password is never put on the consent page
  const presentedSession = /(?:^|;\s*)sessionid=([^;]+)/.exec(request.headers.get('cookie') ?? '')?.[1];
  const session = presentedSession ? ctx.rowsRaw(SESSION).find((r) => r.deleted !== true && r.sha256 === sha256(ctx, presentedSession)) : undefined;
  const live = session && session.used !== true && Number(session.expires_at) > seconds(ctx.occurredAt) && session.app === app.id && session.redirect_uri === redirect ? session : undefined;
  const decision = q.get('decision');
  if (decision === 'cancel' || decision === 'allow') {
    if (live) await ctx.record(SESSION, { ...live, used: true }, String(live.id));
    // source: https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login "If the user cancels the authorization flow, we will redirect the user to your redirect_uri and attach the following error parameters."
    if (decision === 'cancel') return back({ error: 'access_denied', error_reason: 'user_denied', error_description: 'The user denied your request' });
    if (!live) return page(loginForm(hidden, '<p>Your session has expired. Log in again.</p>'), 401);
    return grant(ctx, app, ctx.row(ACCOUNT, String(live.account))!, asked, redirect, back);
  }
  const account = ctx.rowsRaw(ACCOUNT).find((a) => a.deleted !== true && a.username === (q.get('username') ?? '').toLowerCase());
  if (!account || typeof account.password_sha256 !== 'string' || account.password_sha256 !== sha256(ctx, q.get('password') ?? '')) {
    return page(loginForm(hidden, '<p>Sorry, your password was incorrect. Please double-check your password.</p>'), 401);
  }
  // source: https://developers.facebook.com/documentation/instagram-platform/overview "To use the APIs, your app users must have an Instagram professional account"
  if (!professional(account)) return page('<p>This account isn&#39;t a professional account. Switch to a professional account to log in to this app.</p>', 403);
  const sessionId = ctx.mint(SESSION);
  const value = (await ctx.secret(`instagram-session:${sessionId}`)).replace(/[^A-Za-z0-9]/g, '').slice(0, 40);
  await ctx.record(SESSION, { sha256: sha256(ctx, value), app: app.id, account: account.id, redirect_uri: redirect, expires_at: seconds(ctx.occurredAt) + SESSION_TTL, used: false, created: ctx.occurredAt }, sessionId);
  const consent = `<h1>${esc(app.name)} is requesting access to:</h1><ul>${asked.map((s) => `<li>${esc(s)}</li>`).join('')}</ul><p>Logged in as ${esc(account.username)}</p><form method="post">${hidden}<button name="decision" value="allow" type="submit">Allow</button><button name="decision" value="cancel" type="submit">Cancel</button></form>`;
  return page(consent, 200, { 'set-cookie': `sessionid=${value}; Path=/oauth/authorize; Max-Age=${SESSION_TTL}; HttpOnly; Secure; SameSite=Lax` });
}

/** The person allowed: a code for the app, single-use and valid an hour, and the browser sent back with it. */
async function grant(ctx: HandlerContext, app: Row, account: Row, asked: string[], redirect: string, back: (params: Record<string, string>, fragment?: string) => Response): Promise<Response> {
  const id = ctx.mint(CODE);
  const value = `AQ${(await ctx.secret(`instagram-code:${id}`)).replace(/[^A-Za-z0-9]/g, '')}`.slice(0, 64);
  await ctx.record(CODE, { sha256: sha256(ctx, value), app: app.id, account: account.id, permissions: asked, redirect_uri: redirect, expires_at: seconds(ctx.occurredAt) + CODE_TTL, used: false, created: ctx.occurredAt }, id);
  // source: https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login "The #_ appended to the end of the redirect URI is not part of the code itself, so strip it out."
  return back({ code: value }, '_');
}
