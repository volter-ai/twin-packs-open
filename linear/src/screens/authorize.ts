// Linear's authorize page, `https://linear.app/oauth/authorize?client_id=…&redirect_uri=…&response_type=code&scope=…&
// state=…&prompt=consent&actor=app` (oauth-2-0-authentication): a person logs in and authorizes the application for
// their workspace; the browser is sent to the redirect URI with `code` and `state`, or `error=access_denied`. With
// `actor=app` the grant acts as the application itself: its own user in the workspace, made on its first install.
import type { HandlerContext } from '@volter/world-core';
import { APP, appUserFields, CODE, hexToken, ORG, type Row, sha256, USER } from '../semantics/shared.ts';

const esc = (v: unknown): string => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const page = (body: string, status = 200): Response => new Response(`<!doctype html><html><head><meta charset="utf-8"><title>Linear</title></head><body>${body}</body></html>`, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });
const PARAMS = ['client_id', 'redirect_uri', 'response_type', 'scope', 'state', 'prompt', 'actor'];
// Where the documentation stops: a code's lifetime is Linear's; the twin gives it ten minutes
const CODE_TTL = 600;
// source: https://linear.app/developers/oauth-2-0-authentication "read"
const SCOPES = new Set(['read', 'write', 'issues:create', 'comments:create', 'timeSchedule:write', 'admin', 'app:assignable', 'app:mentionable']);

export async function screen(ctx: HandlerContext): Promise<Response> {
  const request = ctx.call.request;
  const q = request.method === 'POST' ? new URLSearchParams(ctx.text) : new URL(request.url).searchParams;
  const app = ctx.rowsRaw(APP).find((a) => a.deleted !== true && a.client_id === q.get('client_id'));
  if (!app) return page('<p>Invalid client_id</p>', 400);
  const redirect = q.get('redirect_uri') ?? '';
  if (!(app.redirect_uris as string[]).includes(redirect)) return page('<p>Invalid redirect_uri</p>', 400);
  if (q.get('response_type') !== 'code') return page('<p>Invalid response_type</p>', 400);
  const scopes = (q.get('scope') ?? '').split(/[ ,]+/).filter(Boolean);
  if (!scopes.length || scopes.some((s) => !SCOPES.has(s))) return page('<p>Invalid scope</p>', 400);
  const back = (params: Record<string, string>): Response => {
    const u = new URL(redirect);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    if (q.get('state') !== null) u.searchParams.set('state', q.get('state')!);
    return new Response(null, { status: 302, headers: { location: u.toString() } });
  };
  const hidden = PARAMS.filter((p) => q.get(p) !== null).map((p) => `<input type="hidden" name="${p}" value="${esc(q.get(p))}">`).join('');
  let sessionCookie: string | undefined;
  const login = (error = ''): Response => page(`<h1>Log in to Linear</h1>${error ? `<p>${esc(error)}</p>` : ''}<form method="post">${hidden}<input name="email"><input type="password" name="password"><button>Continue</button></form>`, error ? 400 : 200);
  const cookie = /(?:^|;\s*)linear_session=([^;]+)/.exec(request.headers.get('cookie') ?? '')?.[1];
  const session = cookie ? ctx.rowsRaw('_browser_session').find((s) => s.sha256 === sha256(ctx, cookie) && Date.parse(String(s.expires)) > Date.parse(ctx.occurredAt)) : undefined;
  let person = session ? ctx.row(USER, String(session.user)) : undefined;
  if (!person) {
    if (request.method !== 'POST' || q.has('decision')) return login();
    person = ctx.rowsRaw(USER).find((u) => u.deleted !== true && u.app !== true && u.email === q.get('email'));
    if (!person || person._password !== sha256(ctx, `${String(person.id)}:${String(q.get('password') ?? '')}`)) return login('Invalid email or password');
    const sessionId = await ctx.issue('_browser_session');
    sessionCookie = await hexToken(ctx, `linear-browser:${sessionId}`);
    await ctx.record('_browser_session', { user: person.id, sha256: sha256(ctx, sessionCookie), expires: new Date(Date.parse(ctx.occurredAt) + 90 * 86400000).toISOString() }, sessionId);
  }
  const org = ctx.row(ORG, String(person._org))!;
  if (q.get('decision') === 'cancel') return back({ error: 'access_denied' });
  if (q.get('decision') !== 'authorize') {
    const consent = page(`<h1>${esc(app.name)} is requesting access to your ${esc(org.name)} workspace</h1><ul>${scopes.map((s) => `<li>${esc(s)}</li>`).join('')}</ul><form method="post">${hidden}<button name="decision" value="cancel">Cancel</button><button name="decision" value="authorize">Authorize</button></form>`);
    if (sessionCookie) consent.headers.set('set-cookie', `linear_session=${sessionCookie}; Path=/; HttpOnly; Secure; SameSite=Lax`);
    return consent;
  }
  // source: https://linear.app/developers/oauth-2-0-authentication "actor"
  let actor: Row | undefined = person;
  if (q.get('actor') === 'app') {
    actor = ctx.rowsRaw(USER).find((u) => u.deleted !== true && u.app === true && u._org === org.id && u._app === app.id);
    if (!actor) {
      actor = await ctx.create(USER, (id) => ({ ...appUserFields(ctx, id, String(org.id), app),
        isAssignable: scopes.includes('app:assignable'), isMentionable: scopes.includes('app:mentionable') }), 'user.create');
    }
  }
  const id = await ctx.issue(CODE);
  const value = await hexToken(ctx, `linear-code:${id}`);
  await ctx.record(CODE, { app: app.id, org: org.id, actor_user: actor!.id, scope: scopes.join(' '), redirect_uri: redirect, sha256: sha256(ctx, value), expires: new Date(Date.parse(ctx.occurredAt) + CODE_TTL * 1000).toISOString() }, id);
  return back({ code: value });
}
