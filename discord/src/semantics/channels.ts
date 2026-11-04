// Channels and what lives in them: a channel read, a typing indicator, its messages (posting, JSON or multipart with
// payload_json and files[n]; reading them back; editing), a thread opened on a message, a bot's reactions (added and
// taken back), the channel's incoming webhook (made
// under MANAGE_WEBHOOKS and executed by whoever holds its URL, ./webhooks.ts) and its invite (made under
// CREATE_INSTANT_INVITE, accepted by a person in the client). `newMessage` (./shared.ts) is the one way a message is
// made, whoever sends it: a bot through the API, a webhook, or a person in the client (the door).
import type { HandlerContext } from '@volter/world-core';
import {
  authorized, CHANNEL, channelFor, editMessage, EPHEMERAL, fail, has, invalidForm, INVITE, inviteOpen, inviteView, isThread, lengthBetween, MESSAGE, messageBody, messageView,
  newMessage, obj, P, REACTION, addReaction, type Row, sha256, stamp, TYPE, unknown, WEBHOOK, webhookToken, webhookView,
} from './shared.ts';

// source: https://docs.discord.com/developers/resources/channel "Get a channel by ID."
export async function get_channel(ctx: HandlerContext): Promise<Response> {
  const c = authorized(ctx);
  if (c instanceof Response) return c;
  const at = channelFor(ctx, String(ctx.call.params.channel_id), String(c.user.id));
  return at instanceof Response ? at : Response.json(ctx.get(CHANNEL, String(at.channel.id)));
}

// source: https://docs.discord.com/developers/resources/channel "Post a typing indicator for the specified channel, which expires after 10 seconds."
// The Typing Start event it fires is not sent: the indicator is gone in ten seconds and the twin keeps no typing state,
// and no application of the World listens for it (Hermes and the Chat SDK register no typing handler)
export async function trigger_typing_indicator(ctx: HandlerContext): Promise<Response> {
  const c = authorized(ctx);
  if (c instanceof Response) return c;
  const at = channelFor(ctx, String(ctx.call.params.channel_id), String(c.user.id));
  if (at instanceof Response) return at;
  // source: https://docs.discord.com/developers/resources/channel "Returns a 204 empty response on success."
  return new Response(null, { status: 204 });
}

/** The permission a post needs where it goes: SEND_MESSAGES in a channel, SEND_MESSAGES_IN_THREADS in a thread, and
 *  ATTACH_FILES with files and READ_MESSAGE_HISTORY with a reply; a category takes no messages. */
function mayPost(channel: Row, perms: bigint, body: Row, files: unknown[]): Response | undefined {
  // source: https://docs.discord.com/developers/topics/opcodes-and-status-codes "Cannot send messages in a non-text channel"
  if (Number(channel.type) === TYPE.GUILD_CATEGORY || Number(channel.type) === TYPE.GUILD_FORUM) return fail(400, 50008, 'Cannot send messages in a non-text channel');
  // source: https://docs.discord.com/developers/resources/message "the current user must have the"
  const send = isThread(channel) ? P.SEND_MESSAGES_IN_THREADS : P.SEND_MESSAGES;
  if (!has(perms, send) || (files.length && !has(perms, P.ATTACH_FILES)) || (obj(body.message_reference).message_id !== undefined && !has(perms, P.READ_MESSAGE_HISTORY)) || (body.tts === true && !has(perms, P.SEND_TTS_MESSAGES))) {
    return fail(403, 50013, 'Missing Permissions');
  }
  return undefined;
}

// source: https://docs.discord.com/developers/resources/message "Returns an array of message objects from newest to oldest on success."
export async function list_messages(ctx: HandlerContext): Promise<Response> {
  const c = authorized(ctx);
  if (c instanceof Response) return c;
  const at = channelFor(ctx, String(ctx.call.params.channel_id), String(c.user.id));
  if (at instanceof Response) return at;
  // source: https://docs.discord.com/developers/resources/message "If the channel is a voice channel, they must also have the CONNECT permission."
  if (Number(at.channel.type) === TYPE.GUILD_VOICE && !has(at.perms, P.CONNECT)) return fail(403, 50001, 'Missing Access');
  const q = new URL(ctx.call.request.url).searchParams;
  const limit = q.get('limit') === null ? 50 : Number(q.get('limit'));
  // source: https://docs.discord.com/developers/resources/message "Max number of messages to return (1-100)"
  if (!Number.isInteger(limit) || limit < 1) return invalidForm({ limit: { code: 'NUMBER_TYPE_MIN', message: 'int value should be greater than or equal to 1.' } });
  if (limit > 100) return invalidForm({ limit: { code: 'NUMBER_TYPE_MAX', message: 'int value should be less than or equal to 100.' } });
  // source: https://docs.discord.com/developers/resources/message "then no messages will be returned"
  if (!has(at.perms, P.READ_MESSAGE_HISTORY)) return Response.json([]);
  const snow = (v: unknown): bigint => BigInt(String(v));
  // source: https://docs.discord.com/developers/resources/message "this message is only visible to the user who invoked the Interaction"
  const all = ctx.rowsRaw(MESSAGE).filter((m) => m.deleted !== true && (Number(m.flags) & EPHEMERAL) === 0 && m.channel_id === at.channel.id).sort((a, z) => (snow(z.id) > snow(a.id) ? 1 : snow(z.id) < snow(a.id) ? -1 : 0));
  // source: https://docs.discord.com/developers/resources/message "The before , after , and around parameters are mutually exclusive"
  // Where the documentation stops: given more than one, the twin takes around, then before, then after; around takes
  // the message itself and the older half (rounded up), and the newer half, each nearest the message
  const around = q.get('around'); const before = q.get('before'); const after = q.get('after');
  let page: Row[];
  if (around !== null && /^\d+$/.test(around)) {
    const half = Math.floor(limit / 2);
    const newer = all.filter((m) => snow(m.id) > snow(around));
    page = [...newer.slice(newer.length - Math.min(half, newer.length)), ...all.filter((m) => snow(m.id) <= snow(around)).slice(0, limit - half)];
  } else if (before !== null && /^\d+$/.test(before)) page = all.filter((m) => snow(m.id) < snow(before)).slice(0, limit);
  else if (after !== null && /^\d+$/.test(after)) { const newer = all.filter((m) => snow(m.id) > snow(after)); page = newer.slice(Math.max(0, newer.length - limit)); }
  else page = all.slice(0, limit);
  return Response.json(page.map((m) => messageView(ctx, m, String(c.user.id))));
}

// source: https://docs.discord.com/developers/resources/message "Post a message to a guild text or DM channel."
export async function create_message(ctx: HandlerContext): Promise<Response> {
  const c = authorized(ctx);
  if (c instanceof Response) return c;
  const at = channelFor(ctx, String(ctx.call.params.channel_id), String(c.user.id));
  if (at instanceof Response) return at;
  const { body, files } = await messageBody(ctx);
  const refused = mayPost(at.channel, at.perms, body, files);
  if (refused) return refused;
  const made = await newMessage(ctx, at.channel, { user: String(c.user.id) }, body, files);
  return made instanceof Response ? made : Response.json(messageView(ctx, made, String(c.user.id)));
}

/** A message of a channel the caller may read the history of. */
function readable(ctx: HandlerContext, user: string): { channel: Row; perms: bigint; message: Row } | Response {
  const at = channelFor(ctx, String(ctx.call.params.channel_id), user);
  if (at instanceof Response) return at;
  // source: https://docs.discord.com/developers/resources/message "this endpoint requires the"
  if (!has(at.perms, P.READ_MESSAGE_HISTORY)) return fail(403, 50013, 'Missing Permissions');
  const message = ctx.row(MESSAGE, String(ctx.call.params.message_id));
  if (!message || message.deleted === true || message.channel_id !== at.channel.id) return unknown(10008, 'Message');
  return { ...at, message };
}

// source: https://docs.discord.com/developers/resources/message "can be edited by the original message author"
export async function update_message(ctx: HandlerContext): Promise<Response> {
  const c = authorized(ctx);
  if (c instanceof Response) return c;
  const at = readable(ctx, String(c.user.id));
  if (at instanceof Response) return at;
  const { body, files } = await messageBody(ctx);
  // source: https://docs.discord.com/developers/topics/opcodes-and-status-codes "Cannot edit a message authored by another user"
  if (at.message._author !== c.user.id) return fail(403, 50005, 'Cannot edit a message authored by another user');
  return editMessage(ctx, at.message, body, String(c.user.id), files);
}

/** A reaction's emoji as the path names it: a Unicode emoji, or `name:id` for a custom one, which the World's servers
 *  have none of; anything else is no emoji. */
function emojiOf(ctx: HandlerContext): string | Response {
  const raw = decodeURIComponent(String(ctx.call.params.emoji_name));
  // source: https://docs.discord.com/developers/resources/message "To use custom emoji, you must encode it in the format"
  const custom = /^[\w~]+:(\d+)$/.exec(raw);
  // source: https://docs.discord.com/developers/topics/opcodes-and-status-codes "Unknown emoji"
  if (custom || !/\p{Extended_Pictographic}/u.test(raw)) return unknown(10014, 'Emoji');
  return raw;
}

// source: https://docs.discord.com/developers/resources/message "Create a reaction for the message."
export async function add_my_message_reaction(ctx: HandlerContext): Promise<Response> {
  const c = authorized(ctx);
  if (c instanceof Response) return c;
  const at = readable(ctx, String(c.user.id));
  if (at instanceof Response) return at;
  const emoji = emojiOf(ctx);
  if (emoji instanceof Response) return emoji;
  const refused = await addReaction(ctx, at, emoji, String(c.user.id));
  // source: https://docs.discord.com/developers/resources/message "Returns a 204 empty response on success. Fires a Message Reaction Add Gateway event."
  return refused ?? new Response(null, { status: 204 });
}

// source: https://docs.discord.com/developers/resources/message "Delete a reaction the current user has made for the message."
export async function delete_my_message_reaction(ctx: HandlerContext): Promise<Response> {
  const c = authorized(ctx);
  if (c instanceof Response) return c;
  const at = readable(ctx, String(c.user.id));
  if (at instanceof Response) return at;
  const emoji = emojiOf(ctx);
  if (emoji instanceof Response) return emoji;
  const id = `${String(at.message.id)}:${emoji}:${String(c.user.id)}`;
  // Where the documentation stops: taking back a reaction the caller never made is answered as the success, the
  // message left as it was (the page names no refusal for it)
  if (ctx.row(REACTION, id) && ctx.row(REACTION, id)!.deleted !== true) await ctx.remove(REACTION, id, 'reaction.remove');
  // source: https://docs.discord.com/developers/resources/message "Returns a 204 empty response on success. Fires a Message Reaction Remove Gateway event."
  return new Response(null, { status: 204 });
}

// source: https://docs.discord.com/developers/resources/channel "The id of the created thread will be the same as the id of the source message"
export async function create_thread_from_message(ctx: HandlerContext): Promise<Response> {
  const c = authorized(ctx);
  if (c instanceof Response) return c;
  const at = readable(ctx, String(c.user.id));
  if (at instanceof Response) return at;
  const b = obj(ctx.body);
  const name = typeof b.name === 'string' ? b.name : '';
  // source: https://docs.discord.com/developers/resources/channel "1-100 character channel name"
  if (name.length < 1 || name.length > 100) return invalidForm({ name: lengthBetween(1, 100) });
  // source: https://docs.discord.com/developers/resources/channel "Does not work on a"
  if (![TYPE.GUILD_TEXT, TYPE.GUILD_ANNOUNCEMENT].includes(Number(at.channel.type) as 0 | 5)) return fail(400, 50024, 'Cannot execute action on this channel type');
  if (!has(at.perms, P.CREATE_PUBLIC_THREADS)) return fail(403, 50013, 'Missing Permissions');
  // source: https://docs.discord.com/developers/topics/opcodes-and-status-codes "A thread has already been created for this message"
  if (at.message.thread_id || ctx.row(CHANNEL, String(at.message.id))) return fail(400, 160004, 'A thread has already been created for this message');
  const archive = b.auto_archive_duration === undefined ? 4320 : Number(b.auto_archive_duration);
  // source: https://docs.discord.com/developers/resources/channel "can be set to: 60, 1440, 4320, 10080"
  if (![60, 1440, 4320, 10080].includes(archive)) return invalidForm({ auto_archive_duration: { code: 'BASE_TYPE_CHOICES', message: 'Value must be one of {60, 1440, 4320, 10080}.' } });
  const id = String(at.message.id);
  const thread: Row = {
    id, type: Number(at.channel.type) === TYPE.GUILD_ANNOUNCEMENT ? TYPE.ANNOUNCEMENT_THREAD : TYPE.PUBLIC_THREAD, guild_id: at.channel.guild_id, parent_id: at.channel.id,
    owner_id: c.user.id, name, last_message_id: null, rate_limit_per_user: Number(b.rate_limit_per_user ?? 0), flags: 0, member_count: 1, message_count: 0, total_message_sent: 0,
    thread_metadata: { archived: false, auto_archive_duration: archive, archive_timestamp: stamp(ctx.occurredAt), locked: false, create_timestamp: stamp(ctx.occurredAt) },
    member: { id, user_id: c.user.id, join_timestamp: stamp(ctx.occurredAt), flags: 0 },
  };
  await ctx.write(CHANNEL, id, thread, 'thread.create');
  await ctx.write(MESSAGE, id, { thread_id: id, flags: Number(at.message.flags ?? 0) | 32 }, 'message.thread');
  return Response.json(ctx.get(CHANNEL, id), { status: 201 });
}

// source: https://docs.discord.com/developers/resources/webhook "Creates a new webhook and returns a"
export async function create_webhook(ctx: HandlerContext): Promise<Response> {
  const c = authorized(ctx);
  if (c instanceof Response) return c;
  const at = channelFor(ctx, String(ctx.call.params.channel_id), String(c.user.id));
  if (at instanceof Response) return at;
  if (!has(at.perms, P.MANAGE_WEBHOOKS)) return fail(403, 50013, 'Missing Permissions');
  const b = obj(ctx.body);
  const name = typeof b.name === 'string' ? b.name : '';
  // source: https://docs.discord.com/developers/resources/webhook "name of the webhook (1-80 characters)"
  if (name.length < 1 || name.length > 80) return invalidForm({ name: { code: 'BASE_TYPE_BAD_LENGTH', message: 'Must be between 1 and 80 in length.' } });
  // source: https://docs.discord.com/developers/resources/webhook "It does not contain the substrings"
  // Where the documentation stops: the refusal's code and message are the twin's, in the form-body error Discord answers
  const banned = /clyde|discord/i.exec(name)?.[0];
  if (banned) return invalidForm({ name: { code: 'USERNAME_INVALID_CONTAINS', message: `Username cannot contain "${banned.toLowerCase()}"` } });
  const id = ctx.mint(WEBHOOK);
  const token = await webhookToken(ctx, id);
  await ctx.write(WEBHOOK, id, {
    id, type: 1, guild_id: at.channel.guild_id, channel_id: at.channel.id, name, avatar: null, application_id: c.kind === 'bot' ? c.app.id : null,
    _creator: c.user.id, _token_sha256: sha256(ctx, token),
  }, 'webhook.create');
  // the webhook as its creator sees it: with its creator, its token and its URL
  return Response.json({ ...(await webhookView(ctx, ctx.row(WEBHOOK, id)!)), url: `https://discord.com/api/webhooks/${id}/${token}` });
}

// source: https://docs.discord.com/developers/resources/channel "Create a new invite object for the channel."
export async function create_channel_invite(ctx: HandlerContext): Promise<Response> {
  const c = authorized(ctx);
  if (c instanceof Response) return c;
  const at = channelFor(ctx, String(ctx.call.params.channel_id), String(c.user.id));
  if (at instanceof Response) return at;
  if (!has(at.perms, P.CREATE_INSTANT_INVITE)) return fail(403, 50013, 'Missing Permissions');
  const b = obj(ctx.body);
  const maxAge = b.max_age === undefined ? 86400 : Number(b.max_age);
  const maxUses = b.max_uses === undefined ? 0 : Number(b.max_uses);
  // source: https://docs.discord.com/developers/resources/channel "between 0 and 604800 (7 days)"
  if (!Number.isInteger(maxAge) || maxAge < 0 || maxAge > 604800) return invalidForm({ max_age: { code: 'NUMBER_TYPE_MAX', message: 'int value should be less than or equal to 604800.' } });
  // source: https://docs.discord.com/developers/resources/channel "max number of uses or 0 for unlimited. between 0 and 100"
  if (!Number.isInteger(maxUses) || maxUses < 0 || maxUses > 100) return invalidForm({ max_uses: { code: 'NUMBER_TYPE_MAX', message: 'int value should be less than or equal to 100.' } });
  const temporary = b.temporary === true;
  // source: https://docs.discord.com/developers/resources/channel "try to reuse a similar invite"
  if (b.unique !== true) {
    const similar = ctx.rowsRaw(INVITE).find((i) => inviteOpen(ctx, i) && i._channel === at.channel.id && i._inviter === c.user.id && i.max_age === maxAge && i.max_uses === maxUses && i.temporary === temporary);
    if (similar) return Response.json(inviteView(ctx, similar));
  }
  const code = ctx.mint(INVITE);
  await ctx.write(INVITE, code, {
    type: 0, max_age: maxAge, max_uses: maxUses, temporary, created_at: stamp(ctx.occurredAt),
    expires_at: maxAge === 0 ? null : stamp(new Date(Date.parse(ctx.occurredAt) + maxAge * 1000).toISOString()),
    _guild: at.channel.guild_id, _channel: at.channel.id, _inviter: c.user.id,
  }, 'invite.create');
  return Response.json(inviteView(ctx, ctx.row(INVITE, code)!));
}
