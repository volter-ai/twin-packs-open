// The IG User and its edges: the app user (/me), its media, a container made from a media URL, a container
// published, and the publishing usage of the last 24 hours.
import type { HandlerContext } from '@volter/world-core';
import { CDN, CONTAINER, MEDIA, PUBLISH, SUBCODES, authorized, fetchMedia, flagOf, graphError, igTime, imageFormat, invalidParam, isCaller, jpegFacts, keep, mediaView, mp4Facts, paged, paramsOf, seconds, selection, settled, text, unsupported, userView, type Row } from './shared.ts';

// source: https://developers.facebook.com/documentation/instagram-platform/reference/me "This endpoint translates to GET /{user-id} , based on the User ID identified by the access token used in the query."
export async function getMe(ctx: HandlerContext): Promise<Response> {
  const c = authorized(ctx);
  if (c instanceof Response) return c;
  // Where the documentation stops: the pages do not list a User's default fields; with none asked, its id
  const fields = selection(ctx, ['id']);
  if (fields instanceof Response) return fields;
  // the IG User reference answers the object itself ("A JSON-formatted object containing default and requested
  // fields"); the Get Started page's example wraps it in a data array, which that reference contradicts
  // source: https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user "A JSON-formatted object containing default and requested fields and edges ."
  const view = userView(ctx, c, fields);
  return view instanceof Response ? view : Response.json(view);
}

// source: https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media "Get all IG Media on an IG User ."
export async function getUserMedia(ctx: HandlerContext): Promise<Response> {
  const c = authorized(ctx);
  if (c instanceof Response) return c;
  const id = String(ctx.params['ig-user-id'] ?? '');
  // an Instagram User access token reaches its own account alone
  if (!isCaller(c, id)) return unsupported(ctx, 'GET', id);
  const fields = selection(ctx, ['id']);
  if (fields instanceof Response) return fields;
  const p = paramsOf(ctx);
  // source: https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media "Include since and until query-string parameters with Unix timestamp or strtotime data values to define a time range."
  const instant = (v: unknown): number | undefined => {
    const t = text(v);
    if (t === undefined || t === '') return undefined;
    return /^\d+$/.test(t) ? Number(t) : Number.isFinite(Date.parse(t)) ? seconds(t) : NaN;
  };
  const since = instant(p.since);
  const until = instant(p.until);
  if (Number.isNaN(since) || Number.isNaN(until)) return invalidParam(ctx, '(#100) since and until take a Unix timestamp or a date');
  // newest first: "Returns a maximum of 10K of the most recently created media."
  const rows = ctx.rowsRaw(MEDIA).filter((m) => m.deleted !== true && m._account === c.account.id && (since === undefined || Number(m._published) >= since) && (until === undefined || Number(m._published) <= until)).reverse().slice(0, 10000);
  const items: Array<{ id: string; view: Row }> = [];
  for (const r of rows) {
    const view = mediaView(ctx, r, fields);
    if (view instanceof Response) return view;
    items.push({ id: String(r.id), view });
  }
  // Where the documentation stops: the page names no page size; the Graph API's is 25, at most 100
  return paged(ctx, items, `/${id}/media`, 25, 100);
}

/** What a caption holds: Instagram's limits on its characters, hashtags and @ tags. */
// source: https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media "Maximum 2200 characters, 30 hashtags, and 20 @ tags."
function captionRefusal(ctx: HandlerContext, caption: string | undefined): Response | undefined {
  if (caption === undefined) return undefined;
  // source: https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/error-codes "The user exceeded the maximum amount of characters for a caption."
  if (caption.length > 2200) return graphError(ctx, 400, 36004, `The submitted image's caption was ${caption.length} characters long. The maximum number of characters permitted for a caption is 2200. Please submit media with a shorter caption.`, 2207010);
  const hashtags = caption.match(/#[\p{L}\p{N}_]+/gu)?.length ?? 0;
  const mentions = caption.match(/@[A-Za-z0-9._]+/g)?.length ?? 0;
  // source: https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/error-codes "Cannot use more than {max-tag-count} tags per created media."
  if (mentions > 20) return graphError(ctx, 400, 100, 'Cannot use more than 20 tags per created media.', 2207040);
  if (hashtags > 30) return graphError(ctx, 400, 100, 'Cannot use more than 30 tags per created media.', 2207040);
  return undefined;
}

// source: https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media "Create an image, carousel, story or reel IG Container for use in the post publishing process."
export async function createUserMedia(ctx: HandlerContext): Promise<Response> {
  const c = authorized(ctx, PUBLISH);
  if (c instanceof Response) return c;
  const userId = String(ctx.params['ig-user-id'] ?? '');
  if (!isCaller(c, userId)) return unsupported(ctx, 'POST', userId);
  const p = paramsOf(ctx);
  const type = text(p.media_type);
  // carousels, stories and VIDEO containers are named in the manifest's variants (the gap); any other value is unknown
  // source: https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/error-codes "The media type entered is not one of the expected media types ."
  if (type !== undefined && type !== 'REELS') return graphError(ctx, 400, 100, `The media type ${type} is unknown.`, 2207023);
  const caption = text(p.caption);
  const refusedCaption = captionRefusal(ctx, caption);
  if (refusedCaption) return refusedCaption;
  const reel = type === 'REELS';
  const altText = text(p.alt_text);
  // source: https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media "For image posts only. Alternative text, up to 1000 character, for an image."
  if (altText !== undefined && (reel || altText.length > 1000)) return invalidParam(ctx, reel ? '(#100) alt_text is for image posts only: Reels and stories are not supported' : '(#100) alt_text holds up to 1000 characters');
  const base: Row = { _account: c.account.id, _app: c.app.id, _caption: caption, _is_ai_generated: flagOf(p.is_ai_generated) === true, _created: seconds(ctx.occurredAt) };
  return reel ? reelContainer(ctx, p, base) : imageContainer(ctx, p, { ...base, _alt_text: altText });
}

/** An image container: Instagram fetches the image as the container is made, and refuses it there and then when it
 *  cannot (an image's upload is not the asynchronous one a video's is). */
// source: https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media "Video uploads are asynchronous, so receiving a container ID does not guarantee that the upload was successful."
async function imageContainer(ctx: HandlerContext, p: Row, base: Row): Promise<Response> {
  const url = text(p.image_url);
  // source: https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media "For images only and required for images."
  if (!url) return invalidParam(ctx, '(#100) The parameter image_url is required.');
  const got = await fetchMedia(ctx, url);
  // source: https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/error-codes "The media could not be fetched from this uri: {uri}"
  if (!got) return graphError(ctx, 400, 9004, `The media could not be fetched from this uri: ${url}`, 2207052);
  // source: https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/error-codes "Image exceeded maximum file size of 8MiB."
  if (got.bytes.byteLength > 8 * 1024 * 1024) return graphError(ctx, 400, 36000, 'The image is too large to download. It should be less than 8 MiB.', 2207004);
  // source: https://developers.facebook.com/documentation/instagram-platform/content-publishing "JPEG is the only image format supported."
  const format = imageFormat(got.bytes);
  const facts = format === 'JPEG' ? jpegFacts(got.bytes) : undefined;
  if (!facts) return graphError(ctx, 400, 36001, `The image format ${format === 'unknown' ? 'of this file' : format} is not supported. Supported formats are: JPEG.`, 2207005);
  // source: https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media "Aspect ratio: Must be within a 4:5 to 1.91:1 range"
  const ratio = facts.width / facts.height;
  if (ratio < 0.8 || ratio > 1.91) return graphError(ctx, 400, 36003, `The submitted image with aspect ratio ${facts.width}:${facts.height} cannot be published. Please submit an image with a valid aspect ratio.`, 2207009);
  const digest = await keep(ctx, got.bytes);
  const id = ctx.mint(CONTAINER);
  await ctx.write(CONTAINER, id, { id, status_code: 'IN_PROGRESS', status: 'IN_PROGRESS', ...base, _media_type: 'IMAGE', _url: url, _sha256: digest, _content_type: 'image/jpeg', _width: facts.width, _height: facts.height }, 'createUserMedia');
  const refused = ctx.legal(CONTAINER, 'status_code', 'createUserMedia', 'IN_PROGRESS', 'FINISHED', id, 'vendor');
  if (refused) throw new Error(refused.message);
  await ctx.write(CONTAINER, id, { status_code: 'FINISHED', status: 'FINISHED' }, 'createUserMedia');
  return Response.json({ id });
}

/** A Reel's container: made IN_PROGRESS, then Instagram fetches the video (and the cover, when named) and the
 *  container is FINISHED, or ERROR with the subcode of what failed in `status`. */
// source: https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-container "If status_code is ERROR , this value will be an error subcode ."
async function reelContainer(ctx: HandlerContext, p: Row, base: Row): Promise<Response> {
  const url = text(p.video_url);
  // source: https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media "Required for videos and reels."
  if (!url) return invalidParam(ctx, '(#100) The parameter video_url is required.');
  const offsetGiven = text(p.thumb_offset);
  const offset = offsetGiven === undefined ? undefined : Number(offsetGiven);
  const id = ctx.mint(CONTAINER);
  // source: https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media "When true , indicates that the reel can appear in both the Feed and Reels tabs."
  // Where the documentation stops: the page gives share_to_feed no default; a reel left without it is shared, as the app's
  const share = flagOf(p.share_to_feed) ?? true;
  await ctx.write(CONTAINER, id, { id, status_code: 'IN_PROGRESS', status: 'IN_PROGRESS', ...base, _media_type: 'REELS', _url: url, _share_to_feed: share, ...(offset !== undefined ? { _thumb_offset: offset } : {}), ...(text(p.cover_url) ? { _cover_url: text(p.cover_url) } : {}) }, 'createUserMedia');
  let failure: number | undefined;
  const kept: Row = {};
  const got = await fetchMedia(ctx, url);
  if (!got) failure = 2207052;
  else {
    const facts = mp4Facts(got.bytes);
    // source: https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media "Container: MOV or MP4 (MPEG-4 Part 14), no edit lists, moov atom at the front of the file."
    // source: https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media "Duration: 15 mins maximum, 3 seconds minimum"
    // source: https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media "File size: 300MB maximum"
    // source: https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/error-codes "Unsupported video format. Advise the app user to upload an MOV or MP4 (MPEG-4 Part 14)."
    const duration = facts.durationSeconds;
    if (!facts.isMp4 || got.bytes.byteLength > 300 * 1024 * 1024 || (duration !== undefined && (duration < 3 || duration > 900))) failure = 2207026;
    // source: https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/error-codes "Thumbnail offset must be greater than or equal to 0 and less than video duration"
    else if (offset !== undefined && (!Number.isFinite(offset) || offset < 0 || (duration !== undefined && offset >= duration * 1000))) failure = 2207057;
    else {
      kept._sha256 = await keep(ctx, got.bytes);
      kept._content_type = 'video/mp4';
      if (duration !== undefined) kept._duration = duration;
    }
  }
  // source: https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media "We will cURL the image using the URL that you specify so the image must be on a public server."
  const coverUrl = text(p.cover_url);
  if (failure === undefined && coverUrl) {
    const cover = await fetchMedia(ctx, coverUrl);
    if (!cover) failure = 2207052;
    else if (imageFormat(cover.bytes) !== 'JPEG') failure = 2207005;
    else kept._cover_sha256 = await keep(ctx, cover.bytes);
  }
  const to = failure === undefined ? 'FINISHED' : 'ERROR';
  const refused = ctx.legal(CONTAINER, 'status_code', 'createUserMedia', 'IN_PROGRESS', to, id, 'vendor');
  if (refused) throw new Error(refused.message);
  await ctx.write(CONTAINER, id, { status_code: to, status: failure === undefined ? 'FINISHED' : String(failure), ...kept }, 'createUserMedia');
  return Response.json({ id });
}

/** The account's posts published in the 24 hours before `now` (or since `since`). */
const publishedSince = (ctx: HandlerContext, account: unknown, since: number): number =>
  ctx.rowsRaw(MEDIA).filter((m) => m.deleted !== true && m._account === account && Number(m._published) >= since).length;

// source: https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media_publish "Publish an IG Container object on an Instagram Business IG User ."
export async function publishUserMedia(ctx: HandlerContext): Promise<Response> {
  const c = authorized(ctx, PUBLISH);
  if (c instanceof Response) return c;
  const userId = String(ctx.params['ig-user-id'] ?? '');
  if (!isCaller(c, userId)) return unsupported(ctx, 'POST', userId);
  const creation = text(paramsOf(ctx).creation_id);
  // source: https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media_publish "The ID of the IG Container to be published."
  if (!creation) return invalidParam(ctx, '(#100) The parameter creation_id is required.');
  const held = ctx.row(CONTAINER, creation);
  // source: https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/error-codes "The media builder with creation id = {creation-id} does not exist or has been expired."
  if (!held || held.deleted === true || held._account !== c.account.id) return graphError(ctx, 400, 24, `The media builder with creation id = ${creation} does not exist or has been expired.`, 2207008);
  const row = await settled(ctx, held);
  const refused = ctx.legal(CONTAINER, 'status_code', 'publishUserMedia', row.status_code, 'PUBLISHED', creation);
  if (refused) return graphError(ctx, refused.status, Number(refused.code), refused.message, SUBCODES[String(refused.code)]);
  // source: https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/error-codes "You reached maximum number of posts that is allowed to be published by Content Publishing API."
  // the content publishing guide names 100 posts; media_publish's page and the publishing limit's own answer (quota_total,
  // "currently 50") name 50, which the twin enforces
  if (publishedSince(ctx, c.account.id, seconds(ctx.occurredAt) - 86400) >= 50) return graphError(ctx, 400, 9, 'You reached maximum number of posts that is allowed to be published by Content Publishing API.', 2207042);
  const mediaId = ctx.mint(MEDIA);
  const reel = row._media_type === 'REELS';
  const shortcode = ctx.crypto.base62From(`instagram-shortcode:${mediaId}`, 11);
  const fields: Row = {
    id: mediaId, media_type: reel ? 'VIDEO' : 'IMAGE',
    // source: https://developers.facebook.com/documentation/instagram-platform/content-publishing "If you publish a reel and then request its media_type field, the value returned is VIDEO ."
    media_product_type: reel ? 'REELS' : 'FEED',
    media_url: `${CDN}/v/t51.2885-15/${mediaId}_n.${reel ? 'mp4' : 'jpg'}`,
    permalink: `https://www.instagram.com/${reel ? 'reel' : 'p'}/${shortcode}/`, shortcode,
    timestamp: igTime(ctx.occurredAt), username: c.account.username, like_count: 0, is_comment_enabled: true, is_ai_generated: row._is_ai_generated === true,
    ...(typeof row._caption === 'string' ? { caption: row._caption } : {}),
    ...(reel ? { thumbnail_url: `${CDN}/v/t51.2885-15/${mediaId}_thumb.jpg`, is_shared_to_feed: row._share_to_feed !== false } : {}),
    ...(typeof row._alt_text === 'string' ? { alt_text: row._alt_text } : {}),
    _account: c.account.id, _container: creation, _sha256: row._sha256, _content_type: row._content_type, ...(row._cover_sha256 ? { _cover_sha256: row._cover_sha256 } : {}),
    _published: seconds(ctx.occurredAt), _views: 0, _reach: 0, _saved: 0, _shares: 0,
  };
  await ctx.write(MEDIA, mediaId, fields, 'publishUserMedia');
  await ctx.write(CONTAINER, creation, { status_code: 'PUBLISHED', status: 'PUBLISHED', _media: mediaId }, 'publishUserMedia');
  // source: https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media_publish "The ID of the published media. Always returned."
  return Response.json({ id: mediaId });
}

// source: https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/content_publishing_limit "Get the number of times an IG User has published and IG Container within a given time period."
export async function getContentPublishingLimit(ctx: HandlerContext): Promise<Response> {
  const c = authorized(ctx, PUBLISH);
  if (c instanceof Response) return c;
  const userId = String(ctx.params['ig-user-id'] ?? '');
  if (!isCaller(c, userId)) return unsupported(ctx, 'GET', userId);
  const p = paramsOf(ctx);
  const now = seconds(ctx.occurredAt);
  const sinceGiven = text(p.since);
  // source: https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/content_publishing_limit "A Unix timestamp no older than 24 hours."
  if (sinceGiven !== undefined && (!/^\d+$/.test(sinceGiven) || now - Number(sinceGiven) > 86400)) return invalidParam(ctx, '(#100) since must be a Unix timestamp no older than 24 hours');
  // source: https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/content_publishing_limit "If omitted, the quota_usage field will be returned by default."
  const names = (text(p.fields) ?? 'quota_usage').split(',').map((f) => f.trim()).filter(Boolean);
  // the page's own example asks quota_usage,rate_limit_settings and is answered config beside quota_usage
  const unknown = names.find((n) => !['quota_usage', 'config', 'rate_limit_settings'].includes(n));
  if (unknown) return invalidParam(ctx, `(#100) Tried accessing nonexisting field (${unknown}) on node type (ContentPublishingLimit)`);
  const row: Row = {};
  // source: https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/content_publishing_limit "If the since parameter is omitted, this value will be the number of times the app user has published a container within the last 24 hours."
  if (names.includes('quota_usage')) row.quota_usage = publishedSince(ctx, c.account.id, sinceGiven === undefined ? now - 86400 : Number(sinceGiven));
  // source: https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/content_publishing_limit "currently 86400 seconds, or 24 hours"
  if (names.includes('config') || names.includes('rate_limit_settings')) row.config = { quota_total: 50, quota_duration: 86400 };
  return Response.json({ data: [row] });
}
