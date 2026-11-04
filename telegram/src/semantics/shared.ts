// What every family of telegram shares: the bot a request's token names, a chat's access as the Bot API server checks
// it, the objects as the Bot API answers them (a user, a chat, a member, a message), a message's text, a stored file,
// and the updates a write puts in each bot's queue.
//
// The Bot API server's own source is the evidence where the page says nothing (tdlib/telegram-bot-api, which the page
// names at "Using a Local Bot API Server", read at e3e9dd8; and TDLib, tdlib/td at 42e6a52, whose errors it relays).
import type { HandlerContext } from '@volter/world-core';
import { finish, parseHtml, parseMarkdown, parseMarkdownV2, type Entity, type Formatted } from '../engine/text.ts';

export type Row = Record<string, unknown>;
export type { HandlerContext };

// ── answers ─────────────────────────────────────────────────────────────────────────────────────────────────────

// source: https://core.telegram.org/bots/api#making-requests "If 'ok' equals True, the request was successful and the result of the query can be found in the 'result' field."
export function answer(result: unknown, description?: string): Response {
  return Response.json({ ok: true, result, ...(description !== undefined ? { description } : {}) });
}

/** A refusal in the Bot API's envelope ({ ok: false, error_code, description }), the HTTP status its code. */
export function refuse(ctx: HandlerContext, status: number, description: string): Response {
  return ctx.refuse({ status, message: description });
}

/** A parameter as the request gave it: a query or form value is text, a JSON body's value keeps its type. */
export function param(ctx: HandlerContext, name: string): unknown {
  const v = ctx.params[name];
  return v === '' ? undefined : v;
}

/** An integer parameter, or undefined when absent or not one. */
export function intParam(ctx: HandlerContext, name: string): number | undefined {
  const v = param(ctx, name);
  if (typeof v === 'number') return Number.isInteger(v) ? v : undefined;
  if (typeof v === 'string' && /^-?\d+$/.test(v.trim())) return Number(v.trim());
  return undefined;
}

/** A JSON-serialized parameter (reply_parameters, media, allowed_updates): a form value is its JSON text. */
export function jsonParam(ctx: HandlerContext, name: string): { value?: unknown; error?: true } {
  const v = param(ctx, name);
  if (v === undefined) return {};
  if (typeof v !== 'string') return { value: v };
  try { return { value: JSON.parse(v) }; } catch { return { error: true }; }
}

/** The vendor's own fields of a stored row: the kernel's bookkeeping (`_` fields, a tombstone) left out. */
function vendorFields(ctx: HandlerContext, row: Row): Row {
  return Object.fromEntries(Object.entries(ctx.own(row)).filter(([k]) => !k.startsWith('_') && k !== 'deleted'));
}

/** The methods this pack serves, as the page names them: a request naming one in another case is routed to it. */
export const SERVED_METHODS = ['getUpdates', 'deleteWebhook', 'getMe', 'sendMessage', 'sendPhoto', 'sendVideo', 'sendDocument', 'sendMediaGroup', 'sendChatAction', 'getChat', 'getChatMember', 'getFile', 'deleteMessage'];

// ── the bot ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** The token in a request's path: `/bot<token>/<method>`, or `/file/bot<token>/<path>` for a file. */
export function tokenOf(request: Request): string | undefined {
  const m = /^\/(?:file\/)?bot([^/]*)\//.exec(new URL(request.url).pathname);
  return m ? decodeURIComponent(m[1]!) : undefined;
}

/** The bot a well-formed token names when its secret is the one BotFather last issued (a token made again revokes
 *  the one before), or why not. */
export function botOfToken(ctx: HandlerContext, token: string | undefined): { bot: Row; user: Row } | 'invalid' | 'unknown' {
  // source: https://raw.githubusercontent.com/tdlib/telegram-bot-api/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/ClientManager.cpp "if (token[0] == '0' || token.size() > 80u || token.find('/') != td::string::npos ||"
  if (!token || token[0] === '0' || token.length > 80 || token.includes('/') || !token.includes(':')) return 'invalid';
  const id = token.slice(0, token.indexOf(':'));
  // source: https://raw.githubusercontent.com/tdlib/telegram-bot-api/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/ClientManager.cpp "auto r_user_id = td::to_integer_safe<td::int64>(query->token().substr(0, token.find(':')));"
  if (!/^\d+$/.test(id)) return 'invalid';
  const bot = ctx.row('_bot', id);
  const user = ctx.row('user', id);
  if (!bot || !user || bot.token_sha256 !== ctx.crypto.sha256(token)) return 'unknown';
  return { bot, user };
}

/** The bot the request's token names (around.ts has refused any other before the method ran). */
export function botOf(ctx: HandlerContext): { id: number; bot: Row; user: Row } {
  const found = botOfToken(ctx, tokenOf(ctx.call.request));
  if (typeof found === 'string') throw new Error('telegram: a method ran without its bot');
  return { id: Number(found.bot.id), ...found };
}

/** A bot's token: its user id and a secret drawn from the World's seed for this bot and this issue of it. */
export async function issueToken(ctx: HandlerContext, botId: string, generation: number): Promise<string> {
  // source: https://core.telegram.org/bots/features#botfather "The token is a string, like 110201543:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw"
  const secret = (await ctx.secret(`telegram-bot-token:${botId}:${generation}`)).replace(/[^A-Za-z0-9_-]/g, '');
  return `${botId}:AA${secret.slice(0, 33)}`;
}

// ── objects as the Bot API answers them ──────────────────────────────────────────────────────────────────────────

/** A User as it appears in a message or an update: the bot-only fields are getMe's alone. */
// source: https://core.telegram.org/bots/api#user "Optional. True, if the bot can be invited to groups. Returned only in getMe."
export function userView(ctx: HandlerContext, id: unknown): Row {
  const row = ctx.row('user', String(id));
  if (!row) return { id: Number(id), is_bot: false, first_name: '' };
  const v = vendorFields(ctx, row);
  return Object.fromEntries(Object.entries(v).filter(([k]) => ['id', 'is_bot', 'first_name', 'last_name', 'username', 'language_code', 'is_premium'].includes(k)));
}

/** A Chat as a message names it: its id, type and names. */
function chatView(ctx: HandlerContext, id: unknown): Row {
  const row = ctx.row('chat', String(id));
  const v = row ? vendorFields(ctx, row) : { id: Number(id), type: 'private' };
  return Object.fromEntries(Object.entries(v).filter(([k]) => ['id', 'type', 'title', 'username', 'first_name', 'last_name', 'is_forum', 'is_direct_messages'].includes(k)));
}

/** A ChatMember: its status, its user and what the status carries. */
export function memberView(ctx: HandlerContext, row: Row | undefined, user: unknown): Row {
  const status = String(row?.status ?? 'left');
  const fields = row ? vendorFields(ctx, row) : {};
  const rest = Object.fromEntries(Object.entries(fields).filter(([k]) => k !== 'status'));
  // source: https://core.telegram.org/bots/api#chatmemberbanned "Date when restrictions will be lifted for this user; Unix time. If 0, then the user is banned forever"
  if (status === 'kicked') return { status, user: userView(ctx, user), until_date: Number(rest.until_date ?? 0) };
  if (status === 'left') return { status, user: userView(ctx, user) };
  if (status === 'member') return { status, user: userView(ctx, user) };
  return { status, user: userView(ctx, user), ...rest };
}

/** A chat member's row (`<chat>:<user>`). */
export const memberKey = (chat: unknown, user: unknown): string => `${chat}:${user}`;

/** A Message as the Bot API answers it, its user, chat and replied message read as they stand. A replied message
 *  carries no reply of its own. */
// source: https://core.telegram.org/bots/api#message "Note that the Message object in this field will not contain further reply_to_message fields even if it itself is a reply."
export function messageView(ctx: HandlerContext, row: Row, nested = false): Row {
  const v = vendorFields(ctx, row);
  const out: Row = { message_id: v.message_id };
  if (row._from !== undefined) out.from = userView(ctx, row._from);
  if (row._sender_chat !== undefined) out.sender_chat = chatView(ctx, row._sender_chat);
  out.chat = chatView(ctx, row._chat);
  out.date = v.date;
  if (!nested && typeof row._reply_to === 'string') {
    const replied = ctx.row('message', row._reply_to);
    if (replied && replied.deleted !== true) out.reply_to_message = messageView(ctx, replied, true);
  }
  for (const [k, value] of Object.entries(v)) if (!(k in out)) out[k] = value;
  if (Array.isArray(row._new_members)) out.new_chat_members = row._new_members.map((u) => userView(ctx, u));
  return out;
}

/** A ChatFullInfo as getChat answers it, from a chat as chatOf reads it (its own id and type already restored). */
export function chatFullView(_ctx: HandlerContext, chat: Row): Row {
  return Object.fromEntries(Object.entries(chat).filter(([k]) => !k.startsWith('_') && k !== 'deleted'));
}

// ── a chat's access ─────────────────────────────────────────────────────────────────────────────────────────────

/** The chat a chat_id names: an integer id or a public chat's @username. */
export function findChat(ctx: HandlerContext, chatId: unknown): Row | undefined {
  if (typeof chatId === 'string' && chatId.startsWith('@')) {
    const name = chatId.slice(1).toLowerCase();
    const row = ctx.rowsRaw('chat').find((r) => r.deleted !== true && typeof r.username === 'string' && r.username.toLowerCase() === name);
    return row ? ctx.own(row) : undefined;
  }
  const id = typeof chatId === 'number' ? chatId : typeof chatId === 'string' && /^-?\d+$/.test(chatId.trim()) ? Number(chatId.trim()) : undefined;
  return id === undefined ? undefined : chatOf(ctx, id);
}

/** A chat as stored, its own `id` and `type` (the vendor's, which the kernel keeps apart from its own) restored. */
export function chatOf(ctx: HandlerContext, key: unknown): Row | undefined {
  const row = ctx.row('chat', String(key));
  return row && row.deleted !== true ? ctx.own(row) : undefined;
}

/** The chat a bot reaches with chat_id, and its own membership there, or the server's refusal: a read needs the chat
 *  known to the bot; a write in a group, a supergroup or a channel needs the bot a member, in a channel an
 *  administrator that may post, and in a private chat the person having started the bot. */
export function chatFor(ctx: HandlerContext, botId: number, chatId: unknown, need: 'read' | 'write'): { chat: Row; member: Row | undefined } | { refusal: Response } {
  // source: https://raw.githubusercontent.com/tdlib/telegram-bot-api/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp "Bad Request: chat not found"
  const notFound = { refusal: refuse(ctx, 400, 'Bad Request: chat not found') };
  // source: https://raw.githubusercontent.com/tdlib/telegram-bot-api/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp "Bad Request: chat_id is empty"
  if (chatId === undefined) return { refusal: refuse(ctx, 400, 'Bad Request: chat_id is empty') };
  const chat = findChat(ctx, chatId);
  if (!chat) return notFound;
  const member = ctx.row('chat_member', memberKey(chat.id, botId));
  const status = member?.deleted === true ? undefined : (member?.status as string | undefined);
  const type = String(chat.type);
  if (type === 'private') {
    // a bot knows a person's private chat only once the person has written to it (pressed Start)
    // source: https://raw.githubusercontent.com/tdlib/td/42e6a5259551178d1dab54a22ad96d14bd906e20/td/telegram/MessagesManager.cpp "Bot can't initiate conversation with a user"
    if (!status) return notFound;
    return { chat, member };
  }
  if (!status && !chat.username) return notFound;
  if (type === 'group') {
    if (need === 'write' && status === 'kicked') {
      // source: https://raw.githubusercontent.com/tdlib/telegram-bot-api/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp "Forbidden: bot was kicked from the group chat"
      return { refusal: refuse(ctx, 403, 'Forbidden: bot was kicked from the group chat') };
    }
    // (a bot that left a group by itself, "bot is not a member of the group chat", is not in this pack's scope: leaveChat
    // is not served and the doors make no member leave)
    return { chat, member };
  }
  const kind = type === 'channel' ? 'channel' : 'supergroup';
  if (status === 'kicked') {
    // source: https://raw.githubusercontent.com/tdlib/telegram-bot-api/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp "Forbidden: bot was kicked from the channel chat"
    return { refusal: refuse(ctx, 403, `Forbidden: bot was kicked from the ${kind} chat`) };
  }
  // a public chat is read by anyone; a write, or any use of a private one, needs the bot in it
  // source: https://raw.githubusercontent.com/tdlib/telegram-bot-api/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp "bool need_more_access_rights = is_public ? need_edit_access : need_read_access;"
  if ((!status || status === 'left') && (need === 'write' || !chat.username)) {
    // source: https://raw.githubusercontent.com/tdlib/telegram-bot-api/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp "Forbidden: bot is not a member of the channel chat"
    return { refusal: refuse(ctx, 403, `Forbidden: bot is not a member of the ${kind} chat`) };
  }
  if (need === 'write' && type === 'channel' && !(status === 'creator' || (status === 'administrator' && member?.can_post_messages === true))) {
    // source: https://core.telegram.org/bots/api#chatmemberadministrator "True , if the administrator can post messages in the channel"
    // source: https://raw.githubusercontent.com/tdlib/td/42e6a5259551178d1dab54a22ad96d14bd906e20/td/telegram/DialogManager.cpp "Need administrator rights in the channel chat"
    return { refusal: refuse(ctx, 400, 'Bad Request: need administrator rights in the channel chat') };
  }
  return { chat, member };
}

// ── a message's text ────────────────────────────────────────────────────────────────────────────────────────────

/** A text or a caption as the server keeps it: parsed by its parse_mode (HTML, MarkdownV2 or Markdown, named in any
 *  case; plain when none), with the entities the server finds itself, trimmed; or the server's refusal. */
export function formatted(ctx: HandlerContext, text: string, parseMode: unknown, entitiesParam: unknown): Formatted | { refusal: Response } {
  // source: https://raw.githubusercontent.com/tdlib/telegram-bot-api/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp "Text is too long"
  if (new TextEncoder().encode(text).length > 1 << 15) return { refusal: refuse(ctx, 400, 'Bad Request: text is too long') };
  const mode = typeof parseMode === 'string' ? parseMode.toLowerCase() : '';
  // source: https://raw.githubusercontent.com/tdlib/telegram-bot-api/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp "Unsupported parse_mode"
  if (!['', 'none', 'html', 'markdownv2', 'markdown'].includes(mode)) return { refusal: refuse(ctx, 400, 'Bad Request: unsupported parse_mode') };
  let parsed: Formatted;
  if (mode === '' || mode === 'none') {
    const given = Array.isArray(entitiesParam) ? (entitiesParam as Entity[]) : [];
    parsed = { text, entities: given };
  } else {
    // source: https://raw.githubusercontent.com/tdlib/telegram-bot-api/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp "text_parse_mode = make_object<td_api::textParseModeMarkdown>(2);"
    // source: https://core.telegram.org/bots/api#markdownv2-style "To use this mode, pass MarkdownV2 in the parse_mode field."
    // source: https://core.telegram.org/bots/api#markdown-style "This is a legacy mode, retained for backward compatibility."
    const r = mode === 'html' ? parseHtml(text) : mode === 'markdownv2' ? parseMarkdownV2(text) : parseMarkdown(text);
    // the parser's words, as the Bot API relays them
    // source: https://raw.githubusercontent.com/tdlib/td/42e6a5259551178d1dab54a22ad96d14bd906e20/td/telegram/MessageEntity.cpp "Unsupported start tag"
    // source: https://raw.githubusercontent.com/tdlib/td/42e6a5259551178d1dab54a22ad96d14bd906e20/td/telegram/MessageEntity.cpp "is reserved and must be escaped with the preceding"
    if ('error' in r) return { refusal: refuse(ctx, 400, `Bad Request: can't parse entities: ${r.error}`) };
    parsed = r;
  }
  // a bot's text gets the entities the server finds (TDLib's fix_formatted_text: a bot finds new entities)
  // source: https://raw.githubusercontent.com/tdlib/td/42e6a5259551178d1dab54a22ad96d14bd906e20/td/telegram/MessageEntity.cpp "add_entities(MessageEntity::Type::Mention, find_mentions);"
  const done = finish(parsed, { find: true, skipBotCommands: false });
  const entities: Entity[] = [];
  for (const e of done.entities) {
    // a custom emoji is kept only for a bot with a username bought on Fragment, or one whose owner has Premium; no bot of
    // a World has either, so its emoji shows as the text it stands on
    // source: https://core.telegram.org/bots/api#formatting-options "Custom emoji entities can only be used by bots that purchased additional usernames on Fragment or in the messages directly sent by the bot to private, group and supergroup chats if the owner of the bot has a Telegram Premium subscription."
    if (e.type === 'custom_emoji') continue;
    if (e.type === 'text_mention') {
      // a mention by id names a user the World holds; one it does not know is no mention
      // source: https://core.telegram.org/bots/api#formatting-options "Links tg://user?id=<user_id> can be used to mention a user by their identifier without using a username."
      const user = ctx.row('user', String(e.user_id));
      if (!user) continue;
      entities.push({ type: 'text_mention', offset: e.offset, length: e.length, user: userView(ctx, e.user_id) } as unknown as Entity);
      continue;
    }
    entities.push(e);
  }
  return { text: done.text, entities };
}

/** A message's text, its entities only where it has some. */
export const textFields = (f: Formatted, as: 'text' | 'caption'): Row =>
  f.text === '' ? {} : { [as]: f.text, ...(f.entities.length ? { [as === 'text' ? 'entities' : 'caption_entities']: f.entities } : {}) };

// ── messages ────────────────────────────────────────────────────────────────────────────────────────────────────

/** The next message_id of a chat: one past the last it holds. */
// source: https://core.telegram.org/bots/api#message "Unique message identifier inside this chat;"
export async function nextMessageId(ctx: HandlerContext, chatKey: string, operation: string): Promise<number> {
  const row = await ctx.change('chat', chatKey, (current) => ({ _last_message_id: Number(current._last_message_id ?? 0) + 1 }), operation);
  return Number((row as Row | undefined)?._last_message_id ?? ctx.row('chat', chatKey)?._last_message_id);
}

/** The message a reply names in this chat, or the server's refusal; `allow` sends without it when it is gone. */
export function replyTarget(ctx: HandlerContext, chat: Row, botId: number): { key?: string } | { refusal: Response } {
  const params = jsonParam(ctx, 'reply_parameters');
  // source: https://raw.githubusercontent.com/tdlib/telegram-bot-api/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp "Can't parse reply parameters JSON object"
  if (params.error) return { refusal: refuse(ctx, 400, "Bad Request: can't parse reply parameters JSON object") };
  const given = params.value as Row | undefined;
  // source: https://raw.githubusercontent.com/tdlib/telegram-bot-api/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp "result.reply_to_message_id = get_message_id(query,"
  const messageId = given ? Number(given.message_id ?? 0) : intParam(ctx, 'reply_to_message_id') ?? 0;
  const allow = given ? given.allow_sending_without_reply === true : ctx.flag(param(ctx, 'allow_sending_without_reply')) === true;
  if (!(messageId > 0)) return {};
  const key = `${chat.id}:${messageId}`;
  const target = ctx.row('message', key);
  const visible = target && target.deleted !== true && (chat.type !== 'private' || Number(target._with) === botId);
  if (visible) return { key };
  if (allow) return {};
  // source: https://raw.githubusercontent.com/tdlib/telegram-bot-api/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp "message to be replied not found"
  return { refusal: refuse(ctx, 400, 'Bad Request: message to be replied not found') };
}

/** A bot's message stored in a chat (it writes no update for its sender: a bot is not sent its own messages), and
 *  the bot kept as the last that wrote in a group (privacy mode reads it). */
export async function storeBotMessage(ctx: HandlerContext, botId: number, chat: Row, fields: Row, replyKey: string | undefined, operation: string): Promise<Row> {
  const chatKey = String(chat.id);
  const messageId = await nextMessageId(ctx, chatKey, operation);
  const key = `${chatKey}:${messageId}`;
  const channel = chat.type === 'channel';
  // a channel's post names the channel as its sender, not the bot
  // source: https://core.telegram.org/bots/api#message "Optional. Sender of the message; may be empty for messages sent to channels."
  await ctx.write('message', key, {
    message_id: messageId,
    date: unixOf(ctx.occurredAt),
    ...fields,
    _chat: chat.id,
    ...(channel ? { _sender_chat: chat.id } : { _from: botId }),
    _sent_by: botId,
    ...(chat.type === 'private' ? { _with: botId } : {}),
    ...(replyKey ? { _reply_to: replyKey } : {}),
  }, operation);
  if (chat.type === 'group' || chat.type === 'supergroup') await ctx.write('chat', chatKey, { _last_bot: botId }, operation);
  return ctx.row('message', key)!;
}

export const unixOf = (iso: string): number => Math.floor(Date.parse(iso) / 1000);

// ── files ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** A file kept: its bytes as a blob, its row naming them; a file_id that leads with the kind of file it is. */
export async function storeFile(ctx: HandlerContext, bytes: Uint8Array, meta: { kind: string; mime?: string; name?: string; bot?: number }, operation: string): Promise<Row> {
  const prefix: Record<string, string> = { photos: 'AgACAgIAAxkBAA', videos: 'BAACAgIAAxkBAA', documents: 'BQACAgIAAxkBAA', profile_photos: 'AQADAgAT' };
  const row = await ctx.create('file', (id) => ({
    file_id: `${prefix[meta.kind] ?? 'BQACAgIAAxkBAA'}${id.slice(4)}`,
    file_unique_id: id,
    file_size: bytes.byteLength,
    _blob: `file:${id}`,
    _kind: meta.kind,
    ...(meta.mime ? { _mime: meta.mime } : {}),
    ...(meta.name ? { _name: meta.name } : {}),
    ...(meta.bot !== undefined ? { _bot: meta.bot } : {}),
  }), operation);
  const id = String((row as Row).file_unique_id);
  await ctx.blobs.put(`file:${id}`, bytes);
  // the row as kept, its own `_` fields with it (the create answers the vendor's view)
  return ctx.row('file', id)!;
}

/** The smaller sizes Telegram makes of an uploaded photo, smallest first: each size type whose box is smaller than the
 *  photo's longer side, the photo scaled to fit it (the rounding is the twin's). A thumbnail is kept by its ids and
 *  dimensions only: the twin renders no thumbnail's pixels, so its file is a gap. */
// source: https://core.telegram.org/api/files "s - Server-side resized image, bounded by 100x100 pixels."
// source: https://core.telegram.org/api/files "w - Server-side resized image, bounded by 2560x2560 pixels."
// source: https://raw.githubusercontent.com/tdlib/td/42e6a5259551178d1dab54a22ad96d14bd906e20/td/telegram/PhotoSize.cpp "get_photo_sizes_object"
export async function photoThumbnails(ctx: HandlerContext, original: Row, width: number, height: number, operation: string): Promise<Array<{ file_id: unknown; file_unique_id: unknown; width: number; height: number }>> {
  const longer = Math.max(width, height), out: Array<{ file_id: unknown; file_unique_id: unknown; width: number; height: number }> = [];
  // a photo's sizes are made once: the same photo sent again (by its file_id) answers the sizes it already has
  // source: https://core.telegram.org/bots/api#file "Unique identifier for this file, which is supposed to be the same over time and for different bots."
  const made = ctx.rowsRaw('file').filter((r) => r.deleted !== true && r._thumbnail_of === original.file_unique_id && typeof r._width === 'number');
  if (made.length) return made.map((r) => ({ file_id: r.file_id, file_unique_id: r.file_unique_id, width: r._width as number, height: r._height as number })).sort((x, y) => x.width - y.width);
  for (const box of [100, 320, 800, 1280, 2560]) {
    if (box >= longer) break;
    const scale = box / longer, w = Math.max(1, Math.round(width * scale)), h = Math.max(1, Math.round(height * scale));
    const row = await ctx.create('file', (id) => ({ file_id: `AgACAgIAAxkBAA${id.slice(4)}`, file_unique_id: id, _kind: 'photos', _thumbnail_of: original.file_unique_id, _width: w, _height: h, ...(original._bot !== undefined ? { _bot: original._bot } : {}) }), operation);
    out.push({ file_id: (row as Row).file_id, file_unique_id: (row as Row).file_unique_id, width: w, height: h });
  }
  return out;
}

/** A file by its file_id, as one bot holds it: a file a bot uploaded is that bot's alone (a chat's photo is every
 *  bot's that reads the chat). */
// source: https://core.telegram.org/bots/api#sending-files "file_id is unique for each individual bot and can't be transferred from one bot to another."
export function fileById(ctx: HandlerContext, fileId: unknown, botId: number): Row | undefined {
  if (typeof fileId !== 'string' || !fileId) return undefined;
  return ctx.rowsRaw('file').find((r) => r.deleted !== true && r.file_id === fileId && (r._bot === undefined || Number(r._bot) === botId));
}

/** An upload's part as the request carries it: multipart bytes, the name `attach://<name>` points at, a file_id sent
 *  again, or an HTTP URL; or the server's refusal. */
export type Upload = { bytes: Uint8Array; name?: string; mime?: string } | { file: Row };
export function uploadOf(ctx: HandlerContext, value: unknown, botId: number): Upload | { refusal: Response } {
  const part = (v: unknown): { bytes: Uint8Array; name?: string; mime?: string } | undefined => {
    const p = v as { name?: string; type?: string; bytes?: Uint8Array } | undefined;
    return p && typeof p === 'object' && p.bytes instanceof Uint8Array ? { bytes: p.bytes, ...(p.name ? { name: p.name } : {}), ...(p.type ? { mime: p.type } : {}) } : undefined;
  };
  const direct = part(value);
  if (direct) return direct;
  const text = typeof value === 'string' ? value : '';
  const attached = text.startsWith('attach://') ? part(ctx.params[text.slice(9)]) : undefined;
  if (attached) return attached;
  if (/^https?:\/\//i.test(text)) return urlUnreachable(ctx);
  const file = fileById(ctx, text, botId);
  if (file) return { file };
  // source: https://raw.githubusercontent.com/tdlib/td/42e6a5259551178d1dab54a22ad96d14bd906e20/td/telegram/MessagesManager.cpp "Wrong file identifier/HTTP URL specified"
  return { refusal: refuse(ctx, 400, 'Bad Request: wrong file identifier/HTTP URL specified') };
}

/** A medium sent by an HTTP URL, which Telegram downloads: a World lets the twin reach nothing outside it, so it answers
 *  as Telegram does for a URL it could not get. */
function urlUnreachable(ctx: HandlerContext): { refusal: Response } {
  // source: https://raw.githubusercontent.com/tdlib/telegram-bot-api/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp "Failed to get HTTP URL content"
  return { refusal: refuse(ctx, 400, 'Bad Request: failed to get HTTP URL content') };
}

/** A file's bytes. */
export async function fileBytes(ctx: HandlerContext, file: Row): Promise<Uint8Array> {
  return (await ctx.blobs.get(String(file._blob))) ?? new Uint8Array();
}

// ── updates ─────────────────────────────────────────────────────────────────────────────────────────────────────

// source: https://core.telegram.org/bots/api#getupdates "Specify an empty list to receive all update types except chat_member, message_reaction, and message_reaction_count (default)."
const NOT_BY_DEFAULT = ['chat_member', 'message_reaction', 'message_reaction_count'];

/** An update put in a bot's queue, when the allowed_updates the bot last asked for take its type: a setting does not
 *  reach the updates made before it, so a type is decided when its update is made. */
// source: https://core.telegram.org/bots/api#getupdates "Please note that this parameter doesn't affect updates created before the call to getUpdates, so unwanted updates may be received for a short period of time."
export async function queueUpdate(ctx: HandlerContext, botId: unknown, type: string, payload: Row, operation: string): Promise<void> {
  const bot = ctx.row('_bot', String(botId));
  if (!bot) return;
  const allowed = Array.isArray(bot.allowed_updates) && bot.allowed_updates.length ? (bot.allowed_updates as string[]) : undefined;
  if (allowed ? !allowed.includes(type) : NOT_BY_DEFAULT.includes(type)) return;
  // source: https://core.telegram.org/bots/api#update "Update identifiers start from a certain positive number and increase sequentially."
  const next = await ctx.change('_bot', String(botId), (current) => ({ update_seq: Number(current.update_seq ?? 0) + 1 }), operation);
  const updateId = Number((next as Row | undefined)?.update_seq ?? ctx.row('_bot', String(botId))?.update_seq);
  await ctx.write('update', `${botId}:${updateId}`, { update_id: updateId, [type]: payload, _bot: Number(botId), _type: type, _made: ctx.occurredAt }, operation);
}

/** The bots a person's message in a chat reaches, as privacy mode lets each: in a private chat its bot; in a channel
 *  every bot member; in a group an administrator bot every message, any other the service messages, the commands
 *  meant for it and the replies to it. */
export function recipientsOf(ctx: HandlerContext, chat: Row, message: Row): number[] {
  if (chat.type === 'private') return message._with !== undefined ? [Number(message._with)] : [];
  const bots = ctx.rowsRaw('chat_member').filter((m) => m.deleted !== true && Number(m._chat) === Number(chat.id) && ['creator', 'administrator', 'member'].includes(String(m.status)) && ctx.row('user', String(m._user))?.is_bot === true);
  // source: https://core.telegram.org/bots/features#privacy-mode "All messages from channels where they are a member."
  if (chat.type === 'channel') return bots.map((m) => Number(m._user));
  const text = typeof message.text === 'string' ? message.text : typeof message.caption === 'string' ? message.caption : '';
  const entities = ((message.entities ?? message.caption_entities ?? []) as Entity[]);
  const service = Array.isArray(message._new_members) || message.group_chat_created === true || message.left_chat_member !== undefined;
  return bots.filter((m) => {
    const bot = ctx.row('user', String(m._user))!;
    const username = String(bot.username ?? '').toLowerCase();
    // source: https://core.telegram.org/bots/features#privacy-mode "Privacy mode is enabled by default for all bots, except bots that were added to a group as admins (bot admins always receive all messages )."
    if (m.status === 'administrator' || bot.can_read_all_group_messages === true) return true;
    // source: https://core.telegram.org/bots/features#privacy-mode "All service messages."
    if (service) return true;
    const pieces = entities.map((e) => ({ type: e.type, text: text.slice(e.offset, e.offset + e.length).toLowerCase() }));
    // source: https://core.telegram.org/bots/features#privacy-mode "Commands explicitly meant for them (e.g., /command@this_bot )."
    if (pieces.some((p) => p.type === 'bot_command' && p.text.endsWith(`@${username}`))) return true;
    // source: https://core.telegram.org/bots/features#privacy-mode "General commands (e.g. /start ) if the bot was the last bot to send a message to the group."
    if (pieces.some((p) => p.type === 'bot_command' && !p.text.includes('@')) && Number(chat._last_bot) === Number(m._user)) return true;
    // source: https://core.telegram.org/bots/features#privacy-mode "Replies to any messages implicitly or explicitly meant for this bot."
    if (typeof message._reply_to === 'string' && Number(ctx.row('message', message._reply_to)?._sent_by) === Number(m._user)) return true;
    // a plain @mention is on neither list: a bot in privacy mode is not sent it
    return false;
  }).map((m) => Number(m._user));
}
