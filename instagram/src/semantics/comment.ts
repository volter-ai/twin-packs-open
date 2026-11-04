// An IG Comment's replies: listed, and a reply made, on a comment on the caller's own media.
import type { HandlerContext } from '@volter/world-core';
import { COMMENT, COMMENTS, authorized, commentView, igTime, invalidParam, obj, paged, paramsOf, repliesOf, selection, text, unsupported, type Caller, type Row } from './shared.ts';

/** A live comment on the caller's media, by the path's ID, or the refusal. */
function ownComment(ctx: HandlerContext, c: Caller, method: string): Row | Response {
  const id = String(ctx.params['ig-comment-id'] ?? '');
  const row = ctx.row(COMMENT, id);
  // source: https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-comment/replies "You cannot get replies to a comment that has been deleted."
  return row && row.deleted !== true && row._account === c.account.id ? row : unsupported(ctx, method, id);
}

// source: https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-comment/replies "Returns a list of IG Comments on an IG Comment ."
export async function getCommentReplies(ctx: HandlerContext): Promise<Response> {
  const c = authorized(ctx, COMMENTS);
  if (c instanceof Response) return c;
  const comment = ownComment(ctx, c, 'GET');
  if (comment instanceof Response) return comment;
  const fields = selection(ctx, ['timestamp', 'text', 'id']);
  if (fields instanceof Response) return fields;
  const items: Array<{ id: string; view: Row }> = [];
  for (const r of repliesOf(ctx, String(comment.id))) {
    const view = commentView(ctx, r, fields);
    if (view instanceof Response) return view;
    items.push({ id: String(r.id), view });
  }
  // Where the documentation stops: the page names no page size for replies; a comment list's 50
  return paged(ctx, items, `/${String(comment.id)}/replies`, 50, 50);
}

// source: https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-comment/replies "Creates an IG Comment on an IG Comment ."
export async function createCommentReply(ctx: HandlerContext): Promise<Response> {
  const c = authorized(ctx, COMMENTS);
  if (c instanceof Response) return c;
  const comment = ownComment(ctx, c, 'POST');
  if (comment instanceof Response) return comment;
  const message = text(paramsOf(ctx).message);
  // source: https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-comment/replies "(required) — The text to be included in the comment."
  if (!message) return invalidParam(ctx, '(#100) The parameter message is required.');
  // source: https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-comment/replies "You cannot reply to hidden comments."
  if (comment.hidden === true) return invalidParam(ctx, '(#100) You cannot reply to a hidden comment.');
  // source: https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-comment/replies "You can only reply to top-level comments; replies to a reply will be added to the top-level comment."
  const top = typeof comment.parent_id === 'string' ? comment.parent_id : String(comment.id);
  const id = ctx.mint(COMMENT);
  const account = c.account;
  await ctx.write(COMMENT, id, {
    id, text: message, timestamp: igTime(ctx.occurredAt), from: { id: String(account.id), username: account.username }, username: account.username,
    hidden: false, like_count: 0, media: obj(comment.media), parent_id: top, _account: account.id, _user: String(account.id), _media: String(obj(comment.media).id),
  }, 'createCommentReply');
  return Response.json({ id });
}
