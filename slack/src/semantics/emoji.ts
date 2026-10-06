// Slack's emoji.list (https://docs.slack.dev/reference/methods/emoji.list): the org's custom emoji, by name.
import type { HandlerContext } from '@volter/world-core';
import { ok } from './shared.ts';

/** emoji.list: "Lists custom emoji for a team", each name to its image URL. */
export async function emoji_list(ctx: HandlerContext): Promise<Response> {
  return ok(ctx, { emoji: Object.fromEntries(ctx.rowsRaw('emoji').map((e) => [String(e.name), e.url])), cache_ts: '0.000000' });
}
