// The commentThreads family: the comments on a channel's videos, read by video, by channel or by id
// (commentThreads.list), and a new top-level comment (commentThreads.insert).
import type { HandlerContext } from '@volter/world-core';
import { COMMENT, THREAD, VIDEO, bodyObject, callerChannel, callerOf, channelById, channelOfSub, idOf, listAnswer, listParam, live, maxResultsOf, obj, offsetFor, partsOf, query, refuse, threadAnswer, videoOwner, writeComment, type Row } from './shared.ts';

const DOMAIN = 'youtube.commentThread';
const STATUSES = ['heldForReview', 'likelySpam', 'published'];

// source: https://developers.google.com/youtube/v3/docs/commentThreads/list "Returns a list of comment threads that match the API request parameters."
export async function youtube_commentThreads_list(ctx: HandlerContext): Promise<Response> {
  const parts = partsOf(ctx);
  const caller = callerOf(ctx);
  const sub = caller instanceof Response ? undefined : caller.sub;
  const mine = sub ? channelOfSub(ctx, sub) : undefined;
  const viewer = { ...(mine ? { channelId: idOf(ctx, mine) } : {}), ...(sub ? { sub } : {}) };
  const ids = listParam(ctx, 'id');
  const videoId = query(ctx, 'videoId');
  const channelId = query(ctx, 'allThreadsRelatedToChannelId');
  // source: https://developers.google.com/youtube/v3/docs/commentThreads/list "Filters (specify exactly one of the following parameters)"
  if ([ids.length > 0, videoId !== undefined, channelId !== undefined].filter(Boolean).length !== 1) return refuse(ctx, 400, 'youtube.parameter', 'incompatibleParameters', 'The request specifies two or more parameters that cannot be used in the same request.');
  const format = query(ctx, 'textFormat');
  if (ids.length) {
    const found = ids.map((id) => live(ctx.row(THREAD, id))).filter((t): t is Row => !!t && obj(ctx.own(live(ctx.row(COMMENT, idOf(ctx, t))) ?? {}).snippet).moderationStatus === 'published');
    // source: https://developers.google.com/youtube/v3/docs/commentThreads/list "One or more of the specified comment threads cannot be found."
    if (!found.length) return refuse(ctx, 404, DOMAIN, 'commentThreadNotFound', "One or more of the specified comment threads cannot be found. Check the values of the request's id parameter to ensure that it is correct.");
    return listAnswer(ctx, 'youtube#commentThreadListResponse', found.map((t) => threadAnswer(ctx, t, parts, viewer, format, true)), 0, Math.max(found.length, 1));
  }
  // source: https://developers.google.com/youtube/v3/docs/commentThreads/list "Acceptable values are 1 to 100 , inclusive. The default value is 20 ."
  const size = maxResultsOf(ctx, 20, 1, 100);
  if (size instanceof Response) return size;
  const offset = offsetFor(ctx);
  if (offset instanceof Response) return offset;
  // source: https://developers.google.com/youtube/v3/docs/commentThreads/list "Note: This parameter is not supported for use in conjunction with the id parameter. The default value is published ."
  const status = query(ctx, 'moderationStatus') ?? 'published';
  // source: https://developers.google.com/youtube/v3/docs/core_errors "The request failed because it contained an invalid parameter or parameter value."
  if (!STATUSES.includes(status)) return refuse(ctx, 400, 'youtube.parameter', 'invalidParameter', 'The request failed because it contained an invalid parameter or parameter value.');
  let owner: Row | undefined;
  let threads: Row[];
  if (videoId !== undefined) {
    const video = live(ctx.row(VIDEO, videoId));
    // source: https://developers.google.com/youtube/v3/docs/commentThreads/list "The video identified by the videoId parameter couldn't be found."
    if (!video || (obj(ctx.own(video).status).privacyStatus === 'private' && video._sub !== sub)) return refuse(ctx, 404, DOMAIN, 'videoNotFound', "The video identified by the videoId parameter couldn't be found.");
    owner = videoOwner(ctx, videoId);
    threads = ctx.rowsRaw(THREAD).filter((t) => t.deleted !== true && t._video === videoId);
  } else {
    owner = channelById(ctx, String(channelId));
    // source: https://developers.google.com/youtube/v3/docs/commentThreads/list "The channel identified by the allThreadsRelatedToChannelId parameter couldn't be found."
    if (!owner) return refuse(ctx, 404, DOMAIN, 'channelNotFound', "The channel identified by the allThreadsRelatedToChannelId parameter couldn't be found.");
    threads = ctx.rowsRaw(THREAD).filter((t) => t.deleted !== true && t._channel === channelId);
  }
  // source: https://developers.google.com/youtube/v3/docs/commentThreads/list "This parameter can only be used in a properly authorized request ."
  // source: https://developers.google.com/youtube/v3/docs/commentThreads/list "One or more of the requested comment threads cannot be retrieved due to insufficient permissions."
  if (status !== 'published' && owner?._sub !== sub) return refuse(ctx, 403, DOMAIN, 'forbidden', 'One or more of the requested comment threads cannot be retrieved due to insufficient permissions. The request might not be properly authorized.');
  // source: https://developers.google.com/youtube/v3/docs/commentThreads/list "A comment thread can be included in the response if the top-level comment or at least one of the replies to that comment are awaiting review."
  const holds = (t: Row): boolean => ctx.rowsRaw(COMMENT).some((c) => c.deleted !== true && c._thread === idOf(ctx, t) && obj(ctx.own(c).snippet).moderationStatus === status && (status !== 'published' || ctx.own(c).id === idOf(ctx, t)));
  // source: https://developers.google.com/youtube/v3/docs/commentThreads/list "Comment threads are ordered by time. This is the default behavior."
  const ordered = threads.filter(holds).reverse();
  return listAnswer(ctx, 'youtube#commentThreadListResponse', ordered.map((t) => threadAnswer(ctx, t, parts, viewer, format)), offset, size);
}

// source: https://developers.google.com/youtube/v3/docs/commentThreads/insert "Creates a new top-level comment. To add a reply to an existing comment, use the comments.insert method instead."
export async function youtube_commentThreads_insert(ctx: HandlerContext): Promise<Response> {
  const who = callerChannel(ctx);
  if (who instanceof Response) return who;
  const parts = partsOf(ctx);
  const snippet = obj(bodyObject(ctx).snippet);
  const text = obj(obj(snippet.topLevelComment).snippet).textOriginal;
  // source: https://developers.google.com/youtube/v3/docs/commentThreads/insert "Each comment thread must be linked to a video. Make sure the resource specifies values for the snippet.channelId and the snippet.videoId properties."
  if (typeof snippet.channelId !== 'string' || typeof snippet.videoId !== 'string' || !snippet.channelId || !snippet.videoId) return refuse(ctx, 400, DOMAIN, 'channelOrVideoIdMissing', 'Each comment thread must be linked to a video. Make sure the resource specifies values for the snippet.channelId and the snippet.videoId properties.');
  // source: https://developers.google.com/youtube/v3/docs/commentThreads/insert "Comments cannot be empty."
  if (typeof text !== 'string' || !text.trim()) return refuse(ctx, 400, DOMAIN, 'commentTextRequired', 'The comment resource that is being inserted must specify a value for the snippet.topLevelComment.snippet.textOriginal property. Comments cannot be empty.');
  const video = live(ctx.row(VIDEO, snippet.videoId));
  // source: https://developers.google.com/youtube/v3/docs/commentThreads/insert "The specified video couldn't be found. Check the value of the snippet.videoId property to ensure it is correct."
  if (!video || (obj(ctx.own(video).status).privacyStatus === 'private' && video._sub !== who.caller.sub)) return refuse(ctx, 404, DOMAIN, 'videoNotFound', "The specified video couldn't be found. Check the value of the snippet.videoId property to ensure it is correct.");
  // source: https://developers.google.com/youtube/v3/docs/commentThreads/insert "The specified channel couldn't be found. Check the value of the snippet.channelId property to ensure it is correct."
  if (!channelById(ctx, snippet.channelId) || video._channel !== snippet.channelId) return refuse(ctx, 404, DOMAIN, 'channelNotFound', "The specified channel couldn't be found. Check the value of the snippet.channelId property to ensure it is correct.");
  const id = ctx.mint(THREAD);
  await ctx.write(THREAD, id, { kind: 'youtube#commentThread', id, snippet: { channelId: snippet.channelId, videoId: snippet.videoId, canReply: true, isPublic: true }, _video: snippet.videoId, _channel: snippet.channelId }, 'youtube.commentThreads.insert');
  await writeComment(ctx, id, who.channel, video, text, 'youtube.commentThreads.insert');
  return Response.json(threadAnswer(ctx, ctx.row(THREAD, id)!, parts, { channelId: idOf(ctx, who.channel), sub: who.caller.sub }, query(ctx, 'textFormat')));
}
