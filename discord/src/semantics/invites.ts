// Discord's invites family: an invite read by its code (GET /invites/{code}).
import type { HandlerContext } from '@volter/world-core';
import { INVITE, inviteOpen, inviteView, MEMBER, unknown } from './shared.ts';

/** GET /invites/{code}: an invite read by anyone holding its code, with no token (Twenty's website shows its community's
 *  member count this way); the public view, which names no uses, limits or creation, and with `with_counts` the guild's
 *  approximate member and online counts. Where the documentation stops: the twin keeps no presence, so its online count
 *  is 0, as the guild reads answer it (./users.ts). */
// source: https://docs.discord.com/developers/resources/invite "whether the invite should contain approximate member counts"
export async function invite_resolve(ctx: HandlerContext): Promise<Response> {
  const invite = ctx.row(INVITE, String(ctx.call.params.code));
  if (!inviteOpen(ctx, invite)) return unknown(10006, 'Invite');
  const view = inviteView(ctx, invite, false);
  if (new URL(ctx.call.request.url).searchParams.get('with_counts') !== 'true') return Response.json(view);
  const members = ctx.rowsRaw(MEMBER).filter((m) => m.deleted !== true && m._guild === invite._guild).length;
  return Response.json({ ...view, approximate_member_count: members, approximate_presence_count: 0 });
}
