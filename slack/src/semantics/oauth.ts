// Slack's oauth.* methods (https://docs.slack.dev/reference/methods?family=oauth): an install's authorization code
// exchanged for its tokens.
import type { HandlerContext } from '@volter/world-core';
import { appOfClient, arg, botFor, CODES, fail, keepToken, mintToken, now, ok } from './shared.ts';

type Row = Record<string, unknown>;

/** A code lasts ten minutes ("expires after ten minutes", https://docs.slack.dev/authentication/installing-with-oauth). */
const CODE_LIFE = 600;

/** The client credentials a call carries: HTTP Basic ("preferred"), else the `client_id` and `client_secret` arguments. */
function clientOf(ctx: HandlerContext): { id?: string; secret?: string } {
  const basic = /^basic\s+(\S+)/i.exec(ctx.call.request.headers.get('authorization') ?? '')?.[1];
  if (basic) { try { const [id, secret] = atob(basic).split(':'); return { id, secret }; } catch { /* not Basic */ } }
  return { id: arg(ctx, 'client_id'), secret: arg(ctx, 'client_secret') };
}


/** oauth.v2.access: "Exchanges a temporary OAuth verifier code for an access token". The app's credentials are checked
 *  ("invalid_client_id", "bad_client_secret"); the code is its own, unused and not expired ("invalid_code"), for the
 *  redirect URI the install named ("bad_redirect_uri"). The bot token carries the bot scopes granted, the person's
 *  user token (`authed_user`) the user scopes; an incoming webhook granted on the install page is answered with its
 *  URL. An ordinary workspace install has enterprise null and is_enterprise_install false. */
export async function oauth_v2_access(ctx: HandlerContext): Promise<Response> {
  const client = clientOf(ctx);
  const app = appOfClient(ctx, client.id);
  if (!app) return fail(ctx, 'invalid_client_id');
  if ((app.credentials as Row).client_secret !== client.secret) return fail(ctx, 'bad_client_secret');
  const codeId = arg(ctx, 'code');
  const code = codeId ? ctx.row(CODES, codeId) : undefined;
  if (!code || code.app !== app.id || code.used === true || Number(code.issued) + CODE_LIFE <= now(ctx)) return fail(ctx, 'invalid_code');
  const redirect = arg(ctx, 'redirect_uri');
  if (redirect !== undefined && redirect !== code.redirect_uri) return fail(ctx, 'bad_redirect_uri');
  // This slate models ordinary workspace installs only; a retained org grant cannot create a new org token.
  if (code.enterprise === true) return Response.json({ ok: false, error: 'unknown_method' }, { status: 404 });
  await ctx.write(CODES, String(codeId), { used: true }, 'oauth_code.redeem');
  const team = String(code.team);
  const botScopes = (code.scopes as string[] | undefined) ?? [];
  const userScopes = (code.user_scopes as string[] | undefined) ?? [];
  const where = { team };
  const teamRow = team ? ctx.get('team', team) : undefined;
  const answer: Row = {
    app_id: app.id, ...(teamRow ? { team: { id: team, name: teamRow.name } } : { team: null }), enterprise: null, is_enterprise_install: false,
  };
  if (botScopes.length) {
    const { user, bot } = await botFor(ctx, app, team);
    const token = await mintToken(ctx, 'xoxb-', `bot:${String(app.id)}:${team}:${String(codeId)}`);
    await keepToken(ctx, token, { user, bot, app: app.id, scopes: botScopes, ...where });
    Object.assign(answer, { access_token: token, token_type: 'bot', scope: botScopes.join(','), bot_user_id: user });
    if (botScopes.includes('incoming-webhook') && typeof code.webhook_channel === 'string') {
      const channel = ctx.row('channel', code.webhook_channel);
      const hook = ctx.mint('incoming_webhook');
      const secret = ctx.crypto.digest('sha256', await ctx.secret(`hook:${hook}:${ctx.occurredAt}`), 'hex').slice(0, 24);
      await ctx.write('incoming_webhook', hook, { channel: code.webhook_channel, app: app.id, user, bot, team: team, secret }, 'incoming_webhook.create');
      Object.assign(answer, {
        incoming_webhook: {
          channel: `#${String(channel?.name ?? '')}`, channel_id: code.webhook_channel, configuration_url: `https://${String(teamRow?.domain ?? 'twin')}.slack.com/services/${hook}`,
          url: `https://hooks.slack.com/services/${team}/${hook}/${secret}`,
        },
      });
    }
  }
  const authed: Row = { id: code.user };
  if (userScopes.length) {
    const token = await mintToken(ctx, 'xoxp-', `user:${String(app.id)}:${String(code.user)}:${String(codeId)}`);
    await keepToken(ctx, token, { user: code.user, app: app.id, scopes: userScopes, ...where });
    Object.assign(authed, { scope: userScopes.join(','), access_token: token, token_type: 'user' });
  }
  answer.authed_user = authed;
  // One installed-app subject in the consent workspace.
  await ctx.write('app_install', `${String(app.id)}::${team}`, { ...where, app: app.id, team, installed_by: code.user, at: now(ctx), deleted: false }, 'app.install');
  return ok(ctx, answer);
}
