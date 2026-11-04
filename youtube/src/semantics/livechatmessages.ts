// The liveChatMessages family: a broadcast's live chat, read by polling (liveChatMessages.list, with its page token and
// polling interval), written to (liveChatMessages.insert) and moderated (liveChatMessages.delete).
import type { HandlerContext } from '@volter/world-core';
import { CHAT_MESSAGE, answerOf, bodyObject, callerChannel, chatById, chatEnded, live, obj, offsetOf, pageToken, partsOf, postChatMessage, query, refuse, etagOf, type Row } from './shared.ts';

const DOMAIN = 'youtube.liveChat';
// Where the documentation stops: the page says a client waits pollingIntervalMillis before polling again and gives no
// figure; the twin answers 5 seconds.
const POLLING_MS = 5000;

// source: https://developers.google.com/youtube/v3/live/docs/liveChatMessages/list "Lists live chat messages for a specific chat."
export async function youtube_liveChatMessages_list(ctx: HandlerContext): Promise<Response> {
  const who = callerChannel(ctx);
  if (who instanceof Response) return who;
  const parts = partsOf(ctx);
  const liveChatId = query(ctx, 'liveChatId') ?? '';
  const held = liveChatId ? chatById(ctx, liveChatId) : undefined;
  // source: https://developers.google.com/youtube/v3/live/docs/liveChatMessages/list "The live chat that you are trying to retrieve cannot be found. Check the value of the request's liveChatId parameter to ensure that it is correct."
  if (!held || !held.broadcast) return refuse(ctx, 404, DOMAIN, 'liveChatNotFound', "The live chat that you are trying to retrieve cannot be found. Check the value of the request's liveChatId parameter to ensure that it is correct.");
  const b = ctx.own(held.broadcast);
  // a private broadcast's chat is its owner's
  // source: https://developers.google.com/youtube/v3/live/docs/liveChatMessages/list "You don't have the permissions required to retrieve messages for the specified live chat."
  if (obj(b.status).privacyStatus === 'private' && held.broadcast._sub !== who.caller.sub) return refuse(ctx, 403, DOMAIN, 'forbidden', "You don't have the permissions required to retrieve messages for the specified live chat.");
  const raw = query(ctx, 'maxResults');
  // source: https://developers.google.com/youtube/v3/live/docs/liveChatMessages/list "Acceptable values are 200 to 2000 , inclusive. The default value is 500 ."
  const size = raw === undefined ? 500 : Number(raw);
  if (!Number.isInteger(size) || size < 200 || size > 2000) return refuse(ctx, 400, 'youtube.parameter', 'invalidParameter', `Invalid value '${raw}'. Values must be within the range: [200, 2000]`);
  const token = query(ctx, 'pageToken');
  const at = offsetOf(token);
  // source: https://developers.google.com/youtube/v3/docs/errors "The request specifies an invalid page token."
  if (at === undefined) return refuse(ctx, 400, 'youtube.parameter', 'invalidPageToken', 'The request specifies an invalid page token.');
  const all = ctx.rowsRaw(CHAT_MESSAGE).filter((m) => m.deleted !== true && m._liveChat === liveChatId);
  const ended = chatEnded(ctx, held.broadcast);
  // source: https://developers.google.com/youtube/v3/live/docs/liveChatMessages/list "The specified live chat is no longer live."
  // a client that has read the chat's end and polls again finds the chat over
  if (ended && token !== undefined && at >= all.length) return refuse(ctx, 403, DOMAIN, 'liveChatEnded', 'The specified live chat is no longer live.');
  // source: https://developers.google.com/youtube/v3/live/docs/liveChatMessages/list "The initial request made without a continuation token will only contain the most recent messages."
  const start = token === undefined ? Math.max(0, all.length - size) : at;
  const items = all.slice(start, start + size).map((m) => answerOf(ctx, m, parts));
  const next = start + items.length;
  const body: Row = {
    kind: 'youtube#liveChatMessageListResponse', etag: etagOf(ctx, items),
    // source: https://developers.google.com/youtube/v3/live/docs/liveChatMessages/list "The token that can be used as the value of the pageToken parameter to retrieve the next page in the result set."
    nextPageToken: pageToken(next),
    // source: https://developers.google.com/youtube/v3/live/docs/liveChatMessages/list "The amount of time, in milliseconds, that the client should wait before polling again for new live chat messages."
    pollingIntervalMillis: POLLING_MS,
    // source: https://developers.google.com/youtube/v3/live/docs/liveChatMessages/list "This property is only present if the stream is already offline."
    ...(ended && typeof obj(b.snippet).actualEndTime === 'string' ? { offlineAt: obj(b.snippet).actualEndTime } : {}),
    pageInfo: { totalResults: all.length, resultsPerPage: items.length },
    items,
  };
  return Response.json(body);
}

// source: https://developers.google.com/youtube/v3/live/docs/liveChatMessages/insert "Adds a message or a poll to a live chat."
export async function youtube_liveChatMessages_insert(ctx: HandlerContext): Promise<Response> {
  const who = callerChannel(ctx);
  if (who instanceof Response) return who;
  const parts = partsOf(ctx);
  const snippet = obj(bodyObject(ctx).snippet);
  // source: https://developers.google.com/youtube/v3/live/docs/liveChatMessages/insert "The liveChatMessage resource must include and specify a value for the snippet.liveChatId property."
  if (typeof snippet.liveChatId !== 'string' || !snippet.liveChatId) return refuse(ctx, 400, DOMAIN, 'liveChatIdRequired', 'The liveChatMessage resource must include and specify a value for the snippet.liveChatId property.');
  // source: https://developers.google.com/youtube/v3/live/docs/liveChatMessages/insert "The liveChatMessage resource must include and specify a value for the snippet.type property."
  if (typeof snippet.type !== 'string' || !snippet.type) return refuse(ctx, 400, DOMAIN, 'typeRequired', 'The liveChatMessage resource must include and specify a value for the snippet.type property.');
  // pollEvent is the manifest's variant; the text message is the one served
  const text = obj(snippet.textMessageDetails).messageText;
  // source: https://developers.google.com/youtube/v3/live/docs/liveChatMessages/insert "The liveChatMessage resource must include and specify a value for the snippet.textMessageDetails.messageText property."
  if (text === undefined || text === '') return refuse(ctx, 400, DOMAIN, 'messageTextRequired', 'The liveChatMessage resource must include and specify a value for the snippet.textMessageDetails.messageText property.');
  // source: https://developers.google.com/youtube/v3/live/docs/liveChatMessages/insert "The message text ( snippet.textMessageDetails.messageText ) is not valid."
  if (snippet.type !== 'textMessageEvent' || typeof text !== 'string' || !text.trim()) return refuse(ctx, 400, DOMAIN, 'messageTextInvalid', 'The message text (snippet.textMessageDetails.messageText) is not valid.');
  const held = chatById(ctx, snippet.liveChatId);
  // source: https://developers.google.com/youtube/v3/live/docs/liveChatMessages/insert "The live chat identified in the API request does not exist. This error occurs if the chat has been deleted by the owner."
  if (!held || !held.broadcast) return refuse(ctx, 404, DOMAIN, 'liveChatNotFound', 'The live chat identified in the API request does not exist. This error occurs if the chat has been deleted by the owner.');
  // source: https://developers.google.com/youtube/v3/live/docs/liveChatMessages/insert "The specified live chat is no longer live."
  if (chatEnded(ctx, held.broadcast)) return refuse(ctx, 403, DOMAIN, 'liveChatEnded', 'The specified live chat is no longer live.');
  // source: https://developers.google.com/youtube/v3/live/docs/liveChatMessages/insert "You don't have the permissions required to create the specified message."
  if (obj(ctx.own(held.broadcast).status).privacyStatus === 'private' && held.broadcast._sub !== who.caller.sub) return refuse(ctx, 403, DOMAIN, 'forbidden', "You don't have the permissions required to create the specified message.");
  const message = await postChatMessage(ctx, snippet.liveChatId, held.broadcast, who.channel, text, 'youtube.liveChatMessages.insert');
  return Response.json(answerOf(ctx, message, parts));
}

// source: https://developers.google.com/youtube/v3/live/docs/liveChatMessages/delete "Deletes a chat message."
export async function youtube_liveChatMessages_delete(ctx: HandlerContext): Promise<Response> {
  const who = callerChannel(ctx);
  if (who instanceof Response) return who;
  const id = query(ctx, 'id') ?? '';
  const message = id ? live(ctx.row(CHAT_MESSAGE, id)) : undefined;
  // source: https://developers.google.com/youtube/v3/live/docs/liveChatMessages/delete "The message that you are trying to delete cannot be found. Check the value of the id parameter to ensure it is correct."
  if (!message || obj(ctx.own(message).snippet).type !== 'textMessageEvent') return refuse(ctx, 404, DOMAIN, 'liveChatMessageNotFound', 'The message that you are trying to delete cannot be found. Check the value of the id parameter to ensure it is correct.');
  const held = chatById(ctx, String(message._liveChat));
  const owner = held?.broadcast?._sub === who.caller.sub;
  // the chat's owner deletes any message in it; anyone else only their own
  // source: https://developers.google.com/youtube/v3/live/docs/liveChatMessages/delete "You don't have the permissions required to delete the specified message."
  if (!owner && message._author !== String(ctx.own(who.channel).id)) return refuse(ctx, 403, DOMAIN, 'forbidden', "You don't have the permissions required to delete the specified message.");
  await ctx.remove(CHAT_MESSAGE, id, 'youtube.liveChatMessages.delete');
  // source: https://developers.google.com/youtube/v3/live/docs/liveChatMessages/delete "If successful, this method returns an HTTP 204 response code ( No Content )."
  return new Response(null, { status: 204 });
}
