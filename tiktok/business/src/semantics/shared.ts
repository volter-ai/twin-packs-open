// What every family of the business lane shares beyond the vendor's (../../../src/semantics/shared.ts): the API for
// Business's envelope (`{code, message, request_id, data}`, a refusal a non-zero code at HTTP 200) and who a request is
// (its Access-Token, a business app's, and the business_id it names).
import type { HandlerContext } from '@volter/world-core';
import { ACCESS, ACCESS_TTL, APP, CODE, PERSON, PUBLISH, REFRESH, REFRESH_TTL, VIDEO, bodyOf, bySha, clientSecret, credential, mediaUrl, next, openIdOf, privacyOptions, seconds, type Row, videoMoment, videoPage } from '../../../src/semantics/shared.ts';

export * from '../../../src/semantics/shared.ts';
export type { HandlerContext };

/** A request's id, as the API answers it. */
const requestId = (ctx: Pick<HandlerContext, 'crypto' | 'occurredAt'>, what: string): string =>
  `${ctx.occurredAt.replace(/\D/g, '').slice(0, 14)}${ctx.crypto.digest('sha256', `${ctx.occurredAt}:business:${what}`, 'hex').slice(0, 18).toUpperCase()}`;
// source: https://business-api.tiktok.com/gateway/api/doc/client/node/get/v2/?identify_key=c0138ffadd90a955c1f0670a56fe348d1d40680b3c89461e09f78ed26785164b&doc_id=1737172488964097&language=ENGLISH "Successful"
export const ok = (ctx: Pick<HandlerContext, 'crypto' | 'occurredAt'>, data: unknown): Response =>
  Response.json({ code: 0, message: 'OK', request_id: requestId(ctx, JSON.stringify(data)), data });
/** A refusal: its code and message, at HTTP 200. */
export const refuse = (ctx: Pick<HandlerContext, 'crypto' | 'occurredAt'>, code: number, message: string): Response =>
  Response.json({ code, message, request_id: requestId(ctx, `${code}:${message}`), data: {} });

// the codes the lane answers (Appendix - Return codes)
export const PARAM = 40002;
export const NO_PERMISSION = 40001;

/** Who a request is: the business access token its Access-Token header bears, live, with its app and its person. */
type Caller = { token: Row; app: Row; person: Row; scopes: string[]; openId: string };
// source: https://business-api.tiktok.com/gateway/api/doc/client/node/get/v2/?identify_key=c0138ffadd90a955c1f0670a56fe348d1d40680b3c89461e09f78ed26785164b&doc_id=1737172488964097&language=ENGLISH "Invalid or incorrect access token."
export function authorized(ctx: HandlerContext, scope?: string): Caller | Response {
  const value = ctx.call.request.headers.get('access-token') ?? '';
  // source: https://business-api.tiktok.com/gateway/api/doc/client/node/get/v2/?identify_key=c0138ffadd90a955c1f0670a56fe348d1d40680b3c89461e09f78ed26785164b&doc_id=1737172488964097&language=ENGLISH "The access token is empty."
  if (!value) return refuse(ctx, 40104, 'The access token is empty.');
  const token = bySha(ctx, ACCESS, value);
  if (!token || token.kind !== 'business' || token.revoked === true) return refuse(ctx, 40105, 'Invalid or incorrect access token.');
  // source: https://business-api.tiktok.com/gateway/api/doc/client/node/get/v2/?identify_key=c0138ffadd90a955c1f0670a56fe348d1d40680b3c89461e09f78ed26785164b&doc_id=1737172488964097&language=ENGLISH "The access token has expired."
  if (Number(token.expires_at) <= seconds(ctx.occurredAt)) return refuse(ctx, 40102, 'The access token has expired.');
  const app = ctx.row(APP, String(token.app))!;
  const person = ctx.row(PERSON, String(token.person))!;
  const openId = openIdOf(ctx, app, person);
  const businessId = String(ctx.params.business_id ?? '');
  // source: https://business-api.tiktok.com/gateway/api/doc/client/node/get/v2/?identify_key=c0138ffadd90a955c1f0670a56fe348d1d40680b3c89461e09f78ed26785164b&doc_id=1737172488964097&language=ENGLISH "No permission to perform the related operation."
  if (businessId !== openId) return refuse(ctx, NO_PERMISSION, 'No permission to operate this TikTok account: business_id is not the access token\'s.');
  const scopes = String(token.scope).split(',');
  if (scope && !scopes.includes(scope)) return refuse(ctx, NO_PERMISSION, `No permission: the TikTok account did not grant ${scope}.`);
  return { token, app, person, scopes, openId };
}

/** A JSON-array query parameter (`fields`, as a client sends it), or the refusal. */
export function jsonArray(ctx: HandlerContext, name: string): string[] | undefined | Response {
  const raw = new URL(ctx.call.request.url).searchParams.get(name);
  if (raw === null) return undefined;
  try {
    const v = JSON.parse(raw) as unknown;
    if (Array.isArray(v) && v.every((x) => typeof x === 'string')) return v as string[];
  } catch { /* the refusal below */ }
  return refuse(ctx, PARAM, `${name} must be a JSON array of strings.`);
}

export async function appOf(ctx: HandlerContext): Promise<Row | Response> {
  const b = bodyOf(ctx);
  const app = ctx.rowsRaw(APP).find((a) => a.deleted !== true && a.kind === 'business' && a.client_key === b.client_id);
  // source: https://business-api.tiktok.com/gateway/api/doc/client/node/get/v2/?identify_key=c0138ffadd90a955c1f0670a56fe348d1d40680b3c89461e09f78ed26785164b&doc_id=1737172488964097&language=ENGLISH "App ID or secret is incorrect."
  if (!app || typeof b.client_secret !== 'string' || !b.client_secret || b.client_secret !== await clientSecret(ctx, app)) return refuse(ctx, 40131, 'App ID or secret is incorrect.');
  return app;
}

export async function issue(ctx: HandlerContext, app: Row, person: Row, scope: string): Promise<Response> {
  const now = seconds(ctx.occurredAt);
  const access = await credential(ctx, ACCESS, 'act', { kind: 'business', app: app.id, person: person.id, scope, expires_at: now + ACCESS_TTL, revoked: false });
  const refresh = await credential(ctx, REFRESH, 'rft', { kind: 'business', app: app.id, person: person.id, scope, access: access.id, expires_at: now + REFRESH_TTL, used: false });
  return ok(ctx, { access_token: access.value, token_type: 'Bearer', scope, expires_in: ACCESS_TTL, refresh_token: refresh.value, refresh_token_expires_in: REFRESH_TTL, open_id: openIdOf(ctx, app, person) });
}

// source: https://business-api.tiktok.com/gateway/api/doc/client/node/get/v2/?identify_key=c0138ffadd90a955c1f0670a56fe348d1d40680b3c89461e09f78ed26785164b&doc_id=1762228399168514&language=ENGLISH "Requested fields. If not set, returns the"
export const DEFAULT = ['display_name', 'profile_image'];

export const profileFields = ['display_name', 'profile_image', 'username', 'profile_deep_link', 'bio_description', 'is_verified', 'followers_count', 'following_count', 'total_likes', 'videos_count'];

export const postsFields = ['item_id', 'create_time', 'thumbnail_url', 'share_url', 'embed_url', 'caption', 'video_duration', 'likes', 'comments', 'shares', 'video_views'];

export const publishObj = (v: unknown): Row => (v && typeof v === 'object' && !Array.isArray(v) ? v as Row : {});

/** Pull each URL through the World; the bytes pulled, or undefined when one fails. */
export async function pullAll(ctx: HandlerContext, urls: string[]): Promise<number | undefined> {
  let n = 0;
  for (const url of urls) {
    try {
      const r = await ctx.vendorFetch(url, { method: 'GET' });
      if (!r.ok) return undefined;
      n += (await r.arrayBuffer()).byteLength;
    } catch { return undefined; }
  }
  return n;
}

/** The video a completed pull makes (the Video Object, as the open lane makes them), public; its id. */
export async function madeVideo(ctx: HandlerContext, publishId: string, post: Row, person: Row): Promise<string> {
  const videoId = String(7_400_000_000_000_000_000 + (await next(ctx, 'video')) * 1024);
  const caption = typeof post.caption === 'string' ? post.caption : '';
  await ctx.write(VIDEO, videoId, {
    id: videoId, create_time: seconds(ctx.occurredAt), _moment: videoMoment(ctx, String(person.id)), cover_image_url: mediaUrl(ctx, `cover-${videoId}`), share_url: `https://www.tiktok.com/@${String(person.username)}/video/${videoId}`,
    video_description: caption.slice(0, 150), duration: 0, height: 0, width: 0, title: caption.slice(0, 150),
    embed_html: `<blockquote class="tiktok-embed" cite="https://www.tiktok.com/@${String(person.username)}/video/${videoId}" data-video-id="${videoId}"></blockquote>`,
    embed_link: `https://www.tiktok.com/player/v1/${videoId}`, like_count: 0, comment_count: 0, share_count: 0, view_count: 0, is_aigc: post.is_ai_generated === true,
    _person: person.id, _public: true, _publish: publishId,
  }, 'video.publish');
  return videoId;
}

export async function publish(ctx: HandlerContext, media: 'VIDEO' | 'PHOTO', urls: string[], post: Row, draft: boolean, person: Row): Promise<Response> {
  const n = await next(ctx, 'publish');
  const id = `${media === 'VIDEO' ? 'v' : 'p'}_pub_url~v2.${n}`;
  await ctx.write(PUBLISH, id, { status: 'PROCESSING_DOWNLOAD', post_ids: [], _person: person.id, _media: media, _urls: urls, _post_info: post, _draft: draft, _lane: 'business' }, media === 'VIDEO' ? 'businessVideoPublish' : 'businessPhotoPublish');
  const pulled = await pullAll(ctx, urls);
  const to = pulled === undefined ? 'FAILED' : draft ? 'SEND_TO_USER_INBOX' : 'PUBLISH_COMPLETE';
  const refused = ctx.legal(PUBLISH, 'status', 'publish.pull', 'PROCESSING_DOWNLOAD', to, id, 'vendor');
  if (refused) throw new Error(refused.message);
  const postIds = to === 'PUBLISH_COMPLETE' && media === 'VIDEO' ? [await madeVideo(ctx, id, post, person)] : [];
  await ctx.write(PUBLISH, id, { status: to, post_ids: postIds, ...(to === 'FAILED' ? { reason: media === 'VIDEO' ? 'video_pull_failed' : 'photo_pull_failed' } : {}) }, 'publish.pull');
  return ok(ctx, { share_id: id });
}
