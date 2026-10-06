// What github.com's pages share (docs/contributing/architecture.md, "Pack layout": screens/shared.tsx): its look, who is
// signed in (the `user_session` cookie, semantics/shared.ts), a page's form fields, and the new-App-from-a-manifest
// flow its settings and organizations pages both serve. Authored from plain markup under GitHub's colors (Primer's);
// nothing of GitHub's pages is copied.
import type { HandlerContext } from '@volter/world-core';
import { flowPage } from '@volter/world-ui';
import { FIRST_PARTY_OAUTH_APPS } from '../engine/catalog.ts';
import { makeApp, signedIn } from '../semantics/shared.ts';

type Row = Record<string, unknown>;

export const GITHUB_CSS = `
* { box-sizing: border-box; }
body { margin: 0; background: #f6f8fa; color: #1f2328; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif; font-size: 14px; line-height: 1.5; }
.gh { max-width: 340px; margin: 48px auto; padding: 0 16px; }
.gh-wide { max-width: 880px; }
.gh h1 { font-size: 24px; font-weight: 300; text-align: center; margin: 0 0 16px; }
.gh-wide h1 { text-align: left; font-weight: 600; }
.gh-box { background: #fff; border: 1px solid #d1d9e0; border-radius: 6px; padding: 16px; margin-bottom: 16px; }
.gh-box label { display: block; font-weight: 600; margin: 8px 0 6px; }
.gh-box input[type=text], .gh-box input[type=password], .gh-box input[type=email] { width: 100%; padding: 5px 12px; border: 1px solid #d1d9e0; border-radius: 6px; font: inherit; line-height: 20px; }
.gh button { width: 100%; margin-top: 16px; background: #1f883d; color: #fff; border: 1px solid rgba(31,35,40,0.15); border-radius: 6px; padding: 5px 16px; font: inherit; font-weight: 500; line-height: 20px; cursor: pointer; }
.gh button.gh-quiet { background: #f6f8fa; color: #25292e; border-color: #d1d9e0; }
.gh-flash { background: #ffebe9; border: 1px solid rgba(255,129,130,0.4); border-radius: 6px; padding: 16px; margin-bottom: 16px; }
.gh-row { display: flex; gap: 8px; align-items: center; padding: 8px 16px; border-top: 1px solid #d1d9e0; }
.gh-row:first-child { border-top: 0; }
.gh-muted { color: #59636e; }
.gh code { font: 12px ui-monospace, SFMono-Regular, Menlo, monospace; background: rgba(129,139,152,0.12); padding: 2px 4px; border-radius: 6px; }
`;

type Body = Parameters<typeof flowPage>[0]['body'];

/** A github.com page. */
export const page = (title: string, body: Body, status = 200, wide = false): Response =>
  flowPage({ title: `${title} · GitHub`, css: [GITHUB_CSS], body: <main className={wide ? 'gh gh-wide' : 'gh'}>{body}</main>, status });

/** A page saying what went wrong. */
export const refused = (status: number, text: string): Response => page(status === 404 ? 'Page not found' : 'Error', <><h1>{text}</h1></>, status);

/** A form's field or a query's parameter. */
export const field = (ctx: HandlerContext, name: string): string => {
  const v = ctx.params[name];
  if (v !== undefined && v !== null) return String(v);
  return new URL(ctx.call.request.url).searchParams.get(name) ?? '';
};

/** A 302. */
export const seeOther = (location: string, headers: Record<string, string> = {}): Response => new Response(null, { status: 302, headers: { location, ...headers } });

/** A signed-out visitor sent to the sign-in, to come back to the page (and the login an application suggests). */
export function toSignIn(ctx: HandlerContext, login?: string): Response {
  const url = new URL(ctx.call.request.url);
  const back = `${url.pathname}${url.search}`;
  return seeOther(`/login?return_to=${encodeURIComponent(back)}${login ? `&login=${encodeURIComponent(login)}` : ''}`);
}

/** The person signed in, or undefined. */
export const person = (ctx: HandlerContext): string | undefined => signedIn(ctx);

/** A URL with the answer's parameters. */
export function back(uri: string, params: Record<string, string | undefined>): string {
  const url = new URL(uri);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, v);
  return url.href;
}

/** The device flow's codes (screens/device.tsx makes them). */
export const DEVICES = '_device_code';

/** The scopes GitHub knows (https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps). */
const KNOWN = new Set(['repo', 'repo:status', 'repo_deployment', 'public_repo', 'repo:invite', 'security_events', 'admin:repo_hook', 'write:repo_hook', 'read:repo_hook', 'admin:org', 'write:org', 'read:org',
  'admin:public_key', 'write:public_key', 'read:public_key', 'admin:org_hook', 'gist', 'notifications', 'user', 'read:user', 'user:email', 'user:follow', 'project', 'read:project', 'delete_repo',
  'write:packages', 'read:packages', 'delete:packages', 'admin:gpg_key', 'write:gpg_key', 'read:gpg_key', 'codespace', 'workflow', 'write:discussion', 'read:discussion', 'admin:enterprise', 'audit_log', 'copilot']);
export const scopesOf = (raw: string): string[] => [...new Set(raw.split(/[\s,]+/).filter((s) => KNOWN.has(s)))].sort();

/** The application a client id names: an OAuth app (GitHub's own, or one registered), or a GitHub App. */
export function clientOf(ctx: HandlerContext, id: string): { app: Row; kind: 'oauth' | 'github_app' } | undefined {
  const first = FIRST_PARTY_OAUTH_APPS[id];
  if (first) return { app: { client_id: id, name: first.name, owner: { login: first.owner }, url: first.url, _first_party: true }, kind: 'oauth' };
  const o = ctx.row('oauth_app', id);
  if (o) return { app: o, kind: 'oauth' };
  const g = ctx.rowsRaw('app').find((a) => a.client_id === id);
  return g ? { app: g, kind: 'github_app' } : undefined;
}

type Manifest = {
  name?: string; url?: string; description?: string; redirect_url?: string; setup_url?: string; callback_urls?: string[];
  hook_attributes?: { url?: string; active?: boolean }; public?: boolean; default_events?: string[]; default_permissions?: Record<string, string>; request_oauth_on_install?: boolean;
};

/** A new GitHub App from a manifest (https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-from-a-manifest):
 *  an application posts a form holding its `manifest` (JSON) and a `state`; the person signed in sees the App it
 *  describes and creates it; GitHub registers it for the owner and sends them to the manifest's `redirect_url` with a
 *  temporary `code` (and the `state`), which the application exchanges within an hour, once, for the App's credentials
 *  (semantics/apps.ts, create-from-manifest). Only an organization's owner registers one for it. */
export async function manifestFlow(ctx: HandlerContext, owner: string | undefined, action: string): Promise<Response> {
  const login = person(ctx);
  if (!login) return toSignIn(ctx);
  const account = owner ?? login;
  if (owner && (ctx.row('org_membership', `${owner}::${login}`)?.role !== 'admin' || ctx.row('org_membership', `${owner}::${login}`)?.state !== 'active')) return refused(404, 'Not Found');
  let manifest: Manifest;
  try { manifest = JSON.parse(field(ctx, 'manifest')) as Manifest; } catch { return refused(422, 'The manifest is not valid JSON.'); }
  if (!manifest.name || !manifest.url) return refused(422, 'A manifest needs a name and a url.');
  const state = field(ctx, 'state');
  if (field(ctx, 'create') !== '1') {
    const permissions = Object.entries(manifest.default_permissions ?? {});
    return page('Create GitHub App', (
      <>
        <h1>Create GitHub App for {account}</h1>
        <form className="gh-box" method="post" action={action}>
          <p><strong>{manifest.name}</strong></p>
          {manifest.description ? <p className="gh-muted">{manifest.description}</p> : null}
          <p className="gh-muted">Homepage: <code>{manifest.url}</code></p>
          {permissions.length ? <><p>Permissions</p><ul>{permissions.map(([k, v]) => <li key={k}><code>{k}</code>: {v}</li>)}</ul></> : null}
          {manifest.default_events?.length ? <><p>Events</p><ul>{manifest.default_events.map((e) => <li key={e}><code>{e}</code></li>)}</ul></> : null}
          <input type="hidden" name="manifest" value={JSON.stringify(manifest)} />
          <input type="hidden" name="state" value={state} />
          <input type="hidden" name="create" value="1" />
          <button type="submit">Create GitHub App for {account}</button>
        </form>
      </>
    ));
  }
  const code = ctx.crypto.digest('sha256', await ctx.secret(`manifest-code:${manifest.name}:${ctx.occurredAt}`), 'hex').slice(0, 20);
  const hook = manifest.hook_attributes?.url && manifest.hook_attributes.active !== false ? manifest.hook_attributes.url : undefined;
  const app = await makeApp(ctx, account, {
    name: manifest.name, url: manifest.url, description: manifest.description ?? null, permissions: manifest.default_permissions ?? {}, events: manifest.default_events ?? [],
    setup_url: manifest.setup_url ?? null, callback_urls: manifest.callback_urls ?? [], request_oauth_on_install: manifest.request_oauth_on_install === true, public: manifest.public === true,
    ...(hook ? { hook_url: hook } : {}), _code: code,
  } as Row);
  if (!app) return refused(422, `Name "${manifest.name}" is already taken`);
  const to = manifest.redirect_url ?? `https://github.com/settings/apps/${String(app.slug)}`;
  return seeOther(back(to, { code, ...(state ? { state } : {}) }));
}
