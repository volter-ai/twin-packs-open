// SLACK'S MANAGE APPS — a workspace's installed apps, where a member removes one: "Select Tools & settings from the menu,
// then click Manage apps … select Installed Apps. Find and select the app you want to remove … Scroll down to Remove App"
// (https://slack.com/help/articles/360003125231-Remove-apps-and-custom-integrations-from-your-workspace). Removing an app
// ends its install in the workspace and revokes its tokens there, as apps.uninstall does, so the app is told
// (app_uninstalled, tokens_revoked). A workspace (docs/contributing/architecture.md, "Screens"): every member but a guest
// reaches it.
import type { HandlerContext } from '@volter/world-core';
import { appName } from '../engine/app-manifest.ts';
import { uninstallApp } from '../semantics/shared.ts';
import { field, page, refused, visitor } from './shared.tsx';

type Row = Record<string, unknown>;

function installed(ctx: HandlerContext, team: string, notice?: string): Response {
  const apps = ctx.rowsRaw('app_install').filter((i) => i.team === team).map((i) => ctx.row('app', String(i.app))).filter((a): a is Row => !!a && a.deleted !== true);
  return page('Installed Apps', (
    <>
      <h1>Installed Apps</h1>
      {notice ? <p className="sk-notice" role="status">{notice}</p> : null}
      <div className="sk-card">
        {apps.length === 0 ? <p>No apps are installed.</p> : apps.map((a) => (
          <form key={String(a.id)} className="sk-row" method="post" action="/apps/manage">
            <span>{appName(a.manifest as Row)}</span>
            <input type="hidden" name="app" value={String(a.id)} />
            <button className="sk-quiet" name="action" value="remove">Remove App</button>
          </form>
        ))}
      </div>
    </>
  ), notice ? 201 : 200);
}

export async function screen(ctx: HandlerContext): Promise<Response> {
  const who = visitor(ctx);
  if (!who?.row) return refused(401, 'Sign in to Slack first');
  // source: https://slack.com/help/articles/360003125231-Remove-apps-and-custom-integrations-from-your-workspace "By default, all members except for guests"
  if (who.row.is_restricted === true) return refused(403, 'Guests cannot manage apps');
  const team = String(who.row.team_id);
  if (ctx.call.request.method === 'GET') return installed(ctx, team);
  if (field(ctx, 'action') !== 'remove') return refused(400, 'Choose an action');
  const app = ctx.row('app', field(ctx, 'app'));
  if (!app || !ctx.row('app_install', `${String(app.id)}::${team}`)) return refused(404, 'This app is not installed');
  await uninstallApp(ctx, app, team);
  return installed(ctx, team, `${appName(app.manifest as Row)} was removed`);
}
