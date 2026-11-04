// The comments family: a reply to a top-level comment (comments.insert), and the channel owner's moderation of the
// comments on its videos (comments.setModerationStatus).
import type { HandlerContext } from '@volter/world-core';
import { COMMENT, COMMENT_BAN, VIDEO, bodyObject, callerChannel, commentAnswer, idOf, listParam, live, obj, query, refuse, videoOwner, writeComment } from './shared.ts';

const DOMAIN = 'youtube.comment';
const TARGETS = ['heldForReview', 'published', 'rejected'];

// source: https://developers.google.com/youtube/v3/docs/comments/insert "Creates a reply to an existing comment."
export async function youtube_comments_insert(ctx: HandlerContext): Promise<Response> {
  const who = callerChannel(ctx);
  if (who instanceof Response) return who;
  const snippet = obj(bodyObject(ctx).snippet);
  // source: https://developers.google.com/youtube/v3/docs/errors "However, the comment resource in the body of the API request did not specify a value for the snippet.parentId property."
  if (typeof snippet.parentId !== 'string' || !snippet.parentId) return refuse(ctx, 400, DOMAIN, 'parentIdMissing', 'The comment that is being inserted must be linked to a parent comment. However, the comment resource in the body of the API request did not specify a value for the snippet.parentId property.');
  // source: https://developers.google.com/youtube/v3/docs/comments/insert "The comment resource that is being inserted must specify a value for the snippet.textOriginal property. Comments cannot be empty."
  if (typeof snippet.textOriginal !== 'string' || !snippet.textOriginal.trim()) return refuse(ctx, 400, DOMAIN, 'commentTextRequired', 'The comment resource that is being inserted must specify a value for the snippet.textOriginal property. Comments cannot be empty.');
  const parent = live(ctx.row(COMMENT, snippet.parentId));
  // source: https://developers.google.com/youtube/v3/docs/errors "The specified parent comment couldn't be found. Check the value of the snippet.parentId property in the request body to ensure that it is correct."
  if (!parent || obj(ctx.own(parent).snippet).moderationStatus === 'rejected') return refuse(ctx, 404, DOMAIN, 'parentCommentNotFound', "The specified parent comment couldn't be found. Check the value of the snippet.parentId property in the request body to ensure that it is correct.");
  // source: https://developers.google.com/youtube/v3/docs/comments/insert "The API user is not able to insert a comment in reply to the top-level comment identified by the snippet.parentId property."
  if (obj(ctx.own(parent).snippet).parentId !== undefined) return refuse(ctx, 400, DOMAIN, 'operationNotSupported', 'The API user is not able to insert a comment in reply to the top-level comment identified by the snippet.parentId property. In a commentThread resource, the snippet.canReply property indicates whether the current viewer can reply to the thread.');
  const video = live(ctx.row(VIDEO, String(parent._video)));
  if (!video) return refuse(ctx, 404, DOMAIN, 'parentCommentNotFound', "The specified parent comment couldn't be found. Check the value of the snippet.parentId property in the request body to ensure that it is correct.");
  // a reply's id is its thread's, a dot, and its own
  const id = `${snippet.parentId}.${ctx.mint(COMMENT)}`;
  const reply = await writeComment(ctx, id, who.channel, video, snippet.textOriginal, 'youtube.comments.insert', snippet.parentId);
  return Response.json(commentAnswer(ctx, reply, { channelId: idOf(ctx, who.channel), sub: who.caller.sub }, query(ctx, 'textFormat')));
}

// source: https://developers.google.com/youtube/v3/docs/comments/setModerationStatus "Sets the moderation status of one or more comments. The API request must be authorized by the owner of the channel or video associated with the comments."
export async function youtube_comments_setModerationStatus(ctx: HandlerContext): Promise<Response> {
  const who = callerChannel(ctx);
  if (who instanceof Response) return who;
  const ids = listParam(ctx, 'id');
  const status = query(ctx, 'moderationStatus') ?? '';
  const ban = ctx.flag(query(ctx, 'banAuthor')) === true;
  // source: https://developers.google.com/youtube/v3/docs/errors "The request is missing a required parameter."
  if (!ids.length || !status) return refuse(ctx, 400, 'youtube.parameter', 'missingRequiredParameter', 'The request is missing a required parameter.');
  // source: https://developers.google.com/youtube/v3/docs/comments/setModerationStatus "The id parameter specifies a comma-separated list of up to 50 IDs that identify the comments for which you are updating the moderation status."
  // source: https://developers.google.com/youtube/v3/docs/core_errors "The request failed because it contained an invalid parameter or parameter value."
  if (ids.length > 50 || !TARGETS.includes(status)) return refuse(ctx, 400, 'youtube.parameter', 'invalidParameter', 'The request failed because it contained an invalid parameter or parameter value.');
  // source: https://developers.google.com/youtube/v3/docs/comments/setModerationStatus "The banAuthor parameter can only be used if the moderationStatus parameter value is rejected ."
  if (ban && status !== 'rejected') return refuse(ctx, 400, DOMAIN, 'banWithoutReject', 'The banAuthor parameter can only be used if the moderationStatus parameter value is rejected.');
  const comments = ids.map((id) => live(ctx.row(COMMENT, id)));
  // source: https://developers.google.com/youtube/v3/docs/comments/setModerationStatus "One or more of the comments that the request is trying to update can't be found."
  if (comments.some((c) => !c)) return refuse(ctx, 404, DOMAIN, 'commentNotFound', "One or more of the comments that the request is trying to update can't be found. Check the values of the request's id parameter to ensure that they are correct.");
  // source: https://developers.google.com/youtube/v3/docs/comments/setModerationStatus "The moderation status of one or more comments can't be set due to insufficient permissions."
  if (comments.some((c) => videoOwner(ctx, String(c!._video))?._sub !== who.caller.sub)) return refuse(ctx, 403, DOMAIN, 'forbidden', "The moderation status of one or more comments can't be set due to insufficient permissions. The request might not be authorized.");
  // every comment's move is legal before any is made
  for (const c of comments) {
    const from = String(obj(ctx.own(c!).snippet).moderationStatus);
    if (from === status) continue;
    const refused = ctx.legal(COMMENT, 'snippet.moderationStatus', 'youtube.comments.setModerationStatus', from, status, String(ctx.own(c!).id));
    if (refused) return refuse(ctx, refused.status, DOMAIN, String(refused.code), refused.message);
  }
  for (const c of comments) {
    const v = ctx.own(c!);
    const snippet = obj(v.snippet);
    if (snippet.moderationStatus === status) continue;
    await ctx.write(COMMENT, String(v.id), { snippet: { ...snippet, moderationStatus: status, updatedAt: ctx.occurredAt } }, 'youtube.comments.setModerationStatus');
    // source: https://developers.google.com/youtube/v3/docs/comments/setModerationStatus "Set the parameter value to true to ban the author."
    if (ban) await ctx.record(COMMENT_BAN, { channel: String(snippet.channelId), author: String(c!._author), at: ctx.occurredAt }, `${String(snippet.channelId)}:${String(c!._author)}`);
  }
  // source: https://developers.google.com/youtube/v3/docs/comments/setModerationStatus "If successful, this method returns an HTTP 204 response code ( No Content )."
  return new Response(null, { status: 204 });
}
