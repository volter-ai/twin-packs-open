// TikTok's authorize page, `https://www.tiktok.com/v2/auth/authorize/?client_key=…&scope=…&redirect_uri=…&state=…&
// response_type=code` (login-kit-web): the person logs in, then consents to the scopes the app asks; the browser is
// sent to the redirect URI with `code`, `scopes` (those granted, comma-separated) and `state`, or with `error` and
// `error_description`. A redirect URI the app did not register is refused on the page. In a World the person is one of
// the World's (the people door).
import type { HandlerContext } from '@volter/world-core';
import { APP_SCOPES, appByKey, CODE, credential, PERSON, sha256, seconds } from '../semantics/shared.ts';

const esc = (v: unknown): string => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const page = (body: string, status = 200): Response => new Response(`<!doctype html><html><head><meta charset="utf-8"><title>TikTok</title></head><body>${body}</body></html>`, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });
const PARAMS = ['client_key', 'scope', 'redirect_uri', 'state', 'response_type', 'code_challenge', 'code_challenge_method', 'disable_auto_auth'];
// Where the documentation stops: a code lives ten minutes
const CODE_TTL = 600;

export async function screen(ctx: HandlerContext): Promise<Response> {
  const request = ctx.call.request;
  const q = request.method === 'POST' ? new URLSearchParams(ctx.text) : new URL(request.url).searchParams;
  const app = appByKey(ctx, q.get('client_key'));
  if (!app) return page('<p>Something went wrong: client_key is invalid.</p>', 400);
  const redirect = q.get('redirect_uri') ?? '';
  // source: https://developers.tiktok.com/doc/login-kit-web "It must match one of the redirect URIs you registered for the app."
  if (!((app.redirect_uris as string[] | undefined) ?? []).includes(redirect)) return page('<p>Something went wrong: redirect_uri is not registered.</p>', 400);
  const back = (params: Record<string, string>): Response => {
    const u = new URL(redirect);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    if (q.get('state') !== null) u.searchParams.set('state', q.get('state')!);
    return new Response(null, { status: 302, headers: { location: u.toString() } });
  };
  // source: https://developers.tiktok.com/doc/login-kit-web "This value should always be set to"
  if (q.get('response_type') !== 'code') return back({ error: 'invalid_request', error_description: 'response_type must be code' });
  const asked = (q.get('scope') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const granted = (app.scopes as string[] | undefined) ?? APP_SCOPES;
  const unknown = asked.filter((s) => !granted.includes(s));
  if (!asked.length || unknown.length) return back({ error: 'invalid_scope', error_description: `Scope is not authorized for this app: ${unknown.join(',') || '(none)'}` });
  const hidden = PARAMS.filter((k) => q.get(k) !== null).map((k) => `<input type="hidden" name="${k}" value="${esc(q.get(k))}">`).join('');
  if (request.method !== 'POST') {
    return page(`<h1>Log in to TikTok</h1><form method="post" action="/v2/auth/authorize/">${hidden}<label>Username <input name="username"></label><label>Password <input name="password" type="password"></label><input type="hidden" name="step" value="login"><button type="submit">Log in</button></form>`);
  }
  if (q.get('decision') === 'cancel') return back({ error: 'access_denied', error_description: 'The user denied the authorization.' });
  const person = ctx.rowsRaw(PERSON).find((p) => p.deleted !== true && p.username === q.get('username'));
  if (!person || person.password_sha256 !== sha256(ctx, q.get('password') ?? '')) return page(`<h1>Log in to TikTok</h1><p>Incorrect account or password.</p><form method="post" action="/v2/auth/authorize/">${hidden}<label>Username <input name="username"></label><label>Password <input name="password" type="password"></label><button type="submit">Log in</button></form>`, 401);
  if (q.get('decision') !== 'authorize') {
    const who = `<input type="hidden" name="username" value="${esc(person.username)}"><input type="hidden" name="password" value="${esc(q.get('password'))}">`;
    return page(`<h1>${esc(app.name)} would like to access your TikTok account</h1><ul>${asked.map((s) => `<li>${esc(s)}</li>`).join('')}</ul><form method="post" action="/v2/auth/authorize/">${hidden}${who}<button name="decision" value="authorize" type="submit">Authorize</button><button name="decision" value="cancel" type="submit">Cancel</button></form>`);
  }
  const challenge = q.get('code_challenge');
  const code = await credential(ctx, CODE, 'code', {
    app: app.id, person: person.id, scope: asked.join(','), redirect_uri: redirect, expires_at: seconds(ctx.occurredAt) + CODE_TTL, used: false,
    ...(challenge ? { challenge } : {}),
  });
  // source: https://developers.tiktok.com/doc/login-kit-web "A comma-separated (,) string of authorization scope(s), which the user has granted."
  return back({ code: code.value, scopes: asked.join(',') });
}
