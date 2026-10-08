// SLACK'S YOUR APPS — api.slack.com/apps, where a developer sees their apps and generates the app configuration tokens
// the App Manifest APIs take: "Under Your App Configuration Tokens, click Generate Token … Select the workspace", shown
// once as an access token and a refresh token
// (https://docs.slack.dev/app-manifests/configuring-apps-with-app-manifests#config-tokens); and on an app's Basic
// Information page its app-level tokens, which Socket Mode connects with: "App-Level Tokens … Generate Token and Scopes",
// named, with the scopes chosen (`connections:write`), shown once (https://docs.slack.dev/apis/events-api/using-socket-mode). A workspace (docs/
// contributing/architecture.md, "Screens").
import type { HandlerContext } from '@volter/world-core';
import { appName } from '../engine/app-manifest.ts';
import { issueConfigTokens, keepToken, teamsOf } from '../semantics/shared.ts';
import { field, page, refused, visitor } from './shared.tsx';

type Row = Record<string, unknown>;

export async function screen(ctx: HandlerContext): Promise<Response> {
  const method = ctx.call.request.method;
  const who = visitor(ctx);
  if (!who?.row) return refused(401, 'Sign in to Slack first');
  const teams = teamsOf(ctx, String(who.row.id));
  if (method === 'GET') {
    const mine = ctx.rowsRaw('app').filter((a) => a.creator === who.id && a.deleted !== true);
    return page('Your Apps', (
      <>
        <h1>Your Apps</h1>
        <div className="sk-card">{mine.length === 0 ? <p>You have no apps yet.</p> : mine.map((a) => <div key={String(a.id)} className="sk-row"><span>{appName(a.manifest as Row)}</span><code>{String(a.id)}</code></div>)}</div>
        <h2>Your App Configuration Tokens</h2>
        <form className="sk-card" method="post" action={`${ctx.publicBase}/apps`}>
          <label htmlFor="team">Workspace</label>
          <select id="team" name="team">{teams.map((t) => <option key={t} value={t}>{String(ctx.get('team', t)?.name ?? t)}</option>)}</select>
          <div className="sk-actions"><button type="submit">Generate Token</button></div>
        </form>
      </>
    ));
  }
  if (method !== 'POST') return refused(405, 'Method not allowed');
  const appLevel = /^\/apps\/([A-Za-z0-9]+)\/app-level-tokens$/.exec(new URL(ctx.call.request.url).pathname.replace(/\/+$/, ''));
  if (appLevel) return appLevelToken(ctx, appLevel[1]!, String(who.id));
  const team = field(ctx, 'team');
  if (!teams.includes(team)) return refused(403, 'You are not a member of that workspace');
  const t = await issueConfigTokens(ctx, who.id, team);
  return page('Your App Configuration Tokens', (
    <>
      <h1>Your new tokens</h1>
      <p className="sk-notice">Copy them now: they are shown once. Your access token is <code>{t.token}</code> and your refresh token is <code>{t.refresh_token}</code>. The access token expires in 12 hours.</p>
      <div className="sk-card"><p>access token is {t.token}</p><p>refresh token is {t.refresh_token}</p></div>
    </>
  ), 201);
}

/** An app-level token of an app its maker made: `xapp-1-<app>-…`, with the scopes chosen, kept by its hash. */
async function appLevelToken(ctx: HandlerContext, appId: string, by: string): Promise<Response> {
  const app = ctx.row('app', appId);
  if (!app || app.creator !== by) return refused(404, 'No such app');
  const name = field(ctx, 'name').trim();
  const scopes = field(ctx, 'scopes').split(/[\s,]+/).filter(Boolean);
  if (!name || !scopes.length) return refused(400, 'Name the token and add a scope');
  const d = ctx.crypto.digest('sha256', `app-level:${appId}:${name}:${ctx.occurredAt}`, 'hex');
  const token = `xapp-1-${appId}-${String(BigInt(`0x${d.slice(0, 10)}`))}-${d.slice(10, 74)}`;
  await keepToken(ctx, token, { app: appId, team: app.team_id, scopes, name });
  return page('App-Level Tokens', (
    <>
      <h1>{name}</h1>
      <p className="sk-notice">Copy it now: it is shown once. The token is {token}, with {scopes.join(', ')}.</p>
    </>
  ), 201);
}
