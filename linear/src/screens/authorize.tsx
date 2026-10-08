// Linear's authorize page, `https://linear.app/oauth/authorize?client_id=…&redirect_uri=…&response_type=code&scope=…&
// state=…&prompt=consent&actor=app` (oauth-2-0-authentication): a person logs in and authorizes the application for
// their workspace; the browser is sent to the redirect URI with `code` and `state`, or `error=access_denied`. With
// `actor=app` the grant acts as the application itself: its own user in the workspace, made on its first install.
import type { HandlerContext } from '@volter/world-core';
import { APP, appUserFields, CODE, hexToken, ORG, type Row, sha256, USER } from '../semantics/shared.ts';

const PARAMS = ['client_id', 'redirect_uri', 'response_type', 'scope', 'state', 'prompt', 'actor'];
// Where the documentation stops: a code's lifetime is Linear's; the twin gives it ten minutes
const CODE_TTL = 600;
// source: https://linear.app/developers/oauth-2-0-authentication "read"
const SCOPES = new Set(['read', 'write', 'issues:create', 'comments:create', 'timeSchedule:write', 'admin', 'app:assignable', 'app:mentionable']);

export async function screen(ctx: HandlerContext): Promise<Response> {
  const request = ctx.call.request;
  const q = request.method === 'POST' ? new URLSearchParams(ctx.text) : new URL(request.url).searchParams;
  const app = ctx.rowsRaw(APP).find((a) => a.deleted !== true && a.client_id === q.get('client_id'));
  if (!app) return invalid('Invalid client_id');
  const redirect = q.get('redirect_uri') ?? '';
  if (!(app.redirect_uris as string[]).includes(redirect)) return invalid('Invalid redirect_uri');
  if (q.get('response_type') !== 'code') return invalid('Invalid response_type');
  const scopes = (q.get('scope') ?? '').split(/[ ,]+/).filter(Boolean);
  if (!scopes.length || scopes.some((s) => !SCOPES.has(s))) return invalid('Invalid scope');
  const back = (params: Record<string, string>): Response => {
    const u = new URL(redirect);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    if (q.get('state') !== null) u.searchParams.set('state', q.get('state')!);
    return new Response(null, { status: 302, headers: { location: u.toString() } });
  };
  const hidden = PARAMS.filter((p) => q.get(p) !== null).map((p) => `<input type="hidden" name="${p}" value="${esc(q.get(p))}">`).join('');
  let sessionCookie: string | undefined;
  const login = (error = ''): Response => loginPage(hidden, error, q.get('email') ?? '');
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
    const consent = consentPage(String(app.name), String(org.name), scopes, hidden);
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

// Authored visual reference: Rivet's published firsthand Linear consent screenshot,
// https://rivet.dev/blog/2025-05-28-building-linear-agents-in-node-js-and-rivet-full-walkthrough-and-starter-kit/
// (auth-linear.png, 2025-05-28), read 2026-10-08. No vendor markup or assets are copied.
// Action contract: https://linear.app/developers/oauth-2-0-authentication
import { flowPage } from '@volter/world-ui';
const esc = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const CSS = `
*{box-sizing:border-box}body{margin:0;background:#08090a;color:#ededf0;font:14px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}button,input{font:inherit;outline-offset:3px}header{height:60px;padding:20px 28px;color:#ededf0;font-weight:500}.authorize{max-width:540px;margin:28px auto 64px;padding:0 20px}.consent-card{background:#101113;border:1px solid #1f2024;border-radius:9px;padding:36px 32px}.app-heading{text-align:center;margin:0 0 36px}.app-heading h1{font-size:20px;line-height:1.5;font-weight:500;margin:0 0 6px}.app-heading p{color:#898a93;font-size:14px;margin:0}.brand-name{font-size:15px;letter-spacing:-.4px;font-weight:600;margin:0 0 24px;color:#a4a4ad}.permission-title{color:#898a93;font-size:13px;font-weight:500;margin:0 0 7px}.permissions{list-style:none;padding:0;margin:0 0 28px;border:1px solid #222328;background:#191a1e;border-radius:7px;overflow:hidden}.permissions li{padding:12px 16px;border-bottom:1px solid #222328;font-size:13px}.permissions li:last-child{border-bottom:0}.workspace{border:1px solid #222328;border-radius:7px;background:#191a1e;padding:12px 16px;margin-bottom:24px}.workspace small{display:block;color:#898a93;font-size:12px}.workspace strong{font-weight:500}.actions{display:flex;justify-content:flex-end;gap:8px;margin-top:32px}button{border:1px solid #292a31;border-radius:6px;padding:8px 16px;cursor:pointer;background:#222329;color:#ededf0;font-weight:500;font-size:13px}button.primary{background:#5e6ad2;border-color:#5e6ad2;color:#fff}button.primary:hover{background:#6874dc}.trust{color:#898a93;font-size:13px;padding:18px 32px}.trust strong{display:block;color:#c8c8ce;font-weight:500}.login{max-width:380px;margin:100px auto;padding:0 24px}.login h1{font-size:24px;font-weight:500;text-align:center;margin:0 0 28px}.login label{display:block;font-size:13px;margin:0 0 18px}.login input{display:block;margin-top:7px;width:100%;border:1px solid #34353d;border-radius:6px;padding:10px 12px;color:#ededf0;background:#151619}.login button{width:100%}.error{padding:12px 16px;border:1px solid #653535;border-radius:6px;color:#f3b6b6;background:#241515;margin:0 0 20px}.invalid{max-width:480px;margin:100px auto;padding:24px}@media(max-width:540px){header{padding:16px 20px}.authorize{margin-top:16px}.consent-card{padding:28px 20px}.trust{padding:18px 20px}.app-heading h1{font-size:18px}.login{margin-top:60px}}
`;
function page(body: string, status = 200, workspace?: string): Response {
  // The authored fragments below escape every value from state and the request.
  return flowPage({ title: 'Linear', css: [CSS], status, body: <div
    dangerouslySetInnerHTML={{ __html: `<header>${esc(workspace ?? 'Linear')}</header>${body}` }}
  /> });
}

const invalid = (message: string): Response => page(`<main class="invalid"><h1>Unable to authorize application</h1><p class="error" role="alert">${esc(message)}</p></main>`, 400);
function loginPage(hidden: string, error: string, email: string): Response {
  return page(`<main class="login"><h1>Log in to Linear</h1>${error ? `<p class="error" role="alert">${esc(error)}</p>` : ''}<form method="post">${hidden}<label>Email address<input name="email" type="email" autocomplete="username" value="${esc(email)}" required></label><label>Password<input name="password" type="password" autocomplete="current-password" required></label><button class="primary" type="submit">Continue</button></form></main>`, error ? 400 : 200);
}
const PERMISSIONS: Record<string, string> = {
  read: 'Read access to your workspace', write: 'Write access to your workspace',
  'issues:create': 'Create issues and their attachments', 'comments:create': 'Create comments on issues',
  'timeSchedule:write': 'Create and modify time schedules', admin: 'Admin access to manage settings and people',
  'app:assignable': 'Assign issues and projects to the app in teams it can access',
  'app:mentionable': 'Mention app in issues, projects, and documents it can access',
};
function consentPage(appName: string, workspace: string, scopes: string[], hidden: string): Response {
  return page(`<main class="authorize"><section class="consent-card" aria-labelledby="consent-title"><div class="app-heading"><div class="brand-name">${esc(appName)} · Linear</div><h1 id="consent-title">${esc(appName)} is requesting access</h1><p>Authenticating with your ${esc(workspace)} workspace</p></div><h2 class="permission-title">Permissions</h2><ul class="permissions">${scopes.map(scope => `<li>${esc(PERMISSIONS[scope] ?? scope)}</li>`).join('')}</ul><h2 class="permission-title">Workspace</h2><div class="workspace"><strong>${esc(workspace)}</strong></div><form method="post">${hidden}<div class="actions"><button type="submit" name="decision" value="cancel">Cancel</button><button class="primary" type="submit" name="decision" value="authorize">Authorize</button></div></form></section><div class="trust"><strong>Make sure you trust this application</strong>Familiarize yourself with ${esc(appName)} before granting access.</div></main>`, 200, workspace);
}
