// Available methods (https://core.telegram.org/bots/api#available-methods) the demand reaches: the bot itself, text and
// media sent to a chat, the typing indicator, a chat, a member and a file read, and a file's download.
import type { HandlerContext } from '@volter/world-core';
import { imageSize, mp4Info } from '../engine/media.ts';
import {
  answer, botOf, chatFor, chatFullView, fileBytes, fileById, formatted, jsonParam, memberKey, memberView, messageView, param,
  refuse, replyTarget, storeBotMessage, storeFile, photoThumbnails, textFields, uploadOf, type Row, type Upload,
} from './shared.ts';

// source: https://core.telegram.org/bots/api#sendmessage "Text of the message to be sent, 1-4096 characters after entities parsing"
const TEXT_MAX = 4096;
// source: https://core.telegram.org/bots/api#sendphoto "Photo caption (may also be used when resending photos by file_id), 0-1024 characters after entities parsing"
const CAPTION_MAX = 1024;
const characters = (s: string): number => [...s].length;

export async function getMe(ctx: HandlerContext): Promise<Response> {
  const { user } = botOf(ctx);
  // the bot's User with the fields getMe alone returns
  // source: https://core.telegram.org/bots/api#getme "Returns basic information about the bot in form of a User object."
  return answer(Object.fromEntries(Object.entries(ctx.own(user)).filter(([k]) => !k.startsWith('_') && k !== 'deleted')));
}

export async function sendMessage(ctx: HandlerContext): Promise<Response> {
  const { id: botId } = botOf(ctx);
  const access = chatFor(ctx, botId, param(ctx, 'chat_id'), 'write');
  if ('refusal' in access) return access.refusal;
  const raw = param(ctx, 'text');
  // source: https://raw.githubusercontent.com/tdlib/telegram-bot-api/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp "Message text is empty"
  if (raw === undefined || String(raw) === '') return refuse(ctx, 400, 'Bad Request: message text is empty');
  const entities = jsonParam(ctx, 'entities');
  const text = formatted(ctx, String(raw), param(ctx, 'parse_mode'), entities.value);
  if ('refusal' in text) return text.refusal;
  // source: https://raw.githubusercontent.com/tdlib/td/42e6a5259551178d1dab54a22ad96d14bd906e20/td/telegram/MessageEntity.cpp "Text must be non-empty"
  if (text.text === '') return refuse(ctx, 400, 'Bad Request: text must be non-empty');
  // source: https://raw.githubusercontent.com/tdlib/td/42e6a5259551178d1dab54a22ad96d14bd906e20/td/telegram/MessagesManager.cpp "Message is too long"
  if (characters(text.text) > TEXT_MAX) return refuse(ctx, 400, 'Bad Request: message is too long');
  const reply = replyTarget(ctx, access.chat, botId);
  if ('refusal' in reply) return reply.refusal;
  const row = await storeBotMessage(ctx, botId, access.chat, textFields(text, 'text'), reply.key, ctx.call.operation.id);
  return answer(messageView(ctx, row));
}

/** A caption checked as the server checks it: parsed, then at most 1024 characters. */
function captionOf(ctx: HandlerContext, caption: unknown, parseMode: unknown, entities: unknown): Row | { refusal: Response } {
  if (caption === undefined || caption === null || String(caption) === '') return {};
  const text = formatted(ctx, String(caption), parseMode, entities);
  if ('refusal' in text) return text;
  // source: https://raw.githubusercontent.com/tdlib/td/42e6a5259551178d1dab54a22ad96d14bd906e20/td/telegram/MessagesManager.cpp "Message caption is too long"
  if (characters(text.text) > CAPTION_MAX) return { refusal: refuse(ctx, 400, 'Bad Request: message caption is too long') };
  return textFields(text, 'caption');
}

/** A medium's fields on its message, from an upload or a file sent again: a photo's one size, a video's size and
 *  length, a document's name and type. */
async function mediaFields(ctx: HandlerContext, botId: number, kind: 'photo' | 'video' | 'document', upload: Upload, given: { width?: unknown; height?: unknown; duration?: unknown }): Promise<Row | { refusal: Response }> {
  const operation = ctx.call.operation.id;
  let file: Row;
  let bytes: Uint8Array;
  if ('file' in upload) {
    // a file sent again keeps its type: a photo is not sent as a document, nor a video as a photo
    // source: https://core.telegram.org/bots/api#sending-files "It is not possible to change the file type when resending by file_id ."
    // source: https://raw.githubusercontent.com/tdlib/td/42e6a5259551178d1dab54a22ad96d14bd906e20/td/telegram/files/FileManager.cpp "Can't use file of type"
    const types: Record<string, string> = { photos: 'Photo', videos: 'Video', documents: 'Document', profile_photos: 'ProfilePhoto' };
    const real = types[String(upload.file._kind)] ?? 'Document';
    const wanted = kind === 'photo' ? 'Photo' : kind === 'video' ? 'Video' : 'Document';
    if (real !== wanted) return { refusal: refuse(ctx, 400, `Bad Request: can't use file of type ${real} as ${wanted}`) };
    file = upload.file;
    bytes = await fileBytes(ctx, file);
  }
  else {
    bytes = upload.bytes;
    // source: https://core.telegram.org/bots/api#sendphoto "The photo must be at most 10 MB in size."
    // source: https://core.telegram.org/bots/api#sendvideo "Bots can currently send video files of up to 50 MB in size, this limit may be changed in the future."
    // source: https://core.telegram.org/bots/api#senddocument "Bots can currently send files of any type of up to 50 MB in size, this limit may be changed in the future."
    // Where the documentation stops: the words for a file over its limit are the server's for a file too big
    // source: https://raw.githubusercontent.com/tdlib/telegram-bot-api/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp "Bad Request: file is too big"
    if (bytes.byteLength > (kind === 'photo' ? 10 : 50) * 1024 * 1024) return { refusal: refuse(ctx, 400, 'Bad Request: file is too big') };
    if (kind === 'photo' && !imageSize(bytes)) {
      // an upload that is no image Telegram can read: Telegram's own error for it, which the server relays as it is (its
      // second character an underscore or a capital)
      // source: https://core.telegram.org/method/messages.sendMedia "Failure while processing image."
      // source: https://raw.githubusercontent.com/tdlib/telegram-bot-api/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp "(error_message[1] == '_' || ('A' <= error_message[1] && error_message[1] <= 'Z'))) {"
      return { refusal: refuse(ctx, 400, 'Bad Request: IMAGE_PROCESS_FAILED') };
    }
    const size = kind === 'photo' ? imageSize(bytes)! : undefined;
    // source: https://core.telegram.org/bots/api#sendphoto "The photo's width and height must not exceed 10000 in total. Width and height ratio must be at most 20."
    // (Telegram's own error for it, relayed as it is: an MTProto error's second character is a capital)
    if (size && (size.width + size.height > 10000 || Math.max(size.width, size.height) > 20 * Math.max(1, Math.min(size.width, size.height)))) return { refusal: refuse(ctx, 400, 'Bad Request: PHOTO_INVALID_DIMENSIONS') };
    file = await storeFile(ctx, bytes, { kind: kind === 'photo' ? 'photos' : kind === 'video' ? 'videos' : 'documents', bot: botId, ...(upload.mime ? { mime: upload.mime } : {}), ...(upload.name ? { name: upload.name } : {}) }, operation);
  }
  const ids = { file_id: file.file_id, file_unique_id: file.file_unique_id };
  if (kind === 'photo') {
    const size = imageSize(bytes) ?? { width: 0, height: 0 };
    // its smaller sizes first, then the photo as it was given
    // source: https://core.telegram.org/bots/api#message "Optional. Message is a photo, available sizes of the photo"
    const thumbnails = await photoThumbnails(ctx, file, size.width, size.height, operation);
    return { photo: [...thumbnails, { ...ids, file_size: bytes.byteLength, width: size.width, height: size.height }] };
  }
  const name = typeof file._name === 'string' ? file._name : undefined;
  const mime = typeof file._mime === 'string' ? file._mime : undefined;
  if (kind === 'video') {
    const info = mp4Info(bytes);
    // the request's own width, height and duration, else the file's
    // source: https://core.telegram.org/bots/api#sendvideo "Duration of sent video in seconds"
    const num = (v: unknown, fallback: number): number => (typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : fallback);
    return { video: { ...ids, width: num(given.width, info?.width ?? 0), height: num(given.height, info?.height ?? 0), duration: num(given.duration, info?.duration ?? 0), ...(name ? { file_name: name } : {}), ...(mime ? { mime_type: mime } : {}), file_size: bytes.byteLength } };
  }
  return { document: { ...ids, ...(name ? { file_name: name } : {}), ...(mime ? { mime_type: mime } : {}), file_size: bytes.byteLength } };
}

/** One medium sent to a chat with its caption. */
async function sendMedium(ctx: HandlerContext, kind: 'photo' | 'video' | 'document'): Promise<Response> {
  const { id: botId } = botOf(ctx);
  const access = chatFor(ctx, botId, param(ctx, 'chat_id'), 'write');
  if ('refusal' in access) return access.refusal;
  const upload = uploadOf(ctx, ctx.params[kind], botId);
  if ('refusal' in upload) return upload.refusal;
  const caption = captionOf(ctx, param(ctx, 'caption'), param(ctx, 'parse_mode'), jsonParam(ctx, 'caption_entities').value);
  if ('refusal' in caption) return caption.refusal as Response;
  const reply = replyTarget(ctx, access.chat, botId);
  if ('refusal' in reply) return reply.refusal;
  const media = await mediaFields(ctx, botId, kind, upload, { width: param(ctx, 'width'), height: param(ctx, 'height'), duration: param(ctx, 'duration') });
  if ('refusal' in media) return media.refusal as Response;
  const row = await storeBotMessage(ctx, botId, access.chat, { ...media, ...caption }, reply.key, ctx.call.operation.id);
  return answer(messageView(ctx, row));
}

// source: https://core.telegram.org/bots/api#sendphoto "Use this method to send photos. On success, the sent Message is returned."
export async function sendPhoto(ctx: HandlerContext): Promise<Response> {
  return sendMedium(ctx, 'photo');
}

// source: https://core.telegram.org/bots/api#sendvideo "Use this method to send video files, Telegram clients support MPEG4 videos (other formats may be sent as Document)."
export async function sendVideo(ctx: HandlerContext): Promise<Response> {
  return sendMedium(ctx, 'video');
}

// source: https://core.telegram.org/bots/api#senddocument "Use this method to send general files. On success, the sent Message is returned."
export async function sendDocument(ctx: HandlerContext): Promise<Response> {
  return sendMedium(ctx, 'document');
}

// source: https://core.telegram.org/bots/api#sendmediagroup "On success, an Array of Message objects that were sent is returned."
export async function sendMediaGroup(ctx: HandlerContext): Promise<Response> {
  const { id: botId } = botOf(ctx);
  const access = chatFor(ctx, botId, param(ctx, 'chat_id'), 'write');
  if ('refusal' in access) return access.refusal;
  const media = jsonParam(ctx, 'media');
  // source: https://raw.githubusercontent.com/tdlib/telegram-bot-api/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp "Can't parse media JSON object"
  if (media.error || (media.value !== undefined && !Array.isArray(media.value))) return refuse(ctx, 400, "Bad Request: can't parse media JSON object");
  const items = (media.value ?? []) as Row[];
  // source: https://raw.githubusercontent.com/tdlib/td/42e6a5259551178d1dab54a22ad96d14bd906e20/td/telegram/MessageContent.cpp "There are no messages to send"
  if (!items.length) return refuse(ctx, 400, 'Bad Request: there are no messages to send');
  // source: https://raw.githubusercontent.com/tdlib/td/42e6a5259551178d1dab54a22ad96d14bd906e20/td/telegram/MessageContent.cpp "Too many messages to send as an album"
  if (items.length > 10) return refuse(ctx, 400, 'Bad Request: too many messages to send as an album');
  const kinds = items.map((i) => String(i?.type ?? ''));
  for (const k of kinds) {
    // source: https://raw.githubusercontent.com/tdlib/td/42e6a5259551178d1dab54a22ad96d14bd906e20/td/telegram/MessageContent.cpp "Invalid message content type"
    if (!['photo', 'video', 'document'].includes(k)) return refuse(ctx, 400, `Bad Request: can't parse InputMedia: ${k ? 'unsupported media type' : 'media type is not specified'}`);
  }
  // source: https://core.telegram.org/bots/api#sendmediagroup "Documents and audio files can be only grouped in an album with messages of the same type."
  // source: https://raw.githubusercontent.com/tdlib/td/42e6a5259551178d1dab54a22ad96d14bd906e20/td/telegram/MessageContent.cpp "can't be mixed with other media types"
  if (kinds.includes('document') && kinds.some((k) => k !== 'document')) return refuse(ctx, 400, "Bad Request: document can't be mixed with other media types");
  const reply = replyTarget(ctx, access.chat, botId);
  if ('refusal' in reply) return reply.refusal;
  // every part checked before any is sent
  const prepared: Array<{ kind: 'photo' | 'video' | 'document'; upload: Upload; caption: Row; item: Row }> = [];
  for (const item of items) {
    const upload = uploadOf(ctx, item.media, botId);
    if ('refusal' in upload) return upload.refusal;
    const caption = captionOf(ctx, item.caption, item.parse_mode, item.caption_entities);
    if ('refusal' in caption) return caption.refusal as Response;
    prepared.push({ kind: item.type as 'photo' | 'video' | 'document', upload, caption, item });
  }
  // the album's one media_group_id, the World's for it
  // source: https://core.telegram.org/bots/api#message "Optional. The unique identifier inside this chat of a media message group this message belongs to"
  const group = await ctx.issue('_media_group');
  const sent: Row[] = [];
  for (const p of prepared) {
    const fields = await mediaFields(ctx, botId, p.kind, p.upload, { width: p.item.width, height: p.item.height, duration: p.item.duration });
    if ('refusal' in fields) return fields.refusal as Response;
    const row = await storeBotMessage(ctx, botId, access.chat, { media_group_id: group, ...fields, ...p.caption }, reply.key, ctx.call.operation.id);
    sent.push(messageView(ctx, row));
  }
  return answer(sent);
}

// source: https://core.telegram.org/bots/api#sendchataction "Use this method when you need to tell the user that something is happening on the bot's side."
export async function sendChatAction(ctx: HandlerContext): Promise<Response> {
  const { id: botId } = botOf(ctx);
  const access = chatFor(ctx, botId, param(ctx, 'chat_id'), 'write');
  if ('refusal' in access) return access.refusal;
  const action = String(param(ctx, 'action') ?? '').toLowerCase();
  // source: https://raw.githubusercontent.com/tdlib/telegram-bot-api/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp "Wrong parameter action in request"
  if (!['cancel', 'typing', 'record_video', 'upload_video', 'record_audio', 'record_voice', 'upload_audio', 'upload_voice', 'upload_photo', 'upload_document', 'choose_sticker', 'pick_up_location', 'find_location', 'record_video_note', 'upload_video_note'].includes(action)) {
    return refuse(ctx, 400, 'Bad Request: wrong parameter action in request');
  }
  // the status shows for five seconds in the person's app; nothing is stored
  // source: https://core.telegram.org/bots/api#sendchataction "The status is set for 5 seconds or less (when a message arrives from your bot, Telegram clients clear its typing status). Returns True on success."
  return answer(true);
}

// source: https://core.telegram.org/bots/api#getchat "Use this method to get up-to-date information about the chat. Returns a ChatFullInfo object on success."
export async function getChat(ctx: HandlerContext): Promise<Response> {
  const { id: botId } = botOf(ctx);
  const access = chatFor(ctx, botId, param(ctx, 'chat_id'), 'read');
  if ('refusal' in access) return access.refusal;
  return answer(chatFullView(ctx, access.chat));
}

// source: https://core.telegram.org/bots/api#getchatmember "Use this method to get information about a member of a chat."
export async function getChatMember(ctx: HandlerContext): Promise<Response> {
  const { id: botId } = botOf(ctx);
  const access = chatFor(ctx, botId, param(ctx, 'chat_id'), 'read');
  if ('refusal' in access) return access.refusal;
  const userId = param(ctx, 'user_id');
  const user = typeof userId === 'number' ? userId : typeof userId === 'string' && /^\d+$/.test(userId) ? Number(userId) : undefined;
  // source: https://raw.githubusercontent.com/tdlib/telegram-bot-api/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp "user not found"
  if (user === undefined || !ctx.row('user', String(user))) return refuse(ctx, 400, 'Bad Request: user not found');
  const member = ctx.row('chat_member', memberKey(access.chat.id, user));
  return answer(memberView(ctx, member, user));
}

// source: https://core.telegram.org/bots/api#getfile "Use this method to get basic information about a file and prepare it for downloading. For the moment, bots can download files of up to 20MB in size."
export async function getFile(ctx: HandlerContext): Promise<Response> {
  const { id: botId } = botOf(ctx);
  const file = fileById(ctx, param(ctx, 'file_id'), botId);
  // source: https://raw.githubusercontent.com/tdlib/telegram-bot-api/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp "invalid file_id"
  if (!file) return refuse(ctx, 400, 'Bad Request: invalid file_id');
  // a thumbnail's pixels are not rendered by the twin
  if (file._thumbnail_of !== undefined) return ctx.gap();
  // source: https://raw.githubusercontent.com/tdlib/telegram-bot-api/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp "Bad Request: file is too big"
  if (Number(file.file_size ?? 0) > 20 * 1024 * 1024) return refuse(ctx, 400, 'Bad Request: file is too big');
  let path = typeof file.file_path === 'string' ? file.file_path : undefined;
  if (!path) {
    // the path a file is downloaded by: its kind's folder and a name the server gives it
    // source: https://core.telegram.org/bots/api#file "Optional. File path. Use https://api.telegram.org/file/bot<token>/<file_path> to get the file."
    const name = await ctx.issue('_file_path');
    const ext = typeof file._name === 'string' && file._name.includes('.') ? file._name.slice(file._name.lastIndexOf('.')) : file._kind === 'videos' ? '.mp4' : file._kind === 'documents' ? '' : '.jpg';
    path = `${String(file._kind ?? 'documents')}/${name}${ext}`;
    await ctx.write('file', String(file.id), { file_path: path }, ctx.call.operation.id);
  }
  return answer({ file_id: file.file_id, file_unique_id: file.file_unique_id, file_size: file.file_size, file_path: path });
}

// source: https://core.telegram.org/bots/api#getfile "The file can then be downloaded via the link https://api.telegram.org/file/bot<token>/<file_path> , where <file_path> is taken from the response."
export async function downloadFile(ctx: HandlerContext): Promise<Response> {
  botOf(ctx);
  const path = String(ctx.call.params.file_path ?? '');
  const file = ctx.rowsRaw('file').find((r) => r.deleted !== true && r.file_path === path);
  // source: https://raw.githubusercontent.com/tdlib/telegram-bot-api/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/HttpConnection.cpp "return send_http_error(404,"
  if (!file) return refuse(ctx, 404, 'Not Found');
  const bytes = await fileBytes(ctx, file);
  return ctx.raw(bytes.slice(), { status: 200, headers: { 'content-type': String(file._mime ?? 'application/octet-stream'), 'content-length': String(bytes.byteLength) } });
}
