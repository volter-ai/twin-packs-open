// Slack's chat.* methods (https://docs.slack.dev/reference/methods?family=chat): posting, scheduling, editing and
// deleting messages.
import type { HandlerContext } from '@volter/world-core';
import { page } from '../engine/wire.ts';
import { channelTeam, arg, channelMembers, channelNamed, fail, jsonArg, messageId, messageView, now, ok, permalinkOf, post, sees, shown, who, type Caller } from './shared.ts';

type Row = Record<string, unknown>;

/** The conversation a message goes to, when the caller may post there: one it can see ("channel_not_found"), not
 *  archived ("is_archived"), and one it is in ("not_in_channel: Cannot post user messages to a channel they are not
 *  in"; a bot's too, unless it holds chat:write.public for a public channel). */
function postable(ctx: HandlerContext, by: Caller, named = arg(ctx, 'channel')): Row | Response {
  const c = channelNamed(ctx, named, by.team);
  if (!c || !sees(ctx, c, by)) return fail(ctx, 'channel_not_found');
  if (c.is_archived === true) return fail(ctx, 'is_archived');
  const publicPost = c.is_private !== true && c.is_im !== true && by.scopes !== '*' && by.scopes.includes('chat:write.public');
  if (!channelMembers(ctx, String(c.id)).includes(by.user) && !publicPost) return fail(ctx, 'not_in_channel');
  return c;
}

/** A message's content as a call gives it: `text`, `blocks` (JSON) as sent, else (for a new message) the text as Slack
 *  writes it, one rich_text block; and `attachments` (JSON), each numbered (`id`, from 1). A message with none of them
 *  is `no_text`. An edit (`held`, the message as it stands) keeps the blocks it does not send ("If you don't include
 *  this field, the message's previous `blocks` will be retained"), and an empty array removes them; the twin's
 *  decision: blocks Slack wrote from the old text are its rendering, and go with the text an edit replaces. */
// source: spec:/paths/~1chat.postMessage/post/responses/200/examples/application~1json/message/attachments/0 "id"
// source: spec:/paths/~1chat.update/post/parameters/3 "the message's previous `blocks` will be retained"
function content(ctx: HandlerContext, ts: () => string, held?: Row): Row | undefined {
  const text = arg(ctx, 'text');
  const blocks = jsonArg(ctx, 'blocks');
  const attachments = jsonArg(ctx, 'attachments');
  if (text === undefined && !Array.isArray(blocks) && !Array.isArray(attachments)) return undefined;
  const fromText = !Array.isArray(blocks) && !held && Boolean(text);
  const written = Array.isArray(blocks) ? (blocks.length ? blocks : null)
    : held ? (held._blocks_from_text === true && text !== undefined ? null : undefined)
    : text ? [{ type: 'rich_text', block_id: ctx.crypto.digest('sha256', `block:${ts()}`, 'hex').slice(0, 5), elements: [{ type: 'rich_text_section', elements: [{ type: 'text', text }] }] }] : undefined;
  return {
    text: text ?? (held ? held.text : ''), ...(written === undefined ? {} : { blocks: written, _blocks_from_text: fromText }),
    ...(Array.isArray(attachments) ? { attachments: attachments.map((a, i) => ({ id: i + 1, ...(a as Row) })) } : {}),
  };
}

/** A message sent as `markdown_text` ("Accepts message text formatted in markdown"): Slack renders it as a markdown
 *  block. Where the documentation stops: Slack translates that block ("passing a single block may result in multiple
 *  blocks after translation") and names no rule for the translation or for the message's `text`; the twin keeps the
 *  block as sent, and the markdown as the message's text. */
// source: https://docs.slack.dev/reference/methods/chat.postMessage "Accepts message text formatted in markdown."
// source: https://docs.slack.dev/reference/block-kit/blocks/markdown-block "Note that passing a single block may result in multiple blocks after translation."
const markdownContent = (markdown: string): Row => ({ text: markdown, blocks: [{ type: 'markdown', text: markdown }], _blocks_from_text: false });

/** A bot's message under a name it chose (`username`, with chat:write.customize) is a bot_message by that name. */
// source: spec:/paths/~1chat.postMessage/post/responses/200/examples/application~1json/message/subtype "bot_message"
const customized = (ctx: HandlerContext, by: Caller): Row => (by.bot && arg(ctx, 'username') ? { subtype: 'bot_message', username: arg(ctx, 'username') } : {});

/** chat.postMessage: "Sends a message to a channel", or a reply into a thread (`thread_ts`); answers the channel's id,
 *  the message's ts and the message. */
export async function chat_postMessage(ctx: HandlerContext): Promise<Response> {
  const by = who(ctx);
  const c = postable(ctx, by);
  if (c instanceof Response) return c;
  const markdown = arg(ctx, 'markdown_text');
  // source: https://docs.slack.dev/reference/methods/chat.postMessage "Markdown text cannot be used in conjunction with blocks or text argument."
  if (markdown !== undefined && (arg(ctx, 'text') !== undefined || ctx.params.blocks !== undefined)) return fail(ctx, 'markdown_text_conflict');
  const body = markdown !== undefined ? markdownContent(markdown) : content(ctx, () => `${String(c.id)}:${now(ctx)}:${String(arg(ctx, 'text') ?? '')}`);
  if (!body) return fail(ctx, 'no_text');
  // source: https://docs.slack.dev/reference/methods/chat.postMessage "too_many_attachments"
  if (((body.attachments as unknown[] | undefined) ?? []).length > 100) return fail(ctx, 'too_many_attachments');
  const thread = arg(ctx, 'thread_ts');
  if (thread && !ctx.get('message', messageId(String(c.id), thread))) return fail(ctx, 'thread_not_found');
  const broadcast = thread !== undefined && (ctx.params.reply_broadcast === true || ctx.params.reply_broadcast === 'true');
  const m = await post(ctx, c, by, { ...body, ...customized(ctx, by), ...(thread ? { thread_ts: thread } : {}), ...(broadcast ? { subtype: 'thread_broadcast' } : {}) });
  return ok(ctx, { channel: c.id, ts: m.ts, message: messageView(ctx, m) });
}

/** chat.meMessage: a /me message ("Share a me message into a channel"), subtype me_message. */
export async function chat_meMessage(ctx: HandlerContext): Promise<Response> {
  const by = who(ctx);
  const c = postable(ctx, by);
  if (c instanceof Response) return c;
  const text = arg(ctx, 'text');
  if (!text) return fail(ctx, 'no_text');
  const m = await post(ctx, c, by, { text, subtype: 'me_message' });
  return ok(ctx, { channel: c.id, ts: m.ts });
}

/** chat.update: "Updates a message" — the caller's own ("cant_update_message"), its text and blocks replaced, marked
 *  edited. */
export async function chat_update(ctx: HandlerContext): Promise<Response> {
  const by = who(ctx);
  const c = channelNamed(ctx, arg(ctx, 'channel'), by.team);
  if (!c || !sees(ctx, c, by)) return fail(ctx, 'channel_not_found');
  const ts = arg(ctx, 'ts');
  const m = ts ? ctx.get('message', messageId(String(c.id), ts)) : undefined;
  if (!m || m.deleted === true) return fail(ctx, 'message_not_found');
  if (m.user !== by.user) return fail(ctx, 'cant_update_message');
  const body = content(ctx, () => '', ctx.row('message', messageId(String(c.id), String(ts))));
  if (!body) return fail(ctx, 'no_text');
  const updated = await ctx.write('message', messageId(String(c.id), String(ts)), { ...body, edited: { user: by.user, ts: String(now(ctx)) + '.000000' } }, 'message.update');
  return ok(ctx, { channel: c.id, ts, text: updated.text, message: messageView(ctx, updated) });
}

/** chat.delete: "Deletes a message" — the caller's own, or any by a person who administers the workspace
 *  ("cant_delete_message"). */
export async function chat_delete(ctx: HandlerContext): Promise<Response> {
  const by = who(ctx);
  const c = channelNamed(ctx, arg(ctx, 'channel'), by.team);
  if (!c || !sees(ctx, c, by)) return fail(ctx, 'channel_not_found');
  const ts = arg(ctx, 'ts');
  const m = ts ? ctx.get('message', messageId(String(c.id), ts)) : undefined;
  if (!m || m.deleted === true) return fail(ctx, 'message_not_found');
  const admin = by.kind === 'person' && ctx.get('user', by.user)?.is_admin === true;
  if (m.user !== by.user && !admin) return fail(ctx, 'cant_delete_message');
  await ctx.write('message', messageId(String(c.id), String(ts)), { deleted: true }, 'message.delete');
  return ok(ctx, { channel: c.id, ts });
}

/** chat.getPermalink: a message's link (shared.ts permalinkOf). */
export async function chat_getPermalink(ctx: HandlerContext): Promise<Response> {
  const by = who(ctx);
  const c = channelNamed(ctx, arg(ctx, 'channel'), by.team);
  if (!c || !sees(ctx, c, by)) return fail(ctx, 'channel_not_found');
  const ts = arg(ctx, 'message_ts');
  const m = ts ? ctx.get('message', messageId(String(c.id), ts)) : undefined;
  if (!m || m.deleted === true) return fail(ctx, 'message_not_found');
  return ok(ctx, { channel: c.id, permalink: permalinkOf(ctx, c, String(ts)) });
}

/** The longest a message may be scheduled ahead: "a message up to 120 days in the future" (chat.scheduleMessage). */
const MAX_AHEAD = 120 * 86_400;

/** chat.scheduleMessage: "Schedules a message to be sent to a channel" at `post_at`, sent then (./clock.ts); a time
 *  passed is `time_in_past`, one more than 120 days ahead `time_too_far`. Answers the channel's id and the scheduled
 *  message. */
export async function chat_scheduleMessage(ctx: HandlerContext): Promise<Response> {
  const by = who(ctx);
  const c = postable(ctx, by);
  if (c instanceof Response) return c;
  const content_ = content(ctx, () => `${String(c.id)}:scheduled:${now(ctx)}:${String(arg(ctx, 'text') ?? '')}`);
  if (!content_) return fail(ctx, 'no_text');
  const body = { ...content_, ...customized(ctx, by) };
  const postAt = Number(arg(ctx, 'post_at'));
  if (!Number.isFinite(postAt)) return fail(ctx, 'invalid_time');
  if (postAt <= now(ctx)) return fail(ctx, 'time_in_past');
  if (postAt > now(ctx) + MAX_AHEAD) return fail(ctx, 'time_too_far');
  const thread = arg(ctx, 'thread_ts');
  const id = ctx.mint('scheduled_message');
  await ctx.write('scheduled_message', id, {
    channel_id: c.id, post_at: postAt, date_created: now(ctx), text: body.text, ...(thread ? { thread_ts: thread } : {}),
    _content: body, _by: { user: by.user, ...(by.bot ? { bot: by.bot, app: by.app } : {}) }, _sent: false,
  }, 'scheduled_message.create');
  // the answer's post_at is a string, as the spec's example gives it (scheduledMessages.list answers a number)
  // source: spec:/paths/~1chat.scheduleMessage/post/responses/200/examples/application~1json "post_at"
  return ok(ctx, {
    channel: c.id, scheduled_message_id: id, post_at: String(postAt),
    message: { ...shown(body), type: 'delayed_message', user: by.user, ...(by.bot ? { bot_id: by.bot, app_id: by.app } : {}), team: channelTeam(c) },
  });
}

/** chat.scheduledMessages.list: the caller's scheduled messages not yet sent, soonest first. */
export async function chat_scheduledMessages_list(ctx: HandlerContext): Promise<Response> {
  const by = who(ctx);
  const channel = arg(ctx, 'channel');
  // source: https://docs.slack.dev/reference/methods/chat.scheduledMessages.list "invalid_channel"
  if (channel) { const c = channelNamed(ctx, channel, by.team); if (!c || !sees(ctx, c, by)) return fail(ctx, 'invalid_channel'); }
  const pending = ctx.rowsRaw('scheduled_message').filter((s) => s._sent !== true && (s._by as Row | undefined)?.user === by.user && (!channel || s.channel_id === channel))
    .sort((a, b) => Number(a.post_at) - Number(b.post_at));
  const p = page(pending, ctx.params, 100);
  if (!p) return fail(ctx, 'invalid_cursor');
  return ok(ctx, { scheduled_messages: p.items.map((s) => ({ id: s.id, channel_id: s.channel_id, post_at: s.post_at, date_created: s.date_created, text: s.text })), response_metadata: { next_cursor: p.next } });
}

/** chat.deleteScheduledMessage: one not yet sent ("invalid_scheduled_message_id" for any other). */
export async function chat_deleteScheduledMessage(ctx: HandlerContext): Promise<Response> {
  const by = who(ctx);
  const id = arg(ctx, 'scheduled_message_id');
  const s = id ? ctx.row('scheduled_message', id) : undefined;
  if (!s || s._sent === true || (s._by as Row | undefined)?.user !== by.user || s.channel_id !== arg(ctx, 'channel')) return fail(ctx, 'invalid_scheduled_message_id');
  await ctx.write('scheduled_message', String(id), { deleted: true }, 'scheduled_message.delete');
  return ok(ctx);
}

/** chat.postEphemeral: "Sends an ephemeral message to a user in a channel", seen by that user alone and kept for them
 *  (never in the channel's history); the user must be in the channel ("user_not_in_channel"). Answers `message_ts`. */
export async function chat_postEphemeral(ctx: HandlerContext): Promise<Response> {
  const by = who(ctx);
  const c = channelNamed(ctx, arg(ctx, 'channel'), by.team);
  if (!c || !sees(ctx, c, by)) return fail(ctx, 'channel_not_found');
  const user = arg(ctx, 'user');
  if (!user || !ctx.get('user', user)) return fail(ctx, 'user_not_found');
  if (!channelMembers(ctx, String(c.id)).includes(user)) return fail(ctx, 'user_not_in_channel');
  const text = arg(ctx, 'text');
  const blocks = jsonArg(ctx, 'blocks');
  if (!text && !Array.isArray(blocks)) return fail(ctx, 'no_text');
  const id = ctx.mint('ephemeral');
  const ts = `${now(ctx)}.${id.padStart(6, '0')}`;
  await ctx.write('ephemeral', id, {
    channel: c.id, user, text: text ?? '', ...(Array.isArray(blocks) ? { blocks } : {}), ts, ...(by.bot ? { bot_id: by.bot, app: by.app } : { from: by.user }),
    ...(arg(ctx, 'thread_ts') ? { thread_ts: arg(ctx, 'thread_ts') } : {}),
  }, 'ephemeral.create');
  return ok(ctx, { message_ts: ts });
}

/** chat.unfurl: "Provide custom unfurl behavior for user-posted URLs": an app sent link_shared attaches its unfurls to
 *  the message, named by `channel` and `ts` or by `unfurl_id` and `source`; only links it was sent may be unfurled
 *  ("cannot_unfurl_url"). */
export async function chat_unfurl(ctx: HandlerContext): Promise<Response> {
  const by = who(ctx);
  const byId = arg(ctx, 'unfurl_id');
  const share = byId ? ctx.row('link_share', byId) : ctx.rowsRaw('link_share').find((l) => l.channel === arg(ctx, 'channel') && l.message_ts === arg(ctx, 'ts'));
  if (!share) return fail(ctx, 'cannot_find_message');
  const unfurls = jsonArg(ctx, 'unfurls');
  if (!unfurls || typeof unfurls !== 'object' || Array.isArray(unfurls)) return fail(ctx, 'invalid_unfurls_format');
  const shared = ((share.links as Array<Record<string, unknown>> | undefined) ?? []).map((l) => String(l.url));
  if (Object.keys(unfurls).some((u) => !shared.includes(u))) return fail(ctx, 'cannot_unfurl_url');
  const id = messageId(String(share.channel), String(share.message_ts));
  const m = ctx.row('message', id);
  if (!m) return fail(ctx, 'cannot_find_message');
  const attachments = Object.entries(unfurls as Record<string, Record<string, unknown>>).map(([url, u], i) => ({ ...u, id: i + 1, from_url: url, original_url: url, app_unfurl_url: url, is_app_unfurl: true, app_id: by.app }));
  await ctx.write('message', id, { attachments: [...((m.attachments as unknown[] | undefined) ?? []), ...attachments] }, 'message.unfurl');
  return ok(ctx);
}
