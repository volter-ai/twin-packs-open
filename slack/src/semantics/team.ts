// Slack's team.* methods (https://docs.slack.dev/reference/methods?family=team): the workspace itself.
import type { HandlerContext } from '@volter/world-core';
import { arg, fail, ok, teamView, who } from './shared.ts';

/** team.info: the caller's workspace (`team`) ("team_not_found"). */
export async function team_info(ctx: HandlerContext): Promise<Response> {
  const by = who(ctx);
  const selected = arg(ctx, 'team') ?? by.team;
  if (selected !== by.team) return fail(ctx, 'team_not_found');
  const t = ctx.get('team', selected);
  if (!t) return fail(ctx, 'team_not_found');
  return ok(ctx, { team: teamView(t) });
}
