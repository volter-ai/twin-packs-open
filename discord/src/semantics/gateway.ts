// Where the Gateway is: `GET /gateway/bot` answers the twin's own socket (the manifest's `sockets`, spoken by
// ./sockets.ts) and the bot's session start limit, counted from the identifies it made in the last day.
import type { HandlerContext } from '@volter/world-core';
import { botOnly, gatewayUrl, IDENTIFY } from './shared.ts';

// source: https://docs.discord.com/developers/events/gateway "Clients are limited to 1000"
const IDENTIFY_LIMIT = 1000;
const DAY = 24 * 60 * 60 * 1000;


/** The identifies an application made in the day before now, oldest first. */
const identifiesToday = (ctx: Pick<HandlerContext, 'rowsRaw' | 'occurredAt'>, application: string): string[] =>
  ctx.rowsRaw(IDENTIFY).filter((r) => r.application === application && Date.parse(ctx.occurredAt) - Date.parse(String(r.at)) < DAY).map((r) => String(r.at)).sort();

// source: https://docs.discord.com/developers/events/gateway "This endpoint requires authentication using a valid bot token."
export async function get_bot_gateway(ctx: HandlerContext): Promise<Response> {
  const c = botOnly(ctx);
  if (c instanceof Response) return c;
  const today = identifiesToday(ctx, String(c.app.id));
  const resetAfter = today.length ? Math.max(0, Date.parse(today[0]!) + DAY - Date.parse(ctx.occurredAt)) : DAY;
  return Response.json({ url: gatewayUrl(ctx), shards: 1, session_start_limit: { total: IDENTIFY_LIMIT, remaining: Math.max(0, IDENTIFY_LIMIT - today.length), reset_after: resetAfter, max_concurrency: 1 } });
}
