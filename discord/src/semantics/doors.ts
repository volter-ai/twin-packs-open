// The World's doors (architecture, "Doors, screens and the gap"): what Discord's own pages and client do that its API
// does not. The Developer Portal makes an application (its client secret, its bot and token, its public key, the
// privileged intents it turned on); people register, make servers, accept invites, post and react. Each writes through
// the one write path, so the Gateway hears of it.
import type { HandlerContext } from '@volter/world-core';
import { APP, arr, BOT_TOKEN, commandsOf, INTERACTION, interactionToken, interactionView, channelFor, inviteOpen, join, makeGuild, memberOf, MESSAGE, newMessage, obj, P, addReaction, type Row, SECRET, sha256, tokenValue, USER, verifyKey } from './shared.ts';

const json = (body: unknown, status = 200): Response => Response.json(body, { status });
const bad = (message: string, status = 400): Response => json({ message }, status);
const person = (ctx: HandlerContext, username: unknown): Row | undefined =>
  ctx.rowsRaw(USER).find((u) => u.deleted !== true && u.bot !== true && String(u.username) === String(username ?? '').toLowerCase());

/** A bot's token: its user's id in base64, then a timestamp part and an HMAC part, as the portal's "Reset Token" gives
 *  one, drawn from the World's secret. */
async function botToken(ctx: HandlerContext, bot: string, label: string): Promise<string> {
  const part = (await ctx.secret(label)).replace(/[^A-Za-z0-9_-]/g, '');
  return `${Buffer.from(bot).toString('base64').replace(/=+$/, '')}.${part.slice(0, 6)}.${part.slice(6, 44)}`;
}

async function makeApplication(ctx: HandlerContext, name: string, owner: Row | undefined, b: Row): Promise<Row> {
  const bot = await ctx.create(USER, { username: name.toLowerCase().replace(/[^a-z0-9_.]/g, '').slice(0, 32) || 'bot', global_name: null, avatar: null, bot: true }, 'user.create');
  const app = await ctx.create(APP, {
    name, icon: null, description: '', type: null, bot_public: b.bot_public !== false, bot_require_code_grant: false,
    approximate_user_authorization_count: 0, approximate_user_install_count: 0, explicit_content_filter: 0,
    eligible_oauth2_scopes: [], flags: 0, flags_new: '0', owner: null, team: null,
    redirect_uris: arr<string>(b.redirect_uris), interactions_endpoint_url: null, role_connections_verification_url: null,
    tags: [], install_params: null, integration_types_config: { 0: { oauth2_install_params: null } },
    _bot: bot.id, _privileged_intents: arr<string>(b.privileged_intents), ...(owner ? { _owner: owner.id } : {}),
  }, 'application.create');
  await ctx.write(APP, String(app.id), { verify_key: await verifyKey(ctx, String(app.id)) }, 'application.update');
  return ctx.row(APP, String(app.id))!;
}

async function issueCredential(ctx: HandlerContext, resource: string, app: Row): Promise<string> {
  const id = await ctx.issue(resource);
  const label = `discord-${resource === SECRET ? 'client-secret' : 'bot-token'}:${id}`;
  const value = resource === SECRET ? await tokenValue(ctx, label) : await botToken(ctx, String(app._bot), label);
  await ctx.record(resource, { application: app.id, label, sha256: sha256(ctx, value) }, id);
  return id;
}

async function readCredential(ctx: HandlerContext, resource: string, row: Row, app: Row): Promise<string | undefined> {
  if (row.application !== app.id || row.revoked === true || typeof row.label !== 'string') return undefined;
  if (resource === BOT_TOKEN && !ctx.row(USER, String(app._bot))) return undefined;
  const value = resource === SECRET ? await tokenValue(ctx, row.label) : await botToken(ctx, String(app._bot), row.label);
  return sha256(ctx, value) === row.sha256 ? value : undefined;
}

/** An application and bot made in the developer portal. Guilds stay shared through membership. */
export async function appCredentials(ctx: HandlerContext): Promise<Response> {
  const b = obj(ctx.body);
  const uris = arr<string>(b.redirect_uris);
  if (uris.some((u) => !/^https?:\/\/[^\s]+$/.test(String(u)))) return bad('redirect_uris must be http(s) URLs');
  const intents = arr<string>(b.privileged_intents);
  if (intents.some((i) => !['guild_members', 'presences', 'message_content'].includes(i))) return bad('privileged_intents are guild_members, presences and message_content');
  try {
    let app: Row;
    if (b.account !== undefined || b.deployment !== undefined) {
      const owner = await ctx.tenant(USER, async (organization) => {
        const email = organization.members[0]!.toLowerCase();
        const held = ctx.rowsRaw(USER).find((u) => u.bot !== true && String(u.email ?? '').toLowerCase() === email);
        if (held) return String(held.id);
        const rule = { max: 32, lower: true, allowed: /[a-z0-9_.]/, separator: '_', first: /[a-z0-9_]/ };
        const label = organization.id.length < 2 ? `user_${organization.id}` : organization.id;
        const create = async (suffixed: boolean) => {
          const username = ctx.vendorName(label, rule, { suffixed, identity: organization.id });
          const existing = person(ctx, username);
          if (existing) return String(existing.email ?? '').toLowerCase() === email ? existing : undefined;
          const made = await ctx.createUnique(USER, { username, _username: username, email, global_name: null, avatar: null }, 'user.create');
          return made.created || String(made.row.email ?? '').toLowerCase() === email ? made.row : undefined;
        };
        let made = await create(false);
        if (!made) made = await create(true);
        if (!made) throw bad(`Username is unavailable. Try adding numbers, letters, underscores _, or periods. (${organization.id})`, 409);
        return String(made.id);
      });
      app = await ctx.deploymentObject(`application:${owner.id}`, APP, async (deployment) => String((await makeApplication(ctx, deployment || 'World App', owner, b)).id));
    } else {
      const name = typeof b.name === 'string' && b.name.trim() ? b.name.trim() : 'World App';
      const owner = b.owner === undefined ? undefined : person(ctx, b.owner);
      if (b.owner !== undefined && !owner) return bad('owner must be a person of the World');
      app = ctx.rowsRaw(APP).find((a) => a.name === name) ?? await makeApplication(ctx, name, owner, b);
      if (uris.length || intents.length) {
        await ctx.write(APP, String(app.id), { ...(uris.length ? { redirect_uris: uris } : {}), ...(intents.length ? { _privileged_intents: intents } : {}) }, 'application.update');
        app = ctx.row(APP, String(app.id))!;
      }
    }
    const credential = async (resource: string, slot: string): Promise<string> => {
      if (b.account !== undefined || b.deployment !== undefined) return (await ctx.accountKey(slot, resource, { make: () => issueCredential(ctx, resource, app), read: (row) => readCredential(ctx, resource, row, app) })).secret;
      const held = ctx.rowsRaw(resource).find((row) => row.application === app.id && row.revoked !== true);
      const value = held ? await readCredential(ctx, resource, held, app) : undefined;
      if (value) return value;
      return (await readCredential(ctx, resource, ctx.row(resource, await issueCredential(ctx, resource, app))!, app))!;
    };
    const secret = await credential(SECRET, 'client-secret');
    const token = await credential(BOT_TOKEN, 'bot-token');
    return json({ application_id: app.id, client_id: app.id, client_secret: secret, bot_token: token, authorization: `Bot ${token}`, url: 'https://discord.com/api/v10',
      public_key: app.verify_key, bot_user_id: app._bot, redirect_uris: app.redirect_uris }, 201);
  } catch (error) { if (error instanceof Response) return error; throw error; }
}

/** A Discord account. Where the documentation stops: the API documents names' characters, not registration; the
 *  client's rule for a new username is 2-32 lowercase letters, digits, `_` and `.`, unique across Discord. */
export async function people(ctx: HandlerContext): Promise<Response> {
  const b = obj(ctx.body);
  const username = String(b.username ?? '').toLowerCase();
  if (!/^[a-z0-9_.]{2,32}$/.test(username)) return bad('username must be 2-32 lowercase letters, digits, _ and .');
  if (typeof b.password !== 'string' || b.password.length < 8) return bad('password must be at least 8 characters');
  if (person(ctx, username)) return bad('Username is unavailable. Try adding numbers, letters, underscores _, or periods.', 409);
  const made = await ctx.createUnique(USER, (id) => ({ id, username, _username: username, global_name: typeof b.global_name === 'string' ? b.global_name : null, avatar: null, email: typeof b.email === 'string' ? b.email : null, _password: sha256(ctx, `${id}:${b.password}`) }), 'user.create');
  if (!made.created) return bad('Username is unavailable. Try adding numbers, letters, underscores _, or periods.', 409);
  return json({ id: made.row.id, username }, 201);
}

/** A person makes a server in the client. */
export async function guilds(ctx: HandlerContext): Promise<Response> {
  const b = obj(ctx.body);
  const owner = person(ctx, b.owner);
  if (!owner) return bad('owner must be a person of the World');
  const name = String(b.name ?? '');
  // source: https://docs.discord.com/developers/resources/guild "guild name (2-100 characters, excluding trailing and leading whitespace)"
  if (name.trim().length < 2 || name.trim().length > 100) return bad('name must be 2-100 characters');
  const g = await makeGuild(ctx, owner, name.trim());
  return json({ id: g.id, name: g.name, system_channel_id: g.system_channel_id }, 201);
}

/** A person accepts an invite in the client and joins its server. */
export async function acceptInvite(ctx: HandlerContext): Promise<Response> {
  const who = person(ctx, obj(ctx.body).username);
  if (!who) return bad('username must be a person of the World');
  const invite = ctx.row('invite', String(ctx.call.params.code));
  if (!inviteOpen(ctx, invite)) return bad('Unknown Invite', 404);
  if (memberOf(ctx, String(invite._guild), String(who.id))) return json({ guild_id: invite._guild, joined: false });
  await join(ctx, String(invite._guild), String(who.id), { _invite: invite.id });
  return json({ guild_id: invite._guild, joined: true }, 201);
}

/** A person posts in a channel in the client. */
export async function post(ctx: HandlerContext): Promise<Response> {
  const b = obj(ctx.body);
  const who = person(ctx, b.username);
  if (!who) return bad('username must be a person of the World');
  const at = channelFor(ctx, String(ctx.call.params.channel), String(who.id));
  if (at instanceof Response) return at;
  if ((at.perms & P.SEND_MESSAGES) === 0n) return bad('the person cannot send messages in this channel', 403);
  const made = await newMessage(ctx, at.channel, { user: String(who.id) }, { content: b.content, ...(b.message_reference ? { message_reference: b.message_reference } : {}) });
  return made instanceof Response ? made : json({ id: made.id }, 201);
}

/** A person reacts to a message in the client. */
export async function react(ctx: HandlerContext): Promise<Response> {
  const b = obj(ctx.body);
  const who = person(ctx, b.username);
  if (!who) return bad('username must be a person of the World');
  const at = channelFor(ctx, String(ctx.call.params.channel), String(who.id));
  if (at instanceof Response) return at;
  const message = ctx.row(MESSAGE, String(ctx.call.params.message));
  if (!message || message.deleted === true || message.channel_id !== at.channel.id) return bad('Unknown Message', 404);
  if ((at.perms & P.READ_MESSAGE_HISTORY) === 0n) return bad('the person cannot read this channel\'s history', 403);
  const emoji = String(b.emoji ?? '');
  if (!/\p{Extended_Pictographic}/u.test(emoji)) return bad('emoji must be a Unicode emoji');
  const refused = await addReaction(ctx, { ...at, message }, emoji, String(who.id));
  return refused ?? json({ message_id: message.id, emoji }, 201);
}

/** The Discord client invokes an installed command or a component: no public API creates an interaction. */
// source: https://docs.discord.com/developers/interactions/receiving-and-responding "When a user interacts with your app"
export async function interact(ctx: HandlerContext): Promise<Response> {
  const b = obj(ctx.body);
  const who = person(ctx, b.username);
  if (!who) return bad('username must be a person of the World');
  const app = ctx.row(APP, String(b.application_id));
  if (!app || app.deleted === true) return bad('Unknown Application', 404);
  const at = channelFor(ctx, String(ctx.call.params.channel), String(who.id));
  if (at instanceof Response) return at;
  if (!memberOf(ctx, String(at.guild.id), String(app._bot))) return bad('Application is not installed in this server', 403);
  const type = Number(b.type ?? 2);
  if (![2, 3, 4].includes(type)) return bad('type must be a command, component or autocomplete interaction');
  let data: Row;
  let source: Row | undefined;
  if (type === 3) {
    source = ctx.row(MESSAGE, String(b.message_id));
    if (!source || source.deleted === true || source.channel_id !== at.channel.id || source._author !== app._bot) return bad('Unknown component message', 404);
    data = { custom_id: String(b.custom_id), component_type: Number(b.component_type ?? 2), ...(b.values ? { values: b.values } : {}) };
  } else {
    const command = commandsOf(ctx, String(app.id)).find((r) => r.name === b.command);
    if (!command) return bad('Unknown Application Command', 404);
    data = { id: command.id, name: command.name, type: 1, options: arr(b.options) };
  }
  const id = ctx.mint(INTERACTION);
  // source: https://docs.discord.com/developers/interactions/receiving-and-responding "Interaction Structure"
  await ctx.write(INTERACTION, id, {
    id, type, application_id: app.id, guild_id: at.guild.id, channel_id: at.channel.id, data,
    _state: 'pending', _user: who.id, _delivered_at: ctx.occurredAt, _token_sha256: sha256(ctx, await interactionToken(ctx, id)),
    ...(source ? { _source_message: source.id } : {}),
  }, 'interaction.create');
  return json(await interactionView(ctx, ctx.row(INTERACTION, id)!), 201);
}
