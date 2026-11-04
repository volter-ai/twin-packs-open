// What every family of YouTube shares: its stored shapes, who is calling (a Google OAuth access token and the channel
// of its Google account), the `part` a request asks for, YouTube's list envelope and its errors.
//
// A RESOURCE IS STORED AS YOUTUBE ANSWERS IT: `kind`, `id` (the vendor's own, read through ctx.own) and each part
// (`snippet`, `status`, `statistics`, ...), with the twin's bookkeeping in `_` fields (`_sub`: the Google account that
// owns a channel; `_channel`: the channel a resource belongs to). An answer carries `kind`, `etag`, `id` and the parts
// the request named.
import type { HandlerContext } from '@volter/world-core';

export type Row = Record<string, unknown>;
export type { HandlerContext };

export const CHANNEL = 'Channel';
export const VIDEO = 'Video';
export const BROADCAST = 'LiveBroadcast';
export const STREAM = 'LiveStream';
export const CHAT_MESSAGE = 'LiveChatMessage';
export const THREAD = 'CommentThread';
export const COMMENT = 'Comment';
export const SESSION = '_upload_session';
export const LIVE_CHAT = '_live_chat';
export const COMMENT_BAN = '_comment_ban';
/** A Google Cloud project's API key, as the googleoauth twin keeps it (its contract: `api_key`, by the key's SHA-256). */
export const API_KEY = 'api_key';

/** Google's OAuth tokens, as the googleoauth pack keeps them (its contract: `access_token`, by the token, with
 *  `clientId`, `sub`, `scope`, `expiresAt` and `revoked`). */
export const TOKEN_OWNER = 'googleoauth';
export const TOKEN = 'access_token';

/** YouTube's refusal: Google's error body with the error's domain and reason (manifest `error`). */
export const refuse = (ctx: Pick<HandlerContext, 'refuse'>, status: number, domain: string, reason: string, message: string): Response =>
  ctx.refuse({ status, kind: domain, code: reason, message });

export const live = (r: Row | undefined): Row | undefined => (r && r.deleted !== true ? r : undefined);

/** A stored row as YouTube answers it: its own fields, without the twin's bookkeeping. */
export function vendorView(ctx: Pick<HandlerContext, 'own'>, row: Row): Row {
  const own = ctx.own(row);
  return Object.fromEntries(Object.entries(own).filter(([k]) => !k.startsWith('_')));
}

/** The resource's ETag: a digest of what it holds, so it changes when the resource does. */
export const etagOf = (ctx: Pick<HandlerContext, 'crypto'>, body: unknown): string => ctx.crypto.digest('sha256', JSON.stringify(body), 'base64').replace(/[+/=]/g, '').slice(0, 27);

/** A request's query parameter, as sent (the body's fields are the resource's, never these). */
export const query = (ctx: Pick<HandlerContext, 'call'>, name: string): string | undefined => new URL(ctx.call.request.url).searchParams.get(name) ?? undefined;

/** A comma-separated list parameter (`part`, `id`), however many times it was given. */
export function listParam(ctx: Pick<HandlerContext, 'call'>, name: string): string[] {
  return new URL(ctx.call.request.url).searchParams.getAll(name).flatMap((v) => v.split(',')).map((v) => v.trim()).filter(Boolean);
}

/** The parts a request names (`part`): the resource's properties its answer includes. */
// source: https://developers.google.com/youtube/v3/docs/videos/list "The part parameter specifies a comma-separated list of one or more video resource properties that the API response will include."
export const partsOf = (ctx: Pick<HandlerContext, 'call'>): Set<string> => new Set(listParam(ctx, 'part'));

/** The request's body as a resource's object. */
export const bodyObject = (ctx: Pick<HandlerContext, 'body'>): Row => (ctx.body && typeof ctx.body === 'object' && !Array.isArray(ctx.body) ? ctx.body as Row : {});
export const obj = (v: unknown): Row => (v && typeof v === 'object' && !Array.isArray(v) ? v as Row : {});

/** A resource answered with the parts asked: `kind`, `etag` and `id` always, then each part the request named that the
 *  resource holds. */
// source: https://developers.google.com/youtube/v3/docs/videos/list "If the parameter identifies a property that contains child properties, the child properties will be included in the response."
export function answerOf(ctx: Pick<HandlerContext, 'own' | 'crypto'>, row: Row, parts: Set<string>): Row {
  const v = vendorView(ctx, row);
  const out: Row = { kind: v.kind };
  for (const [k, value] of Object.entries(v)) if (k !== 'kind' && k !== 'id' && parts.has(k)) out[k] = value;
  return { kind: v.kind, etag: etagOf(ctx, out), id: v.id, ...Object.fromEntries(Object.entries(out).filter(([k]) => k !== 'kind')) };
}

/** A page token: the position the next page starts at, opaque to the caller. */
// source: https://developers.google.com/youtube/v3/guides/implementation/pagination "Those properties' values can then be used to set the pageToken parameter to retrieve an additional page of results."
export const pageToken = (offset: number): string => btoa(`CA${offset}QAA`).replace(/=+$/, '');
export function offsetOf(token: string | undefined): number | undefined {
  if (!token) return 0;
  try { const m = /^CA(\d+)QAA$/.exec(atob(token)); return m ? Number(m[1]) : undefined; } catch { return undefined; }
}

/** A list answer, YouTube's envelope: `kind`, `etag`, the page tokens, `pageInfo` and `items`, `extra` merged in. */
export function listAnswer(ctx: Pick<HandlerContext, 'crypto'>, kind: string, all: Row[], offset: number, size: number, extra: Row = {}): Response {
  const items = all.slice(offset, offset + size);
  const body: Row = { kind, etag: '' };
  // a page of no items (maxResults=0, which the methods' ranges allow) names no other page: a token is never the page
  // just served, so a client following nextPageToken always moves on
  if (size > 0 && offset + size < all.length) body.nextPageToken = pageToken(offset + size);
  if (size > 0 && offset > 0) body.prevPageToken = pageToken(Math.max(0, offset - size));
  Object.assign(body, extra, { pageInfo: { totalResults: all.length, resultsPerPage: size }, items });
  body.etag = etagOf(ctx, items);
  return Response.json(body);
}

/** maxResults, within the method's bounds, or the method's refusal. */
export function maxResultsOf(ctx: HandlerContext, fallback: number, min: number, max: number): number | Response {
  const raw = query(ctx, 'maxResults');
  if (raw === undefined) return fallback;
  const n = Number(raw);
  // source: https://developers.google.com/youtube/v3/docs/core_errors "The request failed because it contained an invalid parameter or parameter value."
  if (!Number.isInteger(n) || n < min || n > max) return refuse(ctx, 400, 'youtube.parameter', 'invalidParameter', `Invalid value '${raw}'. Values must be within the range: [${min}, ${max}]`);
  return n;
}

/** The page offset a request's pageToken names, or Google's refusal of a token it never gave. */
export function offsetFor(ctx: HandlerContext): number | Response {
  const at = offsetOf(query(ctx, 'pageToken'));
  // source: https://developers.google.com/youtube/v3/docs/errors "The request specifies an invalid page token."
  return at === undefined ? refuse(ctx, 400, 'youtube.parameter', 'invalidPageToken', 'The request specifies an invalid page token.') : at;
}

// ── who is calling ────────────────────────────────────────────────────────────────────────────────────────────────

export type Caller = { token: string; sub: string; clientId: string; scopes: string[] };

/** The access token a request bears: the Authorization header's Bearer token, else the access_token or oauth_token
 *  query parameter. */
// source: spec:/x-discovery-parameters/access_token/description "OAuth access token."
export function tokenOf(ctx: Pick<HandlerContext, 'call'>): string | undefined {
  const bearer = /^Bearer\s+(\S+)$/i.exec((ctx.call.request.headers.get('authorization') ?? '').trim())?.[1];
  return bearer ?? query(ctx, 'access_token') ?? query(ctx, 'oauth_token');
}

/** Who the request's token names: Google OAuth's access token row, or YouTube's 401 in Google's words. */
export function callerOf(ctx: HandlerContext): Caller | Response {
  const token = tokenOf(ctx);
  // source: https://developers.google.com/youtube/v3/docs/core_errors "The user must be logged in to make this API request. Check the value of the Authorization HTTP request header."
  if (!token) return refuse(ctx, 401, 'global', 'required', 'The user must be logged in to make this API request. Check the value of the Authorization HTTP request header.');
  let row: Row | undefined;
  // a token two of the World's Google OAuth stores hold is no credential (the kernel refuses the read)
  try { row = live(ctx.ownerRow(TOKEN_OWNER, TOKEN, token)); } catch { row = undefined; }
  // source: https://developers.google.com/youtube/v3/docs/core_errors "The authorization credentials provided for the request are invalid. Check the value of the Authorization HTTP request header."
  if (!row || row.revoked === true || typeof row.sub !== 'string') return refuse(ctx, 401, 'global', 'authError', 'The authorization credentials provided for the request are invalid. Check the value of the Authorization HTTP request header.');
  // source: https://developers.google.com/youtube/v3/docs/core_errors "Session Expired. Check the value of the Authorization HTTP request header."
  if (Number(row.expiresAt) <= Math.floor(Date.parse(ctx.occurredAt) / 1000)) return refuse(ctx, 401, 'global', 'expired', 'Session Expired. Check the value of the Authorization HTTP request header.');
  return { token, sub: row.sub, clientId: String(row.clientId ?? ''), scopes: String(row.scope ?? '').split(' ').filter(Boolean) };
}

/** The API key a request bears: the key query parameter, else the X-Goog-Api-Key header. */
// source: spec:/x-discovery-parameters/key/description "API key. Your API key identifies your project and provides you with API access, quota, and reports. Required unless you provide an OAuth 2.0 token."
// source: https://cloud.google.com/docs/authentication/api-keys-use "To include an API key with a REST API call, use the x-goog-api-key HTTP"
export const apiKeyOf = (ctx: Pick<HandlerContext, 'call'>): string | undefined => query(ctx, 'key') ?? ctx.call.request.headers.get('x-goog-api-key') ?? undefined;

/** Whether Google Cloud issued an API key: a project's key, as the googleoauth twin (Google's credentials, the Cloud
 *  console's Credentials page) keeps it by its SHA-256, read across packs as its access tokens are. A key two of the
 *  World's Google stores hold is no credential (the kernel refuses the read). */
export function heldApiKey(ctx: Pick<HandlerContext, 'ownerRow' | 'crypto'>, key: string): boolean {
  try { return !!live(ctx.ownerRow(TOKEN_OWNER, API_KEY, ctx.crypto.digest('sha256', key, 'hex'))); } catch { return false; }
}

/** Whether an operation takes an API key in place of a token: its security names the key as an alternative (the list
 *  methods that read public data, spec/patches.json). */
// source: https://developers.google.com/youtube/v3/getting-started "In some cases, list methods support both authorized and unauthorized requests, where unauthorized requests only retrieve public data while authorized requests can also retrieve information about or private to the currently authenticated user."
export const takesApiKey = (ctx: Pick<HandlerContext, 'call'>): boolean => (ctx.call.operation.credentials ?? []).includes('ApiKey');

/** The scope check: a token whose scopes reach none of those the operation's security names (the Discovery method's
 *  scopes, spec/patches.json) is refused; every served method names its scopes. */
// source: https://developers.google.com/youtube/v3/docs/errors "The OAuth 2.0 token provided for the request specifies scopes that are insufficient for accessing the requested data."
export function scoped(ctx: HandlerContext, caller: Caller): Response | undefined {
  const wanted = ctx.call.operation.scopes ?? [];
  const ok = wanted.length > 0 && caller.scopes.some((s) => wanted.includes(s));
  return ok ? undefined : refuse(ctx, 403, 'global', 'insufficientPermissions', 'The OAuth 2.0 token provided for the request specifies scopes that are insufficient for accessing the requested data.');
}

/** The channel a Google account owns. */
export const channelOfSub = (ctx: Pick<HandlerContext, 'rowsRaw'>, sub: string): Row | undefined =>
  ctx.rowsRaw(CHANNEL).find((c) => c.deleted !== true && c._sub === sub);
export const channelById = (ctx: Pick<HandlerContext, 'row'>, id: string): Row | undefined => live(ctx.row(CHANNEL, id));

/** The caller and the channel its Google account owns, or YouTube's refusal of an account with none. */
export function callerChannel(ctx: HandlerContext): { caller: Caller; channel: Row } | Response {
  const caller = callerOf(ctx);
  if (caller instanceof Response) return caller;
  const channel = channelOfSub(ctx, caller.sub);
  // source: https://developers.google.com/youtube/v3/docs/errors "This error indicates that the user has an unlinked Google Account, which means that the user has a Google Account but does not have a YouTube channel."
  // Where the documentation stops: the page names the reason (youtubeSignupRequired, 401) and not its domain; the twin
  // answers it in YouTube's header domain.
  if (!channel) return refuse(ctx, 401, 'youtube.header', 'youtubeSignupRequired', 'Unauthorized');
  return { caller, channel };
}

/** A channel's id. */
export const idOf = (ctx: Pick<HandlerContext, 'own'>, row: Row): string => String(ctx.own(row).id);

/** The channel's title, as a resource's snippet names it beside its id. */
export const channelTitle = (ctx: Pick<HandlerContext, 'own'>, channel: Row | undefined): string => String(obj(channel ? ctx.own(channel).snippet : undefined).title ?? '');

/** The author fields a comment or a chat message carries for a channel. */
export function authorOf(ctx: Pick<HandlerContext, 'own'>, channel: Row): { channelId: string; displayName: string; channelUrl: string; profileImageUrl: string } {
  const v = ctx.own(channel);
  const snippet = obj(v.snippet);
  const thumbs = obj(snippet.thumbnails);
  return {
    channelId: String(v.id), displayName: String(snippet.title ?? ''),
    channelUrl: `http://www.youtube.com/channel/${String(v.id)}`,
    profileImageUrl: String(obj(thumbs.default).url ?? ''),
  };
}

/** A comment's text as the request's textFormat asks it: HTML (the default) escapes it. */
// source: https://developers.google.com/youtube/v3/docs/commentThreads/list "Set this parameter's value to html or plainText to instruct the API to return the comments left by users in html formatted or in plain text."
export const textDisplay = (text: string, format: string | undefined): string =>
  format === 'plainText' ? text : text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/\n/g, '<br>');

/** The thumbnails YouTube names for a video, by its id. */
// source: https://developers.google.com/youtube/v3/live/docs/liveBroadcasts "The default thumbnail for a video"
export function videoThumbnails(id: string): Row {
  return {
    default: { url: `https://i.ytimg.com/vi/${id}/default.jpg`, width: 120, height: 90 },
    medium: { url: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`, width: 320, height: 180 },
    high: { url: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, width: 480, height: 360 },
  };
}

/** A video's counts, as the audience moved them. */
export function videoStats(ctx: Pick<HandlerContext, 'own'>, video: Row): { views: number; likes: number; comments: number } {
  const s = obj(ctx.own(video).statistics);
  return { views: Number(s.viewCount ?? 0), likes: Number(s.likeCount ?? 0), comments: Number(s.commentCount ?? 0) };
}

/** The live chat a broadcast holds, by its liveChatId, and the broadcast. */
export function chatById(ctx: Pick<HandlerContext, 'row'>, liveChatId: string): { chat: Row; broadcast: Row | undefined } | undefined {
  const chat = live(ctx.row(LIVE_CHAT, liveChatId));
  return chat ? { chat, broadcast: live(ctx.row(BROADCAST, String(chat.broadcast))) } : undefined;
}

/** Whether a broadcast's chat is still live: until the broadcast is complete. */
// source: https://developers.google.com/youtube/v3/live/docs/liveChatMessages "The chat has ended and no more messages can be inserted after this one."
export const chatEnded = (ctx: Pick<HandlerContext, 'own'>, broadcast: Row | undefined): boolean =>
  !broadcast || obj(ctx.own(broadcast).status).lifeCycleStatus === 'complete' || obj(ctx.own(broadcast).status).lifeCycleStatus === 'revoked';

/** Write a chat message into a live chat, from a channel (an author outside the World included), and count it on the
 *  broadcast's statistics. */
export async function postChatMessage(ctx: HandlerContext, liveChatId: string, broadcast: Row, author: Row, text: string, operation: string): Promise<Row> {
  const id = ctx.mint(CHAT_MESSAGE);
  const a = authorOf(ctx, author);
  const owner = String(obj(ctx.own(broadcast).snippet).channelId) === a.channelId;
  // source: https://developers.google.com/youtube/v3/live/docs/liveChatMessages "A user has sent a text message."
  const fields: Row = {
    kind: 'youtube#liveChatMessage', id,
    snippet: { type: 'textMessageEvent', liveChatId, authorChannelId: a.channelId, publishedAt: ctx.occurredAt, hasDisplayContent: true, displayMessage: text, textMessageDetails: { messageText: text } },
    authorDetails: { ...a, isVerified: false, isChatOwner: owner, isChatSponsor: false, isChatModerator: false },
    _liveChat: liveChatId, _author: a.channelId,
  };
  await ctx.write(CHAT_MESSAGE, id, fields, operation);
  const b = ctx.own(broadcast);
  // source: https://developers.google.com/youtube/v3/live/docs/liveBroadcasts "The total number of live chat messages associated with the broadcast."
  const total = Number(obj(b.statistics).totalChatCount ?? 0) + 1;
  await ctx.write(BROADCAST, String(b.id), { statistics: { totalChatCount: String(total) } }, operation);
  return ctx.row(CHAT_MESSAGE, id)!;
}

/** The broadcasts bound to a stream. */
export const broadcastsBoundTo = (ctx: Pick<HandlerContext, 'rowsRaw' | 'own'>, streamId: string): Row[] =>
  ctx.rowsRaw(BROADCAST).filter((b) => b.deleted !== true && obj(ctx.own(b).contentDetails).boundStreamId === streamId);

/** A broadcast's move to a new life-cycle status, with what it sets beside it: its actual start and its recording when it
 *  goes live, its actual end and the recording kept when it is complete. */
export async function moveBroadcast(ctx: HandlerContext, broadcast: Row, to: string, operation: string): Promise<void> {
  const b = ctx.own(broadcast);
  const status = { ...obj(b.status), lifeCycleStatus: to };
  const snippet = { ...obj(b.snippet) };
  // source: https://developers.google.com/youtube/v3/live/docs/liveBroadcasts "The date and time that the broadcast actually started. This information is only available once the broadcast's state is live ."
  if (to === 'live') { snippet.actualStartTime = ctx.occurredAt; if (obj(b.contentDetails).recordFromStart !== false) status.recordingStatus = 'recording'; }
  // source: https://developers.google.com/youtube/v3/live/docs/liveBroadcasts "The date and time that the broadcast actually ended. This information is only available once the broadcast's state is complete ."
  if (to === 'complete') { snippet.actualEndTime = ctx.occurredAt; if (status.recordingStatus === 'recording') status.recordingStatus = 'recorded'; }
  await ctx.write(BROADCAST, String(b.id), { status, snippet }, operation);
  // the broadcast's video moves with it: live while the broadcast is, its chat named while it is live, and processed once
  // it is complete
  const video = live(ctx.row(VIDEO, String(b.id)));
  if (!video || (to !== 'live' && to !== 'complete')) return;
  const v = ctx.own(video);
  const details = { ...obj(v.liveStreamingDetails) };
  // source: https://developers.google.com/youtube/v3/docs/videos "This field is filled only if the video is a currently live broadcast that has live chat."
  if (to === 'live') { details.actualStartTime = ctx.occurredAt; details.activeLiveChatId = snippet.liveChatId; }
  // source: https://developers.google.com/youtube/v3/docs/videos "Once the broadcast transitions to complete this field will be removed and the live chat closed down."
  if (to === 'complete') { details.actualEndTime = ctx.occurredAt; delete details.activeLiveChatId; }
  const videoStatus = { ...obj(v.status) };
  if (to === 'complete' && videoStatus.uploadStatus === 'uploaded' && !ctx.legal(VIDEO, 'status.uploadStatus', operation, 'uploaded', 'processed', String(b.id), 'vendor')) videoStatus.uploadStatus = 'processed';
  await ctx.write(VIDEO, String(b.id), { snippet: { ...obj(v.snippet), liveBroadcastContent: to === 'live' ? 'live' : 'none' }, liveStreamingDetails: details, status: videoStatus }, operation);
}

/** YouTube finishing a move it started (testStarting to testing, liveStarting to live), as its own move. */
export async function settleBroadcast(ctx: HandlerContext, id: string, operation: string): Promise<void> {
  const row = live(ctx.row(BROADCAST, id));
  if (!row) return;
  const from = String(obj(ctx.own(row).status).lifeCycleStatus);
  const to = from === 'testStarting' ? 'testing' : from === 'liveStarting' ? 'live' : undefined;
  if (!to) return;
  const refused = ctx.legal(BROADCAST, 'status.lifeCycleStatus', operation, from, to, id, 'vendor');
  if (refused) throw new Error(refused.message);
  await ctx.asVendor(() => moveBroadcast(ctx, row, to, operation));
}

// ── comments ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The channel whose video a comment is on: the owner who moderates it. */
export const videoOwner = (ctx: Pick<HandlerContext, 'row'>, videoId: string): Row | undefined => {
  const video = live(ctx.row(VIDEO, videoId));
  return video ? channelById(ctx, String(video._channel)) : undefined;
};

/** Whether an author is banned from a channel's comments (comments.setModerationStatus with banAuthor). */
export const bannedFrom = (ctx: Pick<HandlerContext, 'row'>, channelId: string, authorId: string): boolean => !!live(ctx.row(COMMENT_BAN, `${channelId}:${authorId}`));

/** A comment written by a channel (an author outside the World included) on a video: a top-level comment (its thread's
 *  id) or a reply (`parentId`). An author the video's channel banned is rejected as the comment arrives. */
export async function writeComment(ctx: HandlerContext, id: string, author: Row, video: Row, text: string, operation: string, parentId?: string): Promise<Row> {
  const a = authorOf(ctx, author);
  const channelId = String(video._channel);
  const fields: Row = {
    kind: 'youtube#comment', id,
    snippet: {
      authorDisplayName: a.displayName, authorProfileImageUrl: a.profileImageUrl, authorChannelUrl: a.channelUrl, authorChannelId: { value: a.channelId },
      channelId, videoId: String(ctx.own(video).id), textOriginal: text, ...(parentId ? { parentId } : {}),
      canRate: true, viewerRating: 'none', likeCount: 0, moderationStatus: 'published', publishedAt: ctx.occurredAt, updatedAt: ctx.occurredAt,
    },
    _author: a.channelId, _video: String(ctx.own(video).id), _thread: parentId ?? id,
  };
  await ctx.write(COMMENT, id, fields, operation);
  if (bannedFrom(ctx, channelId, a.channelId)) {
    const refused = ctx.legal(COMMENT, 'snippet.moderationStatus', operation, 'published', 'rejected', id, 'vendor');
    if (!refused) await ctx.asVendor(() => ctx.write(COMMENT, id, { snippet: { ...obj(fields.snippet), moderationStatus: 'rejected' } }, operation));
  } else {
    // the video counts its published comments
    const stats = obj(ctx.own(video).statistics);
    await ctx.write(VIDEO, String(ctx.own(video).id), { statistics: { ...stats, commentCount: String(Number(stats.commentCount ?? 0) + 1) } }, operation);
  }
  return ctx.row(COMMENT, id)!;
}

/** A comment as the caller is shown it: its text in the request's format, its original text to its author alone and its
 *  moderation status to the video's channel's owner alone. */
// source: https://developers.google.com/youtube/v3/docs/comments "The original text is only returned to the authenticated user if they are the comment's author."
// source: https://developers.google.com/youtube/v3/docs/comments "This property is only returned if the API request was authorized by the owner of the channel or the video on which the requested comments were made."
export function commentAnswer(ctx: HandlerContext, comment: Row, viewer: { channelId?: string; sub?: string }, format: string | undefined, byId = false): Row {
  const v = vendorView(ctx, comment);
  const snippet = { ...obj(v.snippet) };
  snippet.textDisplay = textDisplay(String(snippet.textOriginal ?? ''), format);
  if (viewer.channelId !== comment._author) delete snippet.textOriginal;
  // source: https://developers.google.com/youtube/v3/docs/comments "Also, this property isn't set if the API request used the id filter parameter."
  const owner = channelById(ctx, String(snippet.channelId));
  if (byId || !owner || owner._sub !== viewer.sub) delete snippet.moderationStatus;
  const ordered: Row = {};
  for (const k of ['authorDisplayName', 'authorProfileImageUrl', 'authorChannelUrl', 'authorChannelId', 'channelId', 'videoId', 'textDisplay', 'textOriginal', 'parentId', 'canRate', 'viewerRating', 'likeCount', 'moderationStatus', 'publishedAt', 'updatedAt']) if (snippet[k] !== undefined) ordered[k] = snippet[k];
  const body = { kind: 'youtube#comment', id: v.id, snippet: ordered };
  return { kind: body.kind, etag: etagOf(ctx, body), id: body.id, snippet: ordered };
}

/** The replies to a top-level comment the caller may see: published ones, and the owner's view of the held ones. */
export function repliesTo(ctx: HandlerContext, threadId: string): Row[] {
  return ctx.rowsRaw(COMMENT).filter((c) => c.deleted !== true && c._thread === threadId && c.id !== threadId && ctx.own(c).id !== threadId);
}

/** A comment thread as YouTube answers it: its top-level comment and, with the replies part, its published replies. */
// source: https://developers.google.com/youtube/v3/docs/commentThreads "The total number of replies that have been submitted in response to the top-level comment."
export function threadAnswer(ctx: HandlerContext, thread: Row, parts: Set<string>, viewer: { channelId?: string; sub?: string }, format: string | undefined, byId = false): Row {
  const t = vendorView(ctx, thread);
  const id = String(t.id);
  const top = live(ctx.row(COMMENT, id));
  const replies = repliesTo(ctx, id).filter((r) => obj(ctx.own(r).snippet).moderationStatus === 'published');
  const out: Row = { kind: 'youtube#commentThread', etag: '', id };
  if (parts.has('snippet')) {
    const s = obj(t.snippet);
    out.snippet = {
      channelId: s.channelId, videoId: s.videoId,
      ...(top ? { topLevelComment: commentAnswer(ctx, top, viewer, format, byId) } : {}),
      // source: https://developers.google.com/youtube/v3/docs/commentThreads "This setting indicates whether the current viewer can reply to the thread."
      canReply: viewer.channelId !== undefined, totalReplyCount: replies.length,
      // source: https://developers.google.com/youtube/v3/docs/commentThreads "This setting indicates whether the thread, including all of its comments and comment replies, is visible to all YouTube users."
      isPublic: true,
    };
  }
  if (parts.has('replies') && replies.length) out.replies = { comments: replies.map((r) => commentAnswer(ctx, r, viewer, format, byId)) };
  out.etag = etagOf(ctx, out);
  return out;
}
