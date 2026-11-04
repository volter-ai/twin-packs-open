// Getting updates (https://core.telegram.org/bots/api#getting-updates): a bot reads the updates waiting for it by
// polling (getUpdates), and removes a webhook to do so (deleteWebhook). setWebhook and getWebhookInfo are not served:
// no application of the demand sets a webhook, so a bot's webhook is never set and getUpdates never meets one.
import type { HandlerContext } from '@volter/world-core';
import { answer, botOf, intParam, jsonParam, param, type Row } from './shared.ts';

// source: https://core.telegram.org/bots/api#getting-updates "Incoming updates are stored on the server until the bot receives them either way, but they will not be kept longer than 24 hours."
const KEPT_MS = 24 * 60 * 60 * 1000;

// source: https://raw.githubusercontent.com/tdlib/telegram-bot-api/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.h "static constexpr int32 LONG_POLL_MAX_TIMEOUT = 50;"
const LONG_POLL_MAX_TIMEOUT = 50;

/** The updates of a bot still kept, from `from` on, in order. */
function waiting(ctx: HandlerContext, botId: number, from: number): Row[] {
  const now = Date.parse(ctx.occurredAt);
  return ctx.rowsRaw('update')
    .filter((u) => u.deleted !== true && Number(u._bot) === botId && Number(u.update_id) >= from && now - Date.parse(String(u._made ?? ctx.occurredAt)) < KEPT_MS)
    .sort((a, b) => Number(a.update_id) - Number(b.update_id));
}

export async function getUpdates(ctx: HandlerContext): Promise<Response> {
  const { id: botId } = botOf(ctx);
  const operation = ctx.call.operation.id;
  // source: https://core.telegram.org/bots/api#getupdates "Limits the number of updates to be retrieved. Values between 1-100 are accepted. Defaults to 100."
  const limit = Math.min(100, Math.max(1, intParam(ctx, 'limit') ?? 100));
  // source: https://core.telegram.org/bots/api#getupdates "Timeout in seconds for long polling. Defaults to 0, i.e. usual short polling."
  const timeout = Math.min(LONG_POLL_MAX_TIMEOUT, Math.max(0, intParam(ctx, 'timeout') ?? 0));
  let offset = intParam(ctx, 'offset') ?? 0;
  // the update types the bot asks for, kept for the updates made from now on
  // source: https://core.telegram.org/bots/api#getupdates "If not specified, the previous setting will be used."
  // a form's field is read by its exact name, as the server reads a query's arguments: a client that encodes the list
  // as allowed_updates[0]=… (a form library's bracket notation) names no allowed_updates at all
  // source: https://raw.githubusercontent.com/tdlib/telegram-bot-api/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp "auto allowed_update_types = get_allowed_update_types(query->arg("
  const form = (ctx.call.request.headers.get('content-type') ?? '').includes('application/x-www-form-urlencoded');
  const exact = form ? new URLSearchParams(await ctx.call.request.clone().text()).get('allowed_updates') ?? new URL(ctx.call.request.url).searchParams.get('allowed_updates') ?? undefined : undefined;
  const allowed = form ? (exact === undefined ? {} : (() => { try { return { value: JSON.parse(exact) as unknown }; } catch { return { error: true }; } })()) : jsonParam(ctx, 'allowed_updates');
  if ('value' in allowed && Array.isArray(allowed.value)) await ctx.record('_bot', { allowed_updates: (allowed.value as unknown[]).map(String) }, String(botId));
  const mine = ctx.rowsRaw('update').filter((u) => u.deleted !== true && Number(u._bot) === botId).sort((a, b) => Number(a.update_id) - Number(b.update_id));
  // a negative offset keeps only the last -offset updates and forgets the rest
  // source: https://core.telegram.org/bots/api#getupdates "The negative offset can be specified to retrieve updates starting from -offset update from the end of the updates queue. All previous updates will be forgotten."
  if (offset < 0) {
    for (const u of mine.slice(0, Math.max(0, mine.length + offset))) await ctx.remove('update', String(u.id), operation);
    offset = 0;
  }
  // the updates below the offset are confirmed, and so forgotten
  // source: https://core.telegram.org/bots/api#getupdates "An update is considered confirmed as soon as getUpdates is called with an offset higher than its update_id."
  if (offset > 0) for (const u of mine) if (Number(u.update_id) < offset) await ctx.remove('update', String(u.id), operation);
  let found = waiting(ctx, botId, offset);
  // nothing waiting: the request is held until an update comes or the timeout passes (a long poll)
  // source: https://core.telegram.org/bots/api#getupdates "Should be positive, short polling should be used for testing purposes only."
  if (!found.length && timeout > 0 && (await ctx.awaitWrite(['update'], timeout * 1000))) found = waiting(ctx, botId, offset);
  return answer(found.slice(0, limit).map((u) => Object.fromEntries(Object.entries(ctx.own(u)).filter(([k]) => !k.startsWith('_') && k !== 'deleted'))));
}

export async function deleteWebhook(ctx: HandlerContext): Promise<Response> {
  const { id: botId } = botOf(ctx);
  // source: https://core.telegram.org/bots/api#deletewebhook "Pass True to drop all pending updates"
  if (ctx.flag(param(ctx, 'drop_pending_updates')) === true) {
    for (const u of ctx.rowsRaw('update')) if (u.deleted !== true && Number(u._bot) === botId) await ctx.remove('update', String(u.id), ctx.call.operation.id);
  }
  // no webhook is ever set in this pack's scope, so the server answers that it is already deleted
  // source: https://raw.githubusercontent.com/tdlib/telegram-bot-api/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp "Webhook is already deleted"
  return answer(true, 'Webhook is already deleted');
}
