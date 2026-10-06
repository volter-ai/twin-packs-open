// Slack's reactions.* methods (https://docs.slack.dev/reference/methods?family=reactions): an emoji reaction on a
// message, one `reaction` subject per person and emoji (`<message>::<name>::<user>`), kept in the shape of the
// reaction_added event; a message's `reactions` are read from them (shared.ts messageView).
import type { HandlerContext } from '@volter/world-core';
import { arg, channelNamed, fail, messageId, messageView, now, ok, sees, who } from './shared.ts';

type Row = Record<string, unknown>;

/** The message a call names by `channel` and `timestamp` ("message_not_found"). */
function target(ctx: HandlerContext): { c: Row; m: Row } | Response {
  const by = who(ctx);
  const c = channelNamed(ctx, arg(ctx, 'channel'), by.team);
  if (!c || !sees(ctx, c, by)) return fail(ctx, 'channel_not_found');
  const ts = arg(ctx, 'timestamp');
  const m = ts ? ctx.get('message', messageId(String(c.id), ts)) : undefined;
  if (!m || m.deleted === true) return fail(ctx, 'message_not_found');
  return { c, m };
}

/** An emoji's name as a reaction takes it: without its colons, a skin tone kept (`thumbsup::skin-tone-2`). */
const reactionName = (name: string | undefined): string => (name ?? '').replace(/^:|:$/g, '');
const keyOf = (t: { c: Row; m: Row }, name: string, user: string): string => `${messageId(String(t.c.id), String(t.m.ts))}::${name}::${user}`;

/** reactions.add: "Adds a reaction to an item"; the caller's reaction already there is `already_reacted`. */
export async function reactions_add(ctx: HandlerContext): Promise<Response> {
  const by = who(ctx);
  const t = target(ctx);
  if (t instanceof Response) return t;
  const name = reactionName(arg(ctx, 'name'));
  if (!name) return fail(ctx, 'invalid_name');
  const key = keyOf(t, name, by.user);
  if (ctx.row('reaction', key)) return fail(ctx, 'already_reacted');
  await ctx.write('reaction', key, {
    user: by.user, reaction: name, item_user: t.m.user, item: { type: 'message', channel: t.c.id, ts: t.m.ts }, event_ts: String(now(ctx)),
    _message: messageId(String(t.c.id), String(t.m.ts)), deleted: false,
  }, 'reaction.add');
  return ok(ctx);
}

/** reactions.remove: the caller's own reaction ("no_reaction" when it has none of that name). */
export async function reactions_remove(ctx: HandlerContext): Promise<Response> {
  const by = who(ctx);
  const t = target(ctx);
  if (t instanceof Response) return t;
  const key = keyOf(t, reactionName(arg(ctx, 'name')), by.user);
  if (!ctx.row('reaction', key)) return fail(ctx, 'no_reaction');
  await ctx.remove('reaction', key, 'reaction.remove');
  return ok(ctx);
}

/** reactions.get: a message's reactions, with the message. */
export async function reactions_get(ctx: HandlerContext): Promise<Response> {
  const t = target(ctx);
  if (t instanceof Response) return t;
  return ok(ctx, { type: 'message', channel: t.c.id, message: messageView(ctx, t.m) });
}
