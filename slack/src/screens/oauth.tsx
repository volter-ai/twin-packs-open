// SLACK'S INSTALL PAGE — slack.com/oauth/v2/authorize (a hosted flow, docs/contributing/architecture.md, "Screens"):
// an app asks for its scopes, bot (`scope`) and user (`user_scope`); the person allows or cancels, and Slack sends
// them back to the app's `redirect_uri` with a `code` (or `error=access_denied`) and the `state`
// (https://docs.slack.dev/authentication/installing-with-oauth). An app asking for `incoming-webhook` has the person
// pick the channel it posts to. Enterprise Grid installation is outside this slate.
//
// The app is one made in the person's own workspace, or one distributed from another; its redirect URI must be one its
// manifest lists ("bad_redirect_uri"). Where the documentation stops and the twin decides: the page's words; a code is
// 40 hex characters.
import { twinVendorUrl, type HandlerContext } from '@volter/world-core';
import { appName, redirectsOf } from '../engine/app-manifest.ts';
import { listArg } from '../engine/wire.ts';
import { channelTeam, appOfClient, channelMembers, CODES, serial } from '../semantics/shared.ts';
import { field, page, refused, seeOther, visitor } from './shared.tsx';
import { toSignIn } from '@volter/world-ui';

type Row = Record<string, unknown>;

// Visual reference: the firsthand permission-page image in Orkes' 2024-04-17 Slack integration
// walkthrough. Existing scopes, channel choices, code issuance and callbacks remain the wire contract.
const CONSENT_CSS = `
body:has(.slack-consent){background:#fff}.sk:has(.slack-consent){max-width:760px;margin:24px auto 48px;padding:0 30px}.slack-consent .consent-top{display:flex;justify-content:space-between;align-items:center;margin-bottom:42px}.slack-consent .slack-wordmark{font-size:23px;font-weight:800;letter-spacing:-.7px}.slack-consent .workspace{color:#616061;border:1px solid #ddd;border-radius:6px;padding:5px 12px;font-size:13px}.slack-consent .consent-identity{display:flex;align-items:center;justify-content:center;gap:34px;margin-bottom:28px}.slack-consent .identity-card{width:68px;height:68px;display:grid;place-items:center;border:1px solid #ddd;border-radius:12px;background:#f8f8f8;font-size:29px;font-weight:700}.slack-consent .identity-direction{font-size:23px;color:#868686}.slack-consent h1{text-align:center;font-size:27px;line-height:1.35;margin:0 0 34px;font-weight:750}.slack-consent .sk-card{border:0;border-radius:0;padding:0;margin:0;background:#fff}.slack-consent h2{font-size:19px;line-height:1.4;margin:28px 0 14px}.slack-consent .permission-group{border-bottom:1px solid #ddd;padding:15px 0}.slack-consent summary{cursor:pointer;font-size:16px;font-weight:500}.slack-consent .permission-group ul{color:#616061;font-size:14px;line-height:1.8;margin:12px 0 0 24px}.slack-consent .permission-group code{background:transparent;padding:0}.slack-consent .channel-description{color:#616061}.slack-consent .channel-picker{display:block;margin:12px 0 28px}.slack-consent .channel-picker select{padding:13px 16px;background:#fff}.slack-consent .consent-footnote{font-size:13px;color:#616061;margin-top:28px;line-height:1.6}.slack-consent .sk-actions{justify-content:flex-end;margin-top:28px}.slack-consent .sk-actions button{font-size:16px;padding:10px 22px;border-radius:5px}.slack-consent .sk-quiet{border-color:#bbb}@media(max-width:600px){.sk:has(.slack-consent){padding:0 20px;margin-top:20px}.slack-consent .consent-top{margin-bottom:28px}.slack-consent h1{font-size:23px}.slack-consent .identity-card{width:58px;height:58px}}
`;

/** A redirect URI with the answer's parameters. */
function back(uri: string, params: Record<string, string>): string {
  const url = new URL(uri);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.href;
}

export async function screen(ctx: HandlerContext): Promise<Response> {
  const method = ctx.call.request.method;
  const who = visitor(ctx);
  if (!who?.row) {
    const asked = new URL(ctx.call.request.url);
    return toSignIn(twinVendorUrl(ctx.call.request, '/signin'), `${asked.pathname}${asked.search}`);
  }
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
    const channels = ctx.rowsRaw('channel').filter((c) => channelTeam(c) === team && c.is_im !== true && c.is_archived !== true && (c.is_private !== true || channelMembers(ctx, String(c.id)).includes(who.id)));
    return page(`Install ${appName(manifest)}`, (
      <section className="slack-consent">
        <header className="consent-top"><span className="slack-wordmark">Slack</span><span className="workspace">{workspace}</span></header>
        <div className="consent-identity" aria-hidden="true"><span className="identity-card">{appName(manifest).slice(0, 1).toUpperCase()}</span><span className="identity-direction">↔</span><span className="identity-card">{workspace.slice(0, 1).toUpperCase()}</span></div>
        <h1>{appName(manifest)} is requesting permission to access the {`${workspace} Slack workspace`}</h1>
        <form className="sk-card" method="post" action={twinVendorUrl(ctx.call.request, '/oauth/v2/authorize')}>
          {scopes.length ? <><h2>What will {appName(manifest)} be able to do?</h2><details className="permission-group"><summary>Permissions for the app</summary><ul>{scopes.map((s) => <li key={s}><code>{s}</code></li>)}</ul></details></> : null}
          {userScopes.length ? <details className="permission-group"><summary>Permissions on your behalf</summary><ul>{userScopes.map((s) => <li key={s}><code>{s}</code></li>)}</ul></details> : null}
          {webhook ? <><h2>Where should {appName(manifest)} post?</h2><p className="channel-description">Select a channel for this app’s incoming webhook.</p><label className="channel-picker"><span>Channel</span><select id="webhook_channel" name="webhook_channel">{channels.map((c) => <option key={String(c.id)} value={String(c.id)}>#{String(c.name)}</option>)}</select></label></> : null}
          {(['client_id', 'scope', 'user_scope', 'redirect_uri', 'state', 'install_on'] as const).map((k) => <input key={k} type="hidden" name={k} value={read(k)} />)}
          <p className="consent-footnote">Allow grants the permissions listed above to this app in {workspace}. Cancel returns to the app without granting access.</p>
          <div className="sk-actions"><button className="sk-quiet" name="answer" value="cancel">Cancel</button><button name="answer" value="allow">Allow</button></div>
        </form>
      </section>
    ), 200, [CONSENT_CSS]);
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
