// SLACK'S INSTALL PAGE — slack.com/oauth/v2/authorize (a hosted flow, docs/contributing/architecture.md, "Screens"):
// an app asks for its scopes, bot (`scope`) and user (`user_scope`); the person allows or cancels, and Slack sends
// them back to the app's `redirect_uri` with a `code` (or `error=access_denied`) and the `state`
// (https://docs.slack.dev/authentication/installing-with-oauth). An app asking for `incoming-webhook` has the person
// pick the channel it posts to. Enterprise Grid installation is outside this slate.
//
// The app is one made in the person's own workspace, or one distributed from another; its redirect URI must be one its
// manifest lists ("bad_redirect_uri"). Where the documentation stops and the twin decides: the page's words; a code is
// 40 hex characters.
import type { HandlerContext } from '@volter/world-core';
import { appName, redirectsOf } from '../engine/app-manifest.ts';
import { listArg } from '../engine/wire.ts';
import { appOfClient, channelMembers, CODES, serial } from '../semantics/shared.ts';
import { field, page, refused, seeOther, visitor } from './shared.tsx';

type Row = Record<string, unknown>;

/** A redirect URI with the answer's parameters. */
function back(uri: string, params: Record<string, string>): string {
  const url = new URL(uri);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.href;
}

export async function screen(ctx: HandlerContext): Promise<Response> {
  const method = ctx.call.request.method;
  const who = visitor(ctx);
  if (!who?.row) return refused(401, 'Sign in to Slack first');
  const query = new URL(ctx.call.request.url).searchParams;
  const read = (k: string): string => (method === 'GET' ? query.get(k) ?? '' : field(ctx, k));
  const app = appOfClient(ctx, read('client_id'));
  if (!app) return refused(400, 'Invalid client_id parameter');
  const team = String(who.row.team_id);
  if (app.distributed !== true && app.team_id !== team) return refused(400, "This app hasn't been distributed");
  const manifest = app.manifest as Row;
  const redirect = read('redirect_uri') || redirectsOf(manifest)[0] || '';
  if (!redirectsOf(manifest).includes(redirect)) return refused(400, 'bad_redirect_uri');
  const scopes = listArg(read('scope'));
  const userScopes = listArg(read('user_scope'));
  // Grid installation is outside this pack's modeled scope; never mint a successful org grant.
  if (read('install_on') === 'enterprise') return Response.json({ ok: false, error: 'unknown_method' }, { status: 404 });
  const workspace = String(ctx.get('team', team)?.name ?? '');
  const webhook = scopes.includes('incoming-webhook');
  if (method === 'GET') {
    const channels = ctx.rowsRaw('channel').filter((c) => c.team_id === team && c.is_im !== true && c.is_archived !== true && (c.is_private !== true || channelMembers(ctx, String(c.id)).includes(who.id)));
    return page(`Install ${appName(manifest)}`, (
      <>
        <h1>{appName(manifest)} is requesting permission to access the {`${workspace} Slack workspace`}</h1>
        <form className="sk-card" method="post" action="/oauth/v2/authorize">
          {scopes.length ? <><p>What will {appName(manifest)} be able to do?</p><ul>{scopes.map((s) => <li key={s}><code>{s}</code></li>)}</ul></> : null}
          {userScopes.length ? <><p>On your behalf, it will be able to:</p><ul>{userScopes.map((s) => <li key={s}><code>{s}</code></li>)}</ul></> : null}
          {webhook ? <><label htmlFor="webhook_channel">Where should {appName(manifest)} post?</label><select id="webhook_channel" name="webhook_channel">{channels.map((c) => <option key={String(c.id)} value={String(c.id)}>#{String(c.name)}</option>)}</select></> : null}
          {(['client_id', 'scope', 'user_scope', 'redirect_uri', 'state', 'install_on'] as const).map((k) => <input key={k} type="hidden" name={k} value={read(k)} />)}
          <div className="sk-actions"><button className="sk-quiet" name="answer" value="cancel">Cancel</button><button name="answer" value="allow">Allow</button></div>
        </form>
      </>
    ));
  }
  if (method !== 'POST') return refused(405, 'Method not allowed');
  const state = read('state');
  if (field(ctx, 'answer') !== 'allow') return seeOther(back(redirect, { error: 'access_denied', ...(state ? { state } : {}) }));
  const channel = webhook ? field(ctx, 'webhook_channel') : '';
  if (webhook && !ctx.row('channel', channel)) return refused(400, 'Choose a channel to post to');
  const code = ctx.crypto.digest('sha256', await ctx.secret(`code:${String(app.id)}:${who.id}:${ctx.occurredAt}:${await serial(ctx, 'oauth_code')}`), 'hex').slice(0, 40);
  await ctx.record(CODES, {
    app: app.id, user: who.id, team, enterprise: false, scopes, user_scopes: userScopes, redirect_uri: redirect,
    ...(webhook ? { webhook_channel: channel } : {}), issued: Math.floor(Date.parse(ctx.occurredAt) / 1000), used: false,
  }, code);
  return seeOther(back(redirect, { code, ...(state ? { state } : {}) }));
}
