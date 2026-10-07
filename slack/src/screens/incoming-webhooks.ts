// SLACK'S INCOMING WEBHOOKS — hooks.slack.com/services/<team>/<hook>/<secret>, where an install's incoming webhook
// posts: "a JSON payload … the message will be posted to the channel chosen" as the app, and Slack answers `ok`, or a
// plain-text error — `invalid_payload`, `no_text`, `no_service` for a webhook Slack does not know, and
// `channel_is_archived` (410) for its channel archived
// (https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks#handling_errors). A content host
// (docs/contributing/architecture.md, "Screens").
import type { HandlerContext } from '@volter/world-core';
import { channelTeam, post } from '../semantics/shared.ts';

const text = (status: number, body: string): Response => new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });

export async function screen(ctx: HandlerContext): Promise<Response> {
  const m = /^\/services\/([^/]+)\/([^/]+)\/([^/]+)\/?$/.exec(new URL(ctx.call.request.url).pathname);
  if (!m || ctx.call.request.method !== 'POST') return text(404, 'no_service');
  const hook = ctx.row('incoming_webhook', m[2]!);
  if (!hook || hook.secret !== m[3] || hook.revoked === true) return text(404, 'no_service');
  let payload: Record<string, unknown>;
  try { payload = JSON.parse(ctx.text || String(new URLSearchParams(ctx.text).get('payload') ?? '')) as Record<string, unknown>; } catch { return text(400, 'invalid_payload'); }
  if (typeof payload.text !== 'string' && !Array.isArray(payload.blocks) && !Array.isArray(payload.attachments)) return text(400, 'no_text');
  const channel = ctx.row('channel', String(hook.channel));
  if (!channel || channel.is_archived === true) return text(410, 'channel_is_archived');
  await post(ctx, channel, { kind: 'bot', token: '', user: String(hook.user), team: channelTeam(channel), scopes: [], bot: String(hook.bot), app: String(hook.app) }, {
    text: typeof payload.text === 'string' ? payload.text : '', ...(Array.isArray(payload.blocks) ? { blocks: payload.blocks } : {}), ...(Array.isArray(payload.attachments) ? { attachments: payload.attachments } : {}),
  });
  return text(200, 'ok');
}
