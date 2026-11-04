// A node by its ID, as the Graph API addresses every node: the IG User (the caller's own), an IG Container, an IG Media
// and an IG Comment, each read by its fields, a media's comments turned on or off, a comment hidden or deleted.
import type { HandlerContext } from '@volter/world-core';
import { COMMENT, COMMENTS, CONTAINER, MEDIA, PUBLISH, authorized, commentView, containerView, flagOf, invalidParam, isCaller, mediaNotFound, mediaView, paramsOf, selection, settled, unsupported, userView, type Caller, type Row } from './shared.ts';

/** What an ID names for this caller: its own account, one of its containers or media, or a comment on its media. */
function nodeOf(ctx: HandlerContext, c: Caller, id: string): { kind: 'user' } | { kind: 'container' | 'media' | 'comment'; row: Row } | { kind: 'foreign-media' } | undefined {
  if (isCaller(c, id)) return { kind: 'user' };
  const container = ctx.row(CONTAINER, id);
  if (container && container._account === c.account.id) return { kind: 'container', row: container };
  const media = ctx.row(MEDIA, id);
  if (media) return media._account === c.account.id ? { kind: 'media', row: media } : { kind: 'foreign-media' };
  const comment = ctx.row(COMMENT, id);
  if (comment && comment._account === c.account.id) return { kind: 'comment', row: comment };
  return undefined;
}

// source: https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media "Gets fields and edges on Instagram media."
export async function getNode(ctx: HandlerContext): Promise<Response> {
  const c = authorized(ctx);
  if (c instanceof Response) return c;
  const id = String(ctx.params.id ?? '');
  const node = nodeOf(ctx, c, id);
  if (!node) return unsupported(ctx, 'GET', id);
  // source: https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media "This API returns only data for media owned by Instagram professional accounts."
  if (node.kind === 'foreign-media') return mediaNotFound(ctx, id);
  if (node.kind === 'user') {
    // source: https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user "Get fields and edges on an Instagram Business or Creator Account."
    const fields = selection(ctx, ['id']);
    if (fields instanceof Response) return fields;
    const view = userView(ctx, c, fields);
    return view instanceof Response ? view : Response.json(view);
  }
  if (node.kind === 'container') {
    // source: https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-container "Get fields and edges on an IG Container."
    const allowed = authorized(ctx, PUBLISH);
    if (allowed instanceof Response) return allowed;
    // Where the documentation stops: the page does not list the default fields; with none asked, the id
    const fields = selection(ctx, ['id']);
    if (fields instanceof Response) return fields;
    const view = containerView(ctx, await settled(ctx, node.row), fields);
    return view instanceof Response ? view : Response.json(view);
  }
  if (node.kind === 'media') {
    const fields = selection(ctx, ['id']);
    if (fields instanceof Response) return fields;
    if (fields.some((f) => f.name === 'comments')) {
      const allowed = authorized(ctx, COMMENTS);
      if (allowed instanceof Response) return allowed;
    }
    const view = mediaView(ctx, node.row, fields);
    return view instanceof Response ? view : Response.json(view);
  }
  // source: https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-comment "Get fields and edges on an IG Comment."
  const allowed = authorized(ctx, COMMENTS);
  if (allowed instanceof Response) return allowed;
  // source: https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-media/comments "If omitted, the response includes id , text , and timestamp ."
  const fields = selection(ctx, ['id', 'text', 'timestamp']);
  if (fields instanceof Response) return fields;
  const view = commentView(ctx, node.row, fields);
  return view instanceof Response ? view : Response.json(view);
}

// source: https://developers.facebook.com/documentation/instagram-platform/comment-moderation "POST /<IG_COMMENT_ID> — Hide/unhide an IG Comment"
export async function updateNode(ctx: HandlerContext): Promise<Response> {
  const c = authorized(ctx);
  if (c instanceof Response) return c;
  const id = String(ctx.params.id ?? '');
  const node = nodeOf(ctx, c, id);
  if (node?.kind === 'foreign-media') return mediaNotFound(ctx, id);
  if (node?.kind !== 'media' && node?.kind !== 'comment') return unsupported(ctx, 'POST', id);
  const allowed = authorized(ctx, COMMENTS);
  if (allowed instanceof Response) return allowed;
  const p = paramsOf(ctx);
  if (node.kind === 'media') {
    // source: https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media "Required. Set to true to enable comments or false to disable comments."
    const enabled = flagOf(p.comment_enabled);
    if (enabled === undefined) return invalidParam(ctx, '(#100) The parameter comment_enabled is required.');
    await ctx.write(MEDIA, id, { is_comment_enabled: enabled }, 'updateNode');
    return Response.json({ success: true });
  }
  // source: https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-comment "Set to true to hide the comment, or false to show the comment."
  const hide = flagOf(p.hide);
  if (hide === undefined) return invalidParam(ctx, '(#100) The parameter hide is required.');
  // source: https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-comment "Comments made by media object owners on their own media objects will always be displayed, even if the comments have been set to hide=true ."
  const byOwner = node.row._user === String(c.account.id);
  await ctx.write(COMMENT, id, { hidden: hide && !byOwner }, 'updateNode');
  return Response.json({ success: true });
}

// source: https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-comment "A comment can only be deleted by the owner of the object upon which the comment was made, even if the user attempting to delete the comment is the comment"
export async function deleteNode(ctx: HandlerContext): Promise<Response> {
  const c = authorized(ctx);
  if (c instanceof Response) return c;
  const id = String(ctx.params.id ?? '');
  const node = nodeOf(ctx, c, id);
  // source: https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media "This api only supports Instagram API with Facebook login only."
  // deleting a media is the Instagram API with Facebook Login's, another flow on another host: the gap
  if (node?.kind === 'media' || node?.kind === 'foreign-media') return ctx.gap();
  if (node?.kind !== 'comment') return unsupported(ctx, 'DELETE', id);
  const allowed = authorized(ctx, COMMENTS);
  if (allowed instanceof Response) return allowed;
  // its replies go with it: "You cannot get replies to a comment that has been deleted."
  await ctx.remove(COMMENT, id, 'deleteNode');
  return Response.json({ success: true });
}
