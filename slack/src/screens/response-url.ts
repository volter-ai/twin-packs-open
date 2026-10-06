// SLACK'S RESPONSE URLS — hooks.slack.com/actions/… and /commands/…, the `response_url` a slash command or an interaction
// hands its app: "You can use response_url to publish up to 5 times within 30 minutes". A JSON reply posts to the
// person alone (`response_type: ephemeral`, the default) or in the channel (`in_channel`); an interaction's reply may
// replace the message it came from (`replace_original`) or delete it (`delete_original`)
// (https://docs.slack.dev/interactivity/handling-user-interaction#message_responses). A content host
// (docs/contributing/architecture.md, "Screens").
import type { HandlerContext } from '@volter/world-core';
import { messageId, now, replyAsApp, RESPONSE_URLS } from '../semantics/shared.ts';

type Row = Record<string, unknown>;

const text = (status: number, body: string): Response => new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });

export async function screen(ctx: HandlerContext): Promise<Response> {
  const m = /^\/(actions|commands)\/[^/]+\/[^/]+\/([a-f0-9]+)\/?$/.exec(new URL(ctx.call.request.url).pathname);
  if (!m || ctx.call.request.method !== 'POST') return text(404, 'no_service');
  const key = m[2]!;
  const url = ctx.row(RESPONSE_URLS, key);
  if (!url || url.kind !== m[1]) return text(404, 'no_service');
  // its uses are its history's writes after the one that issued it
  const uses = ctx.history(RESPONSE_URLS, key).length - 1;
  if (now(ctx) - Number(url.issued) > 1800 || uses >= 5) return text(404, 'expired_url');
  let reply: Row;
  try { reply = JSON.parse(ctx.text) as Row; } catch { return text(400, 'invalid_payload'); }
  const content: Row = { text: typeof reply.text === 'string' ? reply.text : '', ...(Array.isArray(reply.blocks) ? { blocks: reply.blocks } : {}) };
  await ctx.record(RESPONSE_URLS, { last_used: now(ctx) }, key);
  const original = typeof url.message_ts === 'string' ? messageId(String(url.channel), url.message_ts) : undefined;
  if (original && reply.delete_original === true) {
    await ctx.write('message', original, { deleted: true }, 'message.delete');
    return text(200, 'ok');
  }
  if (original && reply.replace_original === true) {
    await ctx.write('message', original, content, 'message.update');
    return text(200, 'ok');
  }
  const posted = await replyAsApp(ctx, { app: String(url.app), team: String(url.team), channel: String(url.channel), user: String(url.user) }, reply);
  return posted ? text(200, 'ok') : text(404, 'channel_not_found');
}
