// An IG Media's edges: its insights (the audience's interactions, as metrics), and its comments, listed and made.
import type { HandlerContext } from '@volter/world-core';
import { COMMENT, COMMENTS, INSIGHTS, MEDIA, authorized, commentList, commentsCount, igTime, invalidParam, mediaNotFound, paged, paramsOf, selection, text, type Caller, type Row } from './shared.ts';

/** The caller's own media by the path's ID, or the refusal. */
function ownMedia(ctx: HandlerContext, c: Caller): Row | Response {
  const id = String(ctx.call.params['ig-media-id'] ?? '');
  const row = ctx.row(MEDIA, id);
  // source: https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-media/comments "An access token from a User who created the IG Media object"
  return row && row.deleted !== true && row._account === c.account.id ? row : mediaNotFound(ctx, id);
}

/** The metrics the Instagram API with Instagram Login answers on a post or a reel, with the media product types each is
 *  available on and what it counts. The others the page lists (follows, profile_activity, profile_visits, the reels'
 *  watch times and skip rate, story metrics, reposts and the Facebook views) are the manifest's variants: the gap. */
// source: https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media/insights "The following table shows the metrics and the media object types the are available on."
const METRICS: Record<string, { title: string; description: string; on: string[]; value: (ctx: HandlerContext, m: Row) => number }> = {
  // source: https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media/insights "Number of comments on the media object."
  comments: { title: 'Comments', description: 'Number of comments on the media object.', on: ['FEED', 'REELS'], value: (ctx, m) => commentsCount(ctx, String(m.id)) },
  // source: https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media/insights "Number of likes on the media object."
  likes: { title: 'Likes', description: 'Number of likes on the media object.', on: ['FEED', 'REELS'], value: (_ctx, m) => Number(m.like_count ?? 0) },
  // source: https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media/insights "Number of unique Instagram users that have seen the reel at least once."
  reach: { title: 'Accounts reached', description: 'Number of unique Instagram users that have seen the reel at least once.', on: ['FEED', 'REELS'], value: (_ctx, m) => Number(m._reach ?? 0) },
  // source: https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media/insights "was saved by an Instagram user."
  saved: { title: 'Saved', description: 'Number of times your app user’s Instagram media was saved by an Instagram user.', on: ['FEED', 'REELS'], value: (_ctx, m) => Number(m._saved ?? 0) },
  // source: https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media/insights "Number of shares of the reel."
  shares: { title: 'Shares', description: 'Number of shares of the reel.', on: ['FEED', 'REELS'], value: (_ctx, m) => Number(m._shares ?? 0) },
  // source: https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media/insights "Number of likes, saves, comments, and shares on the reel, minus the number of unlikes, unsaves, and deleted comments."
  total_interactions: { title: 'Interactions', description: 'Number of likes, saves, comments, and shares on the reel, minus the number of unlikes, unsaves, and deleted comments.', on: ['FEED', 'REELS'],
    value: (ctx, m) => Number(m.like_count ?? 0) + Number(m._saved ?? 0) + commentsCount(ctx, String(m.id)) + Number(m._shares ?? 0) },
  // source: https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media/insights "Total number of times IG Media has been played on Instagram."
  views: { title: 'Views', description: 'Total number of times IG Media has been played on Instagram.', on: ['FEED', 'REELS'], value: (_ctx, m) => Number(m._views ?? 0) },
};

// source: https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media/insights "Get insights data on an Instagram Media object."
export async function getMediaInsights(ctx: HandlerContext): Promise<Response> {
  const c = authorized(ctx, INSIGHTS);
  if (c instanceof Response) return c;
  const media = ownMedia(ctx, c);
  if (media instanceof Response) return media;
  const own = ctx.own(media);
  // source: https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media/insights "Required. Comma-separated list of metrics you want returned."
  const names = (text(paramsOf(ctx).metric) ?? '').split(',').map((m) => m.trim()).filter(Boolean);
  if (!names.length) return invalidParam(ctx, '(#100) The parameter metric is required');
  const id = String(own.id ?? media.id);
  const data: Row[] = [];
  for (const name of names) {
    const metric = METRICS[name];
    // Where the documentation stops: the page gives no message for a metric it does not list, or one a media's type
    // lacks; both are the invalid-parameter class (100)
    if (!metric) return invalidParam(ctx, `(#100) metric[${names.indexOf(name)}] must be one of the following values: ${Object.keys(METRICS).join(', ')}`);
    if (!metric.on.includes(String(own.media_product_type))) return invalidParam(ctx, `(#100) The Media Insights API does not support the ${name} metric for this media product type.`);
    // source: https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media/insights "Period is automatically set to lifetime in the request and cannot be changed, so this value will always be lifetime ."
    data.push({ name, period: 'lifetime', values: [{ value: metric.value(ctx, media) }], title: metric.title, description: metric.description, id: `${id}/insights/${name}/lifetime` });
  }
  return Response.json({ data });
}

// source: https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-media/comments "Returns a list of IG Comments on an IG Media object."
export async function getMediaComments(ctx: HandlerContext): Promise<Response> {
  const c = authorized(ctx, COMMENTS);
  if (c instanceof Response) return c;
  const media = ownMedia(ctx, c);
  if (media instanceof Response) return media;
  // source: https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-media/comments "Returns only top-level comments."
  const fields = selection(ctx, ['timestamp', 'text', 'id']);
  if (fields instanceof Response) return fields;
  const id = String(media.id);
  const list = commentList(ctx, id, fields);
  if (list instanceof Response) return list;
  const ids = ctx.rowsRaw(COMMENT).filter((r) => r.deleted !== true && (r.media as Row | undefined)?.id === id && r.parent_id === undefined).reverse().map((r) => String(r.id));
  // source: https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-media/comments "Returns a maximum of 50 comments per query."
  return paged(ctx, list.map((view, i) => ({ id: ids[i]!, view })), `/${id}/comments`, 50, 50);
}

// source: https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-media/comments "Creates an IG Comment on an IG Media object."
export async function createMediaComment(ctx: HandlerContext): Promise<Response> {
  const c = authorized(ctx, COMMENTS);
  if (c instanceof Response) return c;
  const media = ownMedia(ctx, c);
  if (media instanceof Response) return media;
  const message = text(paramsOf(ctx).message);
  // source: https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-media/comments "The text to be included in the comment."
  if (!message) return invalidParam(ctx, '(#100) The parameter message is required.');
  const own = ctx.own(media);
  // a media whose comments its owner turned off takes none, the owner's own included. Where the documentation stops:
  // the pages give no message for it; it is the invalid-parameter class (100)
  // source: https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media "Set to true to enable comments or false to disable comments."
  if (own.is_comment_enabled === false) return invalidParam(ctx, '(#100) Comments are turned off for this media.');
  const id = ctx.mint(COMMENT);
  const account = c.account;
  await ctx.write(COMMENT, id, {
    id, text: message, timestamp: igTime(ctx.occurredAt), from: { id: String(account.id), username: account.username }, username: account.username,
    hidden: false, like_count: 0, media: { id: String(own.id ?? media.id), media_product_type: own.media_product_type },
    _account: account.id, _user: String(account.id), _media: String(own.id ?? media.id),
  }, 'createMediaComment');
  return Response.json({ id });
}
