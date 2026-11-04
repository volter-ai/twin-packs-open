// Guilds (servers) and what a bot builds and reads in one: channels, roles and members, under the permissions its roles
// give it. A server is made in the client (the guilds door, `makeGuild`).
import type { HandlerContext } from '@volter/world-core';
import {
  arr, authorized, basePermissions, botOnly, CHANNEL, channelPermissions, fail, guildFor, has, invalidForm, INVITE, inviteOpen, inviteView, lengthBetween, makeChannel,
  makeRole, MEMBER, memberId, memberView, obj, P, ROLE, roleView, tooLong, TYPE, USER, WEBHOOK, webhookView,
} from './shared.ts';

// source: https://docs.discord.com/developers/resources/guild "Returns a list of guild channel objects. Does not include threads."
export async function list_guild_channels(ctx: HandlerContext): Promise<Response> {
  const c = authorized(ctx);
  if (c instanceof Response) return c;
  const guild = guildFor(ctx, String(ctx.call.params.guild_id), String(c.user.id));
  if (guild instanceof Response) return guild;
  const all = ctx.rowsRaw(CHANNEL).filter((ch) => ch.deleted !== true && ch.guild_id === guild.id && ![10, 11, 12].includes(Number(ctx.own(ch).type)));
  // source: https://docs.discord.com/developers/resources/guild "this endpoint will omit any channel your bot"
  const omitting = Date.parse(ctx.occurredAt) >= Date.parse('2026-11-16T00:00:00Z');
  const views = omitting ? all.filter((ch) => Number(ctx.own(ch).type) === TYPE.GUILD_CATEGORY
    ? all.some((x) => x.parent_id === ch.id && has(channelPermissions(ctx, guild, x, String(c.user.id)), P.VIEW_CHANNEL))
    : has(channelPermissions(ctx, guild, ch, String(c.user.id)), P.VIEW_CHANNEL)) : all;
  return Response.json(views.map((ch) => ctx.get(CHANNEL, String(ch.id))));
}

// source: https://docs.discord.com/developers/resources/guild "Requires the MANAGE_CHANNELS permission."
export async function create_guild_channel(ctx: HandlerContext): Promise<Response> {
  const c = authorized(ctx);
  if (c instanceof Response) return c;
  const guild = guildFor(ctx, String(ctx.call.params.guild_id), String(c.user.id));
  if (guild instanceof Response) return guild;
  const base = basePermissions(ctx, guild, String(c.user.id));
  if (!has(base, P.MANAGE_CHANNELS)) return fail(403, 50013, 'Missing Permissions');
  const b = obj(ctx.body);
  const name = typeof b.name === 'string' ? b.name : '';
  // source: https://docs.discord.com/developers/resources/guild "channel name (1-100 characters)"
  if (name.length < 1 || name.length > 100) return invalidForm({ name: lengthBetween(1, 100) });
  if (typeof b.topic === 'string' && b.topic.length > 1024) return invalidForm({ topic: tooLong(1024) });
  // source: https://docs.discord.com/developers/resources/guild "only permissions your bot has in the guild can be allowed/denied"
  for (const o of arr(b.permission_overwrites)) if (((BigInt(String(o.allow ?? '0')) | BigInt(String(o.deny ?? '0'))) & ~base) !== 0n) return fail(403, 50013, 'Missing Permissions');
  if (b.parent_id && ctx.row(CHANNEL, String(b.parent_id))?.guild_id !== guild.id) return invalidForm({ parent_id: { code: 'CHANNEL_PARENT_INVALID', message: 'Category does not exist.' } });
  // a text channel's name as Discord keeps it: lower case, spaces as dashes
  const type = Number(b.type ?? TYPE.GUILD_TEXT);
  const id = await makeChannel(ctx, String(guild.id), { ...b, type, name: type === TYPE.GUILD_TEXT || type === TYPE.GUILD_ANNOUNCEMENT ? name.toLowerCase().replace(/\s+/g, '-') : name });
  return Response.json(ctx.get(CHANNEL, id), { status: 201 });
}

// source: https://docs.discord.com/developers/resources/guild "Returns a list of role objects for the guild."
export async function list_guild_roles(ctx: HandlerContext): Promise<Response> {
  const c = authorized(ctx);
  if (c instanceof Response) return c;
  const guild = guildFor(ctx, String(ctx.call.params.guild_id), String(c.user.id));
  if (guild instanceof Response) return guild;
  return Response.json(ctx.rowsRaw(ROLE).filter((r) => r.deleted !== true && r._guild === guild.id).sort((a, z) => Number(a.position) - Number(z.position)).map((r) => roleView(ctx, r)));
}

// source: https://docs.discord.com/developers/resources/guild "Create a new role for the guild. Requires the MANAGE_ROLES permission."
export async function create_guild_role(ctx: HandlerContext): Promise<Response> {
  const c = authorized(ctx);
  if (c instanceof Response) return c;
  const guild = guildFor(ctx, String(ctx.call.params.guild_id), String(c.user.id));
  if (guild instanceof Response) return guild;
  const base = basePermissions(ctx, guild, String(c.user.id));
  if (!has(base, P.MANAGE_ROLES)) return fail(403, 50013, 'Missing Permissions');
  const b = obj(ctx.body);
  // source: https://docs.discord.com/developers/resources/guild "name of the role, max 100 characters"
  if (typeof b.name === 'string' && b.name.length > 100) return invalidForm({ name: tooLong(100) });
  // source: https://docs.discord.com/developers/topics/permissions "it can only grant permissions it has to those roles"
  if (b.permissions !== undefined && (BigInt(String(b.permissions)) & ~base) !== 0n) return fail(403, 50013, 'Missing Permissions');
  return Response.json(roleView(ctx, await makeRole(ctx, String(guild.id), b)));
}

// source: https://docs.discord.com/developers/resources/guild "whose username or nickname starts with a provided string"
export async function search_guild_members(ctx: HandlerContext): Promise<Response> {
  const c = authorized(ctx);
  if (c instanceof Response) return c;
  const guild = guildFor(ctx, String(ctx.call.params.guild_id), String(c.user.id));
  if (guild instanceof Response) return guild;
  const q = new URL(ctx.call.request.url).searchParams;
  const query = q.get('query');
  if (query === null) return invalidForm({ query: { code: 'BASE_TYPE_REQUIRED', message: 'This field is required' } });
  const limit = q.get('limit') === null ? 1 : Number(q.get('limit'));
  // source: https://docs.discord.com/developers/resources/guild "max number of members to return (1-1000)"
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) return invalidForm({ limit: { code: 'NUMBER_TYPE_MAX', message: 'int value should be less than or equal to 1000.' } });
  const needle = query.toLowerCase();
  const hits = ctx.rowsRaw(MEMBER).filter((m) => m.deleted !== true && m._guild === guild.id).filter((m) => {
    const u = ctx.row(USER, String(m._user));
    return [u?.username, u?.global_name, m.nick].some((n) => typeof n === 'string' && n.toLowerCase().startsWith(needle));
  });
  return Response.json(hits.slice(0, limit).map((m) => memberView(ctx, m)));
}

// source: https://docs.discord.com/developers/resources/guild "Modifies the current member in a guild."
export async function update_my_guild_member(ctx: HandlerContext): Promise<Response> {
  const c = botOnly(ctx);
  if (c instanceof Response) return c;
  const guild = guildFor(ctx, String(ctx.call.params.guild_id), String(c.user.id));
  if (guild instanceof Response) return guild;
  const b = obj(ctx.body);
  if (b.nick !== undefined) {
    if (!has(basePermissions(ctx, guild, String(c.user.id)), P.CHANGE_NICKNAME)) return fail(403, 50013, 'Missing Permissions');
    // source: https://docs.discord.com/developers/resources/user "Nicknames must be between 1 and 32 characters long"
    if (typeof b.nick === 'string' && (b.nick.length < 1 || b.nick.length > 32)) return invalidForm({ nick: lengthBetween(1, 32) });
  }
  const id = memberId(String(guild.id), String(c.user.id));
  await ctx.write(MEMBER, id, { ...(b.nick !== undefined ? { nick: b.nick || null } : {}) }, 'member.update');
  return Response.json(memberView(ctx, ctx.row(MEMBER, id)!));
}

// source: https://docs.discord.com/developers/resources/webhook "Returns a list of guild webhook objects. Requires the MANAGE_WEBHOOKS permission."
export async function get_guild_webhooks(ctx: HandlerContext): Promise<Response> {
  const c = authorized(ctx);
  if (c instanceof Response) return c;
  const guild = guildFor(ctx, String(ctx.call.params.guild_id), String(c.user.id));
  if (guild instanceof Response) return guild;
  if (!has(basePermissions(ctx, guild, String(c.user.id)), P.MANAGE_WEBHOOKS)) return fail(403, 50013, 'Missing Permissions');
  const hooks = ctx.rowsRaw(WEBHOOK).filter((h) => h.deleted !== true && h.guild_id === guild.id);
  return Response.json(await Promise.all(hooks.map((h) => webhookView(ctx, h))));
}

// source: https://docs.discord.com/developers/resources/guild "Requires the MANAGE_GUILD or VIEW_AUDIT_LOG permission."
export async function list_guild_invites(ctx: HandlerContext): Promise<Response> {
  const c = authorized(ctx);
  if (c instanceof Response) return c;
  const guild = guildFor(ctx, String(ctx.call.params.guild_id), String(c.user.id));
  if (guild instanceof Response) return guild;
  const base = basePermissions(ctx, guild, String(c.user.id));
  if (!has(base, P.MANAGE_GUILD) && !has(base, P.VIEW_AUDIT_LOG)) return fail(403, 50013, 'Missing Permissions');
  // source: https://docs.discord.com/developers/resources/guild "Invite Metadata is included with the MANAGE_GUILD permission."
  const metadata = has(base, P.MANAGE_GUILD);
  // an invite spent or expired is gone, as Discord deletes it
  return Response.json(ctx.rowsRaw(INVITE).filter((i) => i._guild === guild.id && inviteOpen(ctx, i)).map((i) => inviteView(ctx, i, metadata)));
}
