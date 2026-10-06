// Slack's users.* methods (https://docs.slack.dev/reference/methods?family=users): the people of a workspace, their
// profiles and presence.
import type { HandlerContext } from '@volter/world-core';
import { page } from '../engine/wire.ts';
import { arg, channelMembers, channelView, fail, jsonArg, now, ok, sees, teamsOf, userView, who, type Caller } from './shared.ts';

type Row = Record<string, unknown>;

const flag = (v: unknown): boolean => v === true || v === 'true' || v === '1';
/** Whether the caller is a person who administers their workspace: to them a person shows `has_2fa`. */
const adminViewer = (ctx: HandlerContext, by: Caller): boolean => (by.kind === 'person' || by.kind === 'user') && !by.bot && ['is_admin', 'is_owner', 'is_primary_owner'].some((k) => ctx.row('user', by.user)?.[k] === true);

/** users.info: a person the caller's workspace (or org) has ("user_not_found"). */
export async function users_info(ctx: HandlerContext): Promise<Response> {
  const by = who(ctx);
  const id = arg(ctx, 'user');
  const u = id ? ctx.row('user', id, { withDeleted: true }) : undefined;
  if (!u || (!by.enterprise && !teamsOf(ctx, String(u.id)).includes(by.team))) return fail(ctx, 'user_not_found');
  // source: https://docs.slack.dev/reference/methods/users.info "include_locale"
  return ok(ctx, { user: { ...userView(ctx, u, by.team, adminViewer(ctx, by)), ...(flag(arg(ctx, 'include_locale')) ? { locale: 'en-US' } : {}) } });
}

/** users.list: the workspace's people, deactivated ones included ("Lists all users in a Slack team"), a page at a
 *  time in the order of their ids; an org token names the workspace with `team_id`. */
export async function users_list(ctx: HandlerContext): Promise<Response> {
  const by = who(ctx);
  const team = arg(ctx, 'team_id') ?? by.team;
  const people = ctx.rowsRaw('user', { withDeleted: true }).filter((u) => teamsOf(ctx, String(u.id)).includes(team)).sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const p = page(people, ctx.params, 200);
  if (!p) return fail(ctx, 'invalid_cursor');
  return ok(ctx, { members: p.items.map((u) => userView(ctx, u, team, adminViewer(ctx, by))), cache_ts: now(ctx), response_metadata: { next_cursor: p.next } });
}

/** users.profile.get: the caller's profile, or another's (`user`). */
export async function users_profile_get(ctx: HandlerContext): Promise<Response> {
  const by = who(ctx);
  const u = ctx.get('user', arg(ctx, 'user') ?? by.user);
  if (!u) return fail(ctx, 'user_not_found');
  return ok(ctx, { profile: (userView(ctx, u, by.team).profile as Row) });
}

/** The profile fields a caller sets: "profile: Collection of key:value pairs presented as a URL-encoded JSON hash", or
 *  one field as `name` and `value`. */
const SETTABLE = new Set(['display_name', 'email', 'first_name', 'last_name', 'phone', 'pronouns', 'real_name', 'start_date', 'title', 'status_emoji', 'status_expiration', 'status_text']);

/** users.profile.set: the caller's own profile, or another's by an admin (`user`: "ID of user to change. This argument
 *  may only be specified by admins on paid teams"). A field Slack does not know is `invalid_profile`. Answers the whole
 *  profile. */
export async function users_profile_set(ctx: HandlerContext): Promise<Response> {
  const by = who(ctx);
  const target = arg(ctx, 'user') ?? by.user;
  if (target !== by.user && ctx.get('user', by.user)?.is_admin !== true) return fail(ctx, 'cannot_update_admin_user');
  const u = ctx.get('user', target);
  if (!u) return fail(ctx, 'user_not_found');
  const given = arg(ctx, 'name') !== undefined ? { [String(arg(ctx, 'name'))]: ctx.params.value ?? '' } : jsonArg(ctx, 'profile');
  if (!given || typeof given !== 'object' || Array.isArray(given)) return fail(ctx, 'invalid_profile');
  const fields = given as Row;
  if (Object.keys(fields).some((k) => !SETTABLE.has(k))) return fail(ctx, 'invalid_profile');
  if (fields.status_expiration !== undefined) fields.status_expiration = Number(fields.status_expiration) || 0;
  const profile = { ...((u.profile as Row | undefined) ?? {}), ...fields };
  await ctx.write('user', target, { profile, updated: now(ctx) }, 'user.profile');
  return ok(ctx, { username: u.name, profile: userView(ctx, { ...u, profile }, by.team).profile });
}

/** users.conversations: the conversations a person is a member of, of the types asked (public channels when none). */
export async function users_conversations(ctx: HandlerContext): Promise<Response> {
  const by = who(ctx);
  const user = arg(ctx, 'user') ?? by.user;
  const types = new Set(String(arg(ctx, 'types') ?? 'public_channel').split(','));
  const typeOf = (c: Row): string => (c.is_im === true ? 'im' : c.is_mpim === true ? 'mpim' : c.is_private === true ? 'private_channel' : 'public_channel');
  const mine = ctx.rowsRaw('channel').filter((c) => types.has(typeOf(c)) && channelMembers(ctx, String(c.id)).includes(user) && sees(ctx, c, by) && !(ctx.params.exclude_archived === 'true' && c.is_archived === true));
  const p = page(mine, ctx.params, 100);
  if (!p) return fail(ctx, 'invalid_cursor');
  return ok(ctx, { channels: p.items.map((c) => channelView(ctx, c, by)), response_metadata: { next_cursor: p.next } });
}

/** users.getPresence: `active` or `away` (the caller's own set presence; another person is active when not set away).
 *  To the person themself it adds their connection (a person the World has is connected, set away or not) and when
 *  they were last active: their latest message, else when they joined. */
// source: spec:/paths/~1users.getPresence/get/responses/200/schema/properties "last_activity"
export async function users_getPresence(ctx: HandlerContext): Promise<Response> {
  const by = who(ctx);
  const u = ctx.row('user', arg(ctx, 'user') ?? by.user);
  if (!u) return fail(ctx, 'user_not_found');
  const presence = u._presence === 'away' ? 'away' : 'active';
  if (u.id !== by.user) return ok(ctx, { presence });
  const said = ctx.rowsRaw('message').filter((m) => m.user === u.id).map((m) => Math.floor(Number(m.ts)));
  const joined = ctx.rowsRaw('team_member').filter((m) => m._user === u.id).map((m) => Number(m.date_joined));
  return ok(ctx, { presence, online: true, auto_away: false, manual_away: presence === 'away', connection_count: 1, last_activity: Math.max(0, ...said, ...joined) });
}

/** users.setPresence: `auto` or `away` ("invalid_presence"). */
export async function users_setPresence(ctx: HandlerContext): Promise<Response> {
  const by = who(ctx);
  const presence = arg(ctx, 'presence');
  if (presence !== 'auto' && presence !== 'away') return fail(ctx, 'invalid_presence');
  await ctx.write('user', by.user, { _presence: presence }, 'user.presence');
  return ok(ctx);
}
