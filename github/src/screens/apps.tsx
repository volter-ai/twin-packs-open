// A GITHUB APP'S INSTALLATION PAGE — github.com/apps/{slug}/installations/new (a hosted flow,
// https://docs.github.com/en/apps/using-github-apps/installing-your-own-github-app): the person signed in picks an
// account they administer (their own, or an organization they own) and whether the App reaches all its repositories or
// those chosen, and installs it; the App is sent `installation` `created` (the manifest's events, to the App's webhook),
// and the person goes to the App's setup URL with the installation's id (`setup_action=install`) — or, for an App asking
// to identify its user on install, through GitHub's authorization first.
import type { HandlerContext } from '@volter/world-core';
import { nodeId } from '../engine/objects.ts';
import { account, membershipOf, mint, nowIso, ownerOf, roleIn } from '../semantics/shared.ts';
import { back, field, page, person, refused, seeOther, toSignIn } from './shared.tsx';

type Row = Record<string, unknown>;

export async function screen(ctx: HandlerContext): Promise<Response> {
  const m = /^\/apps\/([^/]+)\/installations\/new(?:\/permissions)?$/.exec(new URL(ctx.call.request.url).pathname.replace(/\/+$/, ''));
  const app = m ? ctx.rowsRaw('app').find((a) => a.slug === decodeURIComponent(m[1]!)) : undefined;
  if (!app) return refused(404, 'Not Found');
  const login = person(ctx);
  if (!login) return toSignIn(ctx);
  const owned = ctx.rowsRaw('org_membership').filter((x) => x._login === login && x.state === 'active' && x.role === 'admin').map((x) => String(x._org));
  const appOwner = String((app.owner as Row).login);
  const accounts = app._public === true ? [login, ...owned] : [appOwner].filter((a) => a === login || owned.includes(a));
  if (!accounts.length) return refused(404, 'Not Found');
  const me = { kind: 'user' as const, login, scopes: '*' as const, token: '' };
  const adminOf = (target: string): Row[] => ctx.rowsRaw('repository').filter((r) => ownerOf(r) === target && roleIn(ctx, r, me) === 'admin');
  if (ctx.call.request.method !== 'POST') {
    const target = field(ctx, 'target_login') || field(ctx, 'target') || accounts[0]!;
    return page(`Install ${String(app.name)}`, (
      <>
        <h1>Install {String(app.name)}</h1>
        <form className="gh-box" method="post">
          <label htmlFor="target">Install on</label>
          <select id="target" name="target_login">{accounts.map((a) => <option key={a} value={a} selected={a === target}>{a}</option>)}</select>
          <p><label><input type="radio" name="repository_selection" value="all" checked /> All repositories</label></p>
          <p><label><input type="radio" name="repository_selection" value="selected" /> Only select repositories</label></p>
          {adminOf(target).map((r) => <p key={String(r.id)}><label><input type="checkbox" name="repository_ids" value={String(r.id)} /> {String(r.full_name)}</label></p>)}
          <p className="gh-muted">with these permissions: {Object.entries((app.permissions as Row | undefined) ?? {}).map(([k, v]) => `${k}: ${String(v)}`).join(', ') || 'read-only metadata'}</p>
          <input type="hidden" name="state" value={field(ctx, 'state')} />
          <button type="submit" name="install" value="1">Install</button>
        </form>
      </>
    ), 200, true);
  }
  const target = field(ctx, 'target_login') || field(ctx, 'target') || accounts[0]!;
  if (!accounts.includes(target)) return refused(404, 'Not Found');
  if (ctx.row('org', target) && membershipOf(ctx, target, login)?.role !== 'admin') return refused(404, 'Not Found');
  const selection = field(ctx, 'repository_selection') === 'selected' ? 'selected' : 'all';
  // the repositories chosen, by id (`repository_ids`) or by name (`repositories`)
  const mine = adminOf(target);
  const listed = (v: unknown): string[] => (Array.isArray(v) ? v : v !== undefined && v !== '' ? String(v).split(',') : []).map(String);
  const names = listed(ctx.params.repositories);
  const ids = [...listed(ctx.params.repository_ids), ...mine.filter((r) => names.includes(String(r.name))).map((r) => String(r.id))].filter((id, i, all) => all.indexOf(id) === i && mine.some((r) => String(r.id) === id));
  if (selection === 'selected' && !ids.length) return refused(422, 'Choose at least one repository');
  const held = ctx.rowsRaw('installation').find((i) => String(i.app_id) === String(app.id) && String((i.account as Row).login) === target);
  const id = held ? Number(held.id) : mint(ctx, 'installation');
  const org = !!ctx.row('org', target);
  const who = account(ctx, target);
  const at = nowIso(ctx);
  const covered = selection === 'all' ? mine : mine.filter((r) => ids.includes(String(r.id)));
  await ctx.write('installation', String(id), {
    id, account: who, repository_selection: selection, access_tokens_url: `https://api.github.com/app/installations/${id}/access_tokens`,
    repositories_url: 'https://api.github.com/installation/repositories', html_url: org ? `https://github.com/organizations/${target}/settings/installations/${id}` : `https://github.com/settings/installations/${id}`,
    app_id: ctx.own(app).id, app_slug: app.slug, client_id: app.client_id, target_id: who.id, target_type: org ? 'Organization' : 'User', permissions: app.permissions ?? {}, events: app.events ?? [],
    created_at: held?.created_at ?? at, updated_at: at, single_file_name: null, has_multiple_single_files: false, single_file_paths: [], suspended_by: null, suspended_at: null,
    _repository_ids: selection === 'selected' ? ids : [], _hook_id: app._hook_id, _target_id: who.id, _target_type: org ? 'Organization' : 'User',
    _installation: { id, node_id: nodeId('Installation', id) }, _shown_repositories: covered.map((r) => ({ id: r.id, node_id: r.node_id, name: r.name, full_name: r.full_name, private: r.private === true })),
  }, held ? 'installation.new_permissions_accepted' : 'installation.created');
  const state = field(ctx, 'state') || undefined;
  const callbacks = (app._callback_urls as string[] | undefined) ?? [];
  if (app._request_oauth_on_install === true && callbacks.length) return seeOther(back('https://github.com/login/oauth/authorize', { client_id: String(app.client_id), redirect_uri: callbacks[0], state }));
  if (typeof app._setup_url === 'string' && app._setup_url) return seeOther(back(app._setup_url, { installation_id: String(id), setup_action: held ? 'update' : 'install', state }));
  return seeOther(`https://github.com/settings/installations/${String(id)}`);
}
