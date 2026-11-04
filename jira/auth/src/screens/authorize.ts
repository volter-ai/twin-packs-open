// Atlassian's authorize page, `https://auth.atlassian.com/authorize?audience=api.atlassian.com&client_id=…&scope=…&
// redirect_uri=…&state=…&response_type=code&prompt=consent` (the 3LO page): the person logs in, chooses the site the
// app may use, and accepts; the browser is sent to the callback URL with `code` and `state`, or `error=access_denied`.
// In a World the person is one of the World's (the sites and people doors).
import type { HandlerContext } from '@volter/world-core';
import { APP, CODE, PERSON, type Row, sha256, SITE, tokenValue } from '../../../src/semantics/shared.ts';

const esc = (v: unknown): string => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const page = (body: string, status = 200): Response => new Response(`<!doctype html><html><head><meta charset="utf-8"><title>Atlassian</title></head><body>${body}</body></html>`, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });
const PARAMS = ['audience', 'client_id', 'scope', 'redirect_uri', 'state', 'response_type', 'prompt'];
// Where the documentation stops: a code's lifetime is Atlassian's; the twin gives it ten minutes
const CODE_TTL = 600;

export async function screen(ctx: HandlerContext): Promise<Response> {
  const request = ctx.call.request;
  const q = request.method === 'POST' ? new URLSearchParams(ctx.text) : new URL(request.url).searchParams;
  // source: https://developer.atlassian.com/cloud/jira/platform/oauth-2-3lo-apps/ "audience=api.atlassian.com"
  if (q.get('audience') !== 'api.atlassian.com') return page('<p>Invalid audience</p>', 400);
  const app = ctx.rowsRaw(APP).find((a) => a.deleted !== true && a.client_id === q.get('client_id'));
  if (!app) return page('<p>Invalid client_id</p>', 400);
  const redirect = q.get('redirect_uri') ?? '';
  if (!(app.callback_urls as string[]).includes(redirect)) return page('<p>redirect_uri does not match the callback URL</p>', 400);
  if (q.get('response_type') !== 'code') return page('<p>Invalid response_type</p>', 400);
  const scopes = (q.get('scope') ?? '').split(/[ +]/).filter(Boolean);
  if (!scopes.length) return page('<p>Invalid scope</p>', 400);
  const back = (params: Record<string, string>): Response => {
    const u = new URL(redirect);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    if (q.get('state') !== null) u.searchParams.set('state', q.get('state')!);
    return new Response(null, { status: 302, headers: { location: u.toString() } });
  };
  const hidden = PARAMS.filter((p) => q.get(p) !== null).map((p) => `<input type="hidden" name="${p}" value="${esc(q.get(p))}">`).join('');
  const login = (error = ''): Response => page(`<h1>Log in to continue</h1>${error ? `<p>${esc(error)}</p>` : ''}<form method="post">${hidden}<input name="email"><input type="password" name="password"><button>Log in</button></form>`, error ? 400 : 200);
  if (request.method !== 'POST') return login();
  const person = ctx.rowsRaw(PERSON).find((p) => p.deleted !== true && p.email === q.get('email'));
  if (!person || person.password_sha256 !== sha256(ctx, `${String(person.id)}:${String(q.get('password') ?? '')}`)) return login('Incorrect email address and / or password.');
  if (q.get('decision') === 'cancel') return back({ error: 'access_denied' });
  const sites = (person.sites as string[]).map((id) => ctx.row(SITE, id)).filter((s): s is Row => Boolean(s));
  if (q.get('decision') !== 'accept') {
    const creds = `<input type="hidden" name="email" value="${esc(q.get('email'))}"><input type="hidden" name="password" value="${esc(q.get('password'))}">`;
    return page(`<h1>${esc(app.name)} is requesting access to your Atlassian account.</h1><ul>${scopes.map((s) => `<li>${esc(s)}</li>`).join('')}</ul><form method="post">${hidden}${creds}<label>Use app on <select name="site">${sites.map((s) => `<option value="${esc(s.id)}">${esc(s.url)}</option>`).join('')}</select></label><button name="decision" value="cancel">Cancel</button><button name="decision" value="accept">Accept</button></form>`);
  }
  const site = sites.find((s) => s.id === q.get('site'));
  if (!site) return page('<p>Choose a site you can use</p>', 400);
  const id = ctx.mint(CODE);
  const value = await tokenValue(ctx, `jira-code:${id}`);
  await ctx.record(CODE, { app: app.id, sites: [site.id], person: person.id, scope: scopes.join(' '), redirect_uri: redirect, sha256: sha256(ctx, value), expires: new Date(Date.parse(ctx.occurredAt) + CODE_TTL * 1000).toISOString() }, id);
  return back({ code: value });
}
