// Users: the current user (a bot by its token, or a person under their OAuth2 grant) and the servers it is in.
import type { HandlerContext } from '@volter/world-core';
import { authorized, basePermissions, GUILD, MEMBER, queryTrue, type Row, userView } from './shared.ts';

// source: https://docs.discord.com/developers/resources/user "Returns the user object of the requester"
export async function get_my_user(ctx: HandlerContext): Promise<Response> {
  const c = authorized(ctx, 'identify');
  if (c instanceof Response) return c;
  // source: https://docs.discord.com/developers/resources/user "which will return the object without an email"
  return Response.json(userView(c.user, { email: c.kind === 'bot' || c.scopes.includes('email') }));
}

// source: https://docs.discord.com/developers/resources/user "Returns a list of partial guild objects the current user is a member of."
export async function list_my_guilds(ctx: HandlerContext): Promise<Response> {
  const c = authorized(ctx, 'guilds');
  if (c instanceof Response) return c;
  const q = new URL(ctx.call.request.url).searchParams;
  const counts = queryTrue(ctx, 'with_counts');
  const mine = ctx.rowsRaw(MEMBER).filter((m) => m.deleted !== true && m._user === c.user.id).map((m) => ctx.row(GUILD, String(m._guild))).filter((g): g is Row => Boolean(g && g.deleted !== true))
    .sort((a, z) => (BigInt(String(a.id)) < BigInt(String(z.id)) ? -1 : 1));
  return Response.json(mine.map((g) => ({
    id: g.id, name: g.name, icon: g.icon, banner: g.banner, owner: g.owner_id === c.user.id, permissions: basePermissions(ctx, g, String(c.user.id)).toString(), features: g.features,
    ...(counts ? { approximate_member_count: ctx.rowsRaw(MEMBER).filter((m) => m.deleted !== true && m._guild === g.id).length, approximate_presence_count: 0 } : {}),
  })));
}
