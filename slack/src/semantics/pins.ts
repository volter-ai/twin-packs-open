// Slack's pins.* methods (https://docs.slack.dev/reference/methods?family=pins): a message pinned to its channel, one
// `pin` subject each (`<channel>::<ts>`), in the shape pins.list answers an item, its message named by `_ts` (a refresh
// observes pins.list's item so: manifest.ts); a message's `pinned_to` is read from them (shared.ts messageView).
import type { HandlerContext } from '@volter/world-core';
import { arg, channelMembers, channelNamed, fail, messageId, messageView, permalinkOf, now, ok, sees, who } from './shared.ts';

type Row = Record<string, unknown>;

/** The channel and message a call names, by a member of the channel ("not_in_channel"). */
function target(ctx: HandlerContext): { c: Row; m: Row } | Response {
  const by = who(ctx);
  const c = channelNamed(ctx, arg(ctx, 'channel'), by.team);
  if (!c || !sees(ctx, c, by)) return fail(ctx, 'channel_not_found');
  if (c.is_im !== true && !channelMembers(ctx, String(c.id)).includes(by.user)) return fail(ctx, 'not_in_channel');
  const ts = arg(ctx, 'timestamp');
  const m = ts ? ctx.get('message', messageId(String(c.id), ts)) : undefined;
  if (!m || m.deleted === true) return fail(ctx, 'message_not_found');
  return { c, m };
}

/** pins.add: "Pins an item to a channel"; one pinned already is `already_pinned`. */
export async function pins_add(ctx: HandlerContext): Promise<Response> {
  const t = target(ctx);
  if (t instanceof Response) return t;
  const key = `${String(t.c.id)}::${String(t.m.ts)}`;
  if (ctx.row('pin', key)) return fail(ctx, 'already_pinned');
  await ctx.write('pin', key, { type: 'message', channel: t.c.id, created: now(ctx), created_by: who(ctx).user, _message: messageId(String(t.c.id), String(t.m.ts)), _ts: t.m.ts, deleted: false }, 'pin.add');
  return ok(ctx);
}

/** pins.remove: one not pinned is `no_pin`. */
export async function pins_remove(ctx: HandlerContext): Promise<Response> {
  const t = target(ctx);
  if (t instanceof Response) return t;
  const key = `${String(t.c.id)}::${String(t.m.ts)}`;
  if (!ctx.row('pin', key)) return fail(ctx, 'no_pin');
  await ctx.remove('pin', key, 'pin.remove');
  return ok(ctx);
}

/** pins.list: a channel's pinned messages, each with its message. */
export async function pins_list(ctx: HandlerContext): Promise<Response> {
  const by = who(ctx);
  const c = channelNamed(ctx, arg(ctx, 'channel'), by.team);
  if (!c || !sees(ctx, c, by)) return fail(ctx, 'channel_not_found');
  // source: spec:/paths/~1pins.list/get/responses/200/examples/application~1json/items/0/message "permalink"
  const items = ctx.rowsRaw('pin').filter((p) => p.channel === c.id).flatMap((p) => {
    const m = ctx.get('message', messageId(String(c.id), String(p._ts)));
    return m && m.deleted !== true ? [{ type: 'message', channel: c.id, created: p.created, created_by: p.created_by, message: { ...messageView(ctx, m), permalink: permalinkOf(ctx, c, String(m.ts)) } }] : [];
  });
  return ok(ctx, { items });
}
