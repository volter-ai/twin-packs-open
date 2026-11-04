// The teams a token reaches: a team-scoped token's own team.
import type { HandlerContext } from '@volter/world-core';
import { pageOf, scopeOf, view } from './shared.ts';

/** `GET /v2/teams`: the teams the caller is a member of; a token scoped to a team reaches that team alone. */
// source: spec:getTeams "Get a paginated list of all the Teams the authenticated User is a member of."
export async function getTeams(ctx: HandlerContext): Promise<Response> {
  const s = scopeOf(ctx);
  if (s instanceof Response) return s;
  const { items, pagination } = pageOf(ctx, [s.team]);
  return Response.json({ teams: items.map((t) => view(ctx, t, true)), pagination });
}
