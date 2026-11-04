// Templates: a team's templates as the API lists them (the e2b CLI builds them; in a World, the templates door).
import type { HandlerContext } from '@volter/world-core';
import { e2bError, paged, teamOf, teamRows, TEMPLATE } from './shared.ts';

// source: spec:get_v2_templates "List all templates"
export async function get_v2_templates(ctx: HandlerContext): Promise<Response> {
  const team = teamOf(ctx);
  // Where the documentation stops: the message is the twin's, in E2B's error body
  if (!team) return e2bError(401, 'Invalid API key');
  return paged(ctx, teamRows(ctx, TEMPLATE, team), 'templateID');
}
