// The README's Users: a user by their username (api/spec/api-readme.md, "Users").
import type { HandlerContext } from '@volter/world-core';
import { answer, userOf } from './shared.ts';

/** GET /v0/user/{id}.json — a user with public activity; nothing for one without. */
export async function getUser(ctx: HandlerContext): Promise<Response> {
  const user = userOf(ctx, String(ctx.call.params.id));
  // source: https://raw.githubusercontent.com/HackerNews/API/8a0528f538bca407c2ceeeefc9bee48bdb99c1c8/README.md "Only users that have public activity (comments or story submissions) on the site are available through the API."
  const active = user && Array.isArray(user.submitted) && user.submitted.length > 0;
  return answer(ctx, active ? user : null);
}
