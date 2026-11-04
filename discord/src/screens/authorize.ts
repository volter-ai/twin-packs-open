// Discord's authorize page, `https://discord.com/oauth2/authorize?client_id=…&scope=…&redirect_uri=…&response_type=code&
// state=…` (topics/oauth2; `/api/oauth2/authorize` alike): the person logs in, picks a server when the app asks for
// `bot`, and authorizes. The browser is sent to the redirect URI with `code` and `state` (and `guild_id` and
// `permissions` for a bot install), or with `error=access_denied` when the person cancels; a bot install without a
// redirect ends on the page. The page always asks (a bot install is a passthrough scope Discord
// always asks for). The implicit grant and the webhook.incoming flow are Discord's and the twin's gap:
// nothing of the demand or the life asks for them. In a World the person is one of the World's (the people door).
import type { HandlerContext } from '@volter/world-core';
import { APP, basePermissions, CODE, gap, GUILD, join, makeRole, MEMBER, memberOf, P, type Row, sha256, tokenValue, USER } from '../semantics/shared.ts';

const esc = (v: unknown): string => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const page = (body: string, status = 200): Response => new Response(`<!doctype html><html><head><meta charset="utf-8"><title>Discord</title></head><body>${body}</body></html>`, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });
const PARAMS = ['client_id', 'scope', 'redirect_uri', 'state', 'response_type', 'prompt', 'permissions', 'integration_type', 'guild_id', 'disable_guild_select'];
// Where the documentation stops: a code's lifetime is Discord's; the twin gives it ten minutes
const CODE_TTL = 600;
// source: https://docs.discord.com/developers/topics/oauth2 "OAuth2 Scopes"
const SCOPES = new Set(['activities.read', 'activities.write', 'applications.builds.read', 'applications.builds.upload', 'applications.commands', 'applications.commands.update',
  'applications.commands.permissions.update', 'applications.entitlements', 'applications.store.update', 'bot', 'connections', 'dm_channels.read', 'email', 'gdm.join', 'guilds',
  'guilds.join', 'guilds.members.read', 'identify', 'identify.premium', 'messages.read', 'relationships.read', 'role_connections.write', 'rpc', 'rpc.activities.write',
  'rpc.notifications.read', 'rpc.voice.read', 'rpc.voice.write', 'voice', 'webhook.incoming']);

export async function screen(ctx: HandlerContext): Promise<Response> {
  const request = ctx.call.request;
  const q = request.method === 'POST' ? new URLSearchParams(ctx.text) : new URL(request.url).searchParams;
  const app = ctx.row(APP, q.get('client_id') ?? '');
  if (!app || app.deleted === true) return page('<p>Unknown Application</p>', 400);
  const scopes = (q.get('scope') ?? '').split(/[ +]/).filter(Boolean);
  if (!scopes.length || scopes.some((s) => !SCOPES.has(s))) return page(`<p>Invalid scope: ${esc(scopes.find((s) => !SCOPES.has(s)) ?? '(none)')}</p>`, 400);
  // source: https://docs.discord.com/developers/topics/oauth2 "they will be prompted to select a channel in which to allow the webhook"
  if (scopes.includes('webhook.incoming')) return gap();
  const bot = scopes.includes('bot');
  // source: https://docs.discord.com/developers/topics/oauth2 "automatically redirect the user to the first URI in your"
  const needsCode = scopes.some((s) => s !== 'bot' && s !== 'applications.commands');
  const registered = (app.redirect_uris as string[] | undefined) ?? [];
  const redirect = q.get('redirect_uri') ?? (needsCode ? registered[0] ?? '' : '');
  if ((redirect || needsCode) && !registered.includes(redirect)) return page('<p>Invalid OAuth2 redirect_uri</p>', 400);
  // source: https://docs.discord.com/developers/topics/oauth2 "response_type is again mandatory"
  // source: https://docs.discord.com/developers/topics/oauth2 "the client is directly issued an access token"
  if (needsCode && q.get('response_type') !== 'code') return gap();
  const back = (params: Record<string, string>): Response => {
    const u = new URL(redirect);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    if (q.get('state') !== null) u.searchParams.set('state', q.get('state')!);
    return new Response(null, { status: 302, headers: { location: u.toString() } });
  };
  const hidden = PARAMS.filter((p) => q.get(p) !== null).map((p) => `<input type="hidden" name="${p}" value="${esc(q.get(p))}">`).join('');
  const login = (error = ''): Response => page(`<h1>Welcome back!</h1>${error ? `<p>${esc(error)}</p>` : ''}<form method="post">${hidden}<label>Username <input name="username"></label><label>Password <input type="password" name="password"></label><button>Log In</button></form>`, error ? 400 : 200);
  if (request.method !== 'POST') return login();
  const username = String(q.get('username') ?? '').toLowerCase();
  const person = ctx.rowsRaw(USER).find((u) => u.deleted !== true && u.bot !== true && u.username === username);
  if (!person || person._password !== sha256(ctx, `${String(person.id)}:${String(q.get('password') ?? '')}`)) return login('Login or password is invalid.');
  // source: https://www.rfc-editor.org/rfc/rfc6749 "The resource owner or authorization server denied the request"
  if (q.get('decision') === 'cancel') return redirect ? back({ error: 'access_denied', error_description: 'The resource owner or authorization server denied the request' }) : page('<p>Cancelled</p>');
  // the servers the person may add a bot to: those they own or manage
  const manageable = ctx.rowsRaw(MEMBER).filter((m) => m.deleted !== true && m._user === person.id).map((m) => ctx.row(GUILD, String(m._guild))).filter((g): g is Row => Boolean(g && g.deleted !== true))
    .filter((g) => (basePermissions(ctx, g, String(person.id)) & P.MANAGE_GUILD) !== 0n || g.owner_id === person.id);
  // source: https://docs.discord.com/developers/topics/oauth2 "For passthrough scopes, like bot and webhook.incoming, authorization is always required."
  if (q.get('decision') !== 'authorize') {
    const select = bot ? `<label>Add to server <select name="guild_id">${manageable.map((g) => `<option value="${esc(g.id)}"${g.id === q.get('guild_id') ? ' selected' : ''}>${esc(g.name)}</option>`).join('')}</select></label>` : '';
    const creds = `<input type="hidden" name="username" value="${esc(username)}"><input type="hidden" name="password" value="${esc(q.get('password'))}">`;
    return page(`<h1>${esc(app.name)}</h1><p>An external application would like to access your Discord account</p><ul>${scopes.map((s) => `<li>${esc(s)}</li>`).join('')}</ul><form method="post">${hidden.replace(/<input type="hidden" name="guild_id"[^>]*>/, '')}${creds}${select}<button name="decision" value="cancel">Cancel</button><button name="decision" value="authorize">Authorize</button></form>`);
  }
  let guild: Row | undefined;
  if (bot) {
    guild = manageable.find((g) => g.id === q.get('guild_id'));
    if (!guild) return page('<p>Select a server you manage to add this bot to.</p>', 400);
    const permissions = (() => { try { return BigInt(q.get('permissions') ?? '0'); } catch { return -1n; } })();
    if (permissions < 0n) return page('<p>Invalid permissions</p>', 400);
    // an installer grants a bot only what they hold themselves
    // source: https://docs.discord.com/developers/topics/permissions "can only grant permissions it has"
    if ((permissions & ~basePermissions(ctx, guild, String(person.id))) !== 0n) return page('<p>You cannot grant permissions you do not have.</p>', 403);
    // the bot joins with its own managed role, holding the permissions it asked (source: topics/permissions, "Role Tags Structure")
    if (!memberOf(ctx, String(guild.id), String(app._bot))) {
      const role = await makeRole(ctx, String(guild.id), { name: app.name, permissions: permissions.toString() }, { managed: true, tags: { bot_id: app._bot } });
      await join(ctx, String(guild.id), String(app._bot), { roles: [role.id] });
    }
    if (!needsCode && !redirect) return page(`<p>Authorized: ${esc(app.name)} was added to ${esc(guild.name)}.</p>`);
  }
  const id = ctx.mint(CODE);
  const value = await tokenValue(ctx, `discord-code:${id}`);
  await ctx.record(CODE, {
    application: app.id, user: person.id, scope: scopes.join(' '), redirect_uri: q.get('redirect_uri') ?? '', sha256: sha256(ctx, value),
    expires: new Date(Date.parse(ctx.occurredAt) + CODE_TTL * 1000).toISOString(), ...(guild ? { guild: guild.id, permissions: q.get('permissions') ?? '0' } : {}),
  }, id);
  // source: https://docs.discord.com/developers/topics/oauth2 "there will be additional querystring parameters of guild_id and permissions"
  return back({ code: value, ...(guild ? { guild_id: String(guild.id), permissions: q.get('permissions') ?? '0' } : {}) });
}
