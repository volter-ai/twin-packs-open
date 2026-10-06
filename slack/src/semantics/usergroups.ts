// Slack's usergroups.* methods (https://docs.slack.dev/reference/methods?family=usergroups): a workspace's user
// groups, their members and default channels.
import type { HandlerContext } from '@volter/world-core';
import { listArg } from '../engine/wire.ts';
import { arg, fail, groupMembers, groupsIn, groupView, now, ok, setGroupSet, who } from './shared.ts';

type Row = Record<string, unknown>;

// source: https://docs.slack.dev/reference/methods/usergroups.disable/ "This field will be ignored if the API call is sent using a workspace-level token"
const teamOf = (ctx: HandlerContext): string => who(ctx).team;

/** usergroups.list: the workspace's user groups, disabled ones only with `include_disabled`, members with
 *  `include_users`. */
export async function usergroups_list(ctx: HandlerContext): Promise<Response> {
  const team = teamOf(ctx);
  const withUsers = ctx.params.include_users === true || ctx.params.include_users === 'true';
  const disabled = ctx.params.include_disabled === true || ctx.params.include_disabled === 'true';
  const groups = groupsIn(ctx, team).filter((g) => disabled || !g.date_delete);
  return ok(ctx, { usergroups: groups.map((g) => groupView(ctx, g, team, withUsers)) });
}

/** A handle as Slack makes one from a name when none is given: lowercase, spaces as hyphens. */
const handleOf = (name: string): string => name.trim().toLowerCase().replace(/\s+/g, '-');

/** usergroups.create: a name and handle no other group of the workspace has ("name_already_exists",
 *  "handle_already_exists"), with its default channels. */
export async function usergroups_create(ctx: HandlerContext): Promise<Response> {
  const by = who(ctx);
  const team = teamOf(ctx);
  const name = arg(ctx, 'name');
  if (!name) return fail(ctx, 'invalid_arguments');
  const handle = arg(ctx, 'handle') ?? handleOf(name);
  const groups = groupsIn(ctx, team);
  if (groups.some((g) => g.name === name)) return fail(ctx, 'name_already_exists');
  if (groups.some((g) => g.handle === handle)) return fail(ctx, 'handle_already_exists');
  const id = ctx.mint('usergroup');
  const g = await ctx.write('usergroup', id, {
    team_id: team, name, handle, description: arg(ctx, 'description') ?? '', date_create: now(ctx), created_by: by.user,
  }, 'usergroup.create');
  await setGroupSet(ctx, 'usergroup_channel', id, listArg(ctx.params.channels), 'usergroup.channels');
  return ok(ctx, { usergroup: groupView(ctx, g, team, true) });
}

/** The group a call names by `usergroup` in its workspace ("no_such_subteam"). */
function groupNamed(ctx: HandlerContext, team: string): Row | undefined {
  const id = arg(ctx, 'usergroup');
  return id ? groupsIn(ctx, team).find((g) => g.id === id) : undefined;
}

/** usergroups.update: a group's name, handle, description and default channels (`channels`, "A comma separated string
 *  of encoded channel IDs for which the User Group uses as a default"). */
export async function usergroups_update(ctx: HandlerContext): Promise<Response> {
  const by = who(ctx);
  const team = teamOf(ctx);
  const g = groupNamed(ctx, team);
  if (!g) return fail(ctx, 'no_such_subteam');
  const fields: Row = { date_update: now(ctx), updated_by: by.user };
  if (arg(ctx, 'name') !== undefined) fields.name = arg(ctx, 'name');
  if (arg(ctx, 'handle') !== undefined) fields.handle = arg(ctx, 'handle');
  if (arg(ctx, 'description') !== undefined) fields.description = arg(ctx, 'description');
  await ctx.write('usergroup', String(g.id), fields, 'usergroup.update');
  if (ctx.params.channels !== undefined) await setGroupSet(ctx, 'usergroup_channel', String(g.id), listArg(ctx.params.channels), 'usergroup.channels');
  return ok(ctx, { usergroup: groupView(ctx, ctx.row('usergroup', String(g.id))!, team, true) });
}

/** usergroups.users.list: a group's members. */
export async function usergroups_users_list(ctx: HandlerContext): Promise<Response> {
  const g = groupNamed(ctx, teamOf(ctx));
  if (!g) return fail(ctx, 'no_such_subteam');
  return ok(ctx, { users: groupMembers(ctx, String(g.id)) });
}

/** usergroups.users.update: a group's whole membership, replaced ("A comma separated string of encoded user IDs that
 *  represent the entire list of users for the User Group"). An IdP group's members are its identity provider's
 *  ("permission_denied"). */
export async function usergroups_users_update(ctx: HandlerContext): Promise<Response> {
  const by = who(ctx);
  const team = teamOf(ctx);
  const g = groupNamed(ctx, team);
  if (!g) return fail(ctx, 'no_such_subteam');
  if (g.is_external === true) return fail(ctx, 'permission_denied');
  const users = listArg(ctx.params.users);
  for (const u of users) if (!ctx.get('user', u)) return fail(ctx, 'invalid_users');
  await setGroupSet(ctx, 'usergroup_member', String(g.id), users, 'usergroup.users');
  await ctx.write('usergroup', String(g.id), { date_update: now(ctx), updated_by: by.user }, 'usergroup.update');
  return ok(ctx, { usergroup: groupView(ctx, ctx.row('usergroup', String(g.id))!, team, true) });
}

/** usergroups.disable and .enable: a group set aside (`date_delete`) and brought back. */
async function toggle(ctx: HandlerContext, on: boolean): Promise<Response> {
  const by = who(ctx);
  const team = teamOf(ctx);
  const g = groupNamed(ctx, team);
  if (!g) return fail(ctx, 'no_such_subteam');
  if (on === !g.date_delete) return fail(ctx, on ? 'already_enabled' : 'already_disabled');
  await ctx.write('usergroup', String(g.id), { date_delete: on ? 0 : now(ctx), deleted_by: on ? null : by.user, date_update: now(ctx), updated_by: by.user }, on ? 'usergroup.enable' : 'usergroup.disable');
  return ok(ctx, { usergroup: groupView(ctx, ctx.row('usergroup', String(g.id))!, team, true) });
}

export async function usergroups_disable(ctx: HandlerContext): Promise<Response> {
  return toggle(ctx, false);
}

export async function usergroups_enable(ctx: HandlerContext): Promise<Response> {
  return toggle(ctx, true);
}
