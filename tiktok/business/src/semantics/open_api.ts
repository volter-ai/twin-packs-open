import type { HandlerContext } from '@volter/world-core';
import { CODE, DEFAULT, NO_PERMISSION, PARAM, PERSON, PUBLISH, REFRESH, VIDEO, appOf, authorized, bodyOf, bySha, issue, jsonArray, mediaUrl, ok, postsFields, privacyOptions, profileFields, publish, publishObj, refuse, seconds, type Row, videoPage } from './shared.ts';

// source: https://business-api.tiktok.com/gateway/api/doc/client/node/get/v2/?identify_key=c0138ffadd90a955c1f0670a56fe348d1d40680b3c89461e09f78ed26785164b&doc_id=1738084387220481&language=ENGLISH "The code is valid for 10 minutes and can only be used once."
export async function ttUserOauth2Token(ctx: HandlerContext): Promise<Response> {
  const app = await appOf(ctx);
  if (app instanceof Response) return app;
  const b = bodyOf(ctx);
  if (b.grant_type !== 'authorization_code') return refuse(ctx, PARAM, 'grant_type must be authorization_code.');
  const code = typeof b.auth_code === 'string' ? bySha(ctx, CODE, b.auth_code) : undefined;
  // source: https://business-api.tiktok.com/gateway/api/doc/client/node/get/v2/?identify_key=c0138ffadd90a955c1f0670a56fe348d1d40680b3c89461e09f78ed26785164b&doc_id=1737172488964097&language=ENGLISH "Invalid authorization code."
  if (!code || code.used === true || code.app !== app.id || Number(code.expires_at) <= seconds(ctx.occurredAt)) return refuse(ctx, 40110, 'Invalid authorization code. The auth_code is canceled, already used or expired.');
  if (typeof b.redirect_uri === 'string' && b.redirect_uri !== code.redirect_uri) return refuse(ctx, PARAM, 'redirect_uri does not match the one the code was issued for.');
  await ctx.record(CODE, { ...code, used: true }, String(code.id));
  return issue(ctx, app, ctx.row(PERSON, String(code.person))!, String(code.scope));
}

// source: https://business-api.tiktok.com/gateway/api/doc/client/node/get/v2/?identify_key=c0138ffadd90a955c1f0670a56fe348d1d40680b3c89461e09f78ed26785164b&doc_id=1738084387220481&language=ENGLISH "Use this endpoint to renew a TikTok account access token by"
export async function ttUserOauth2RefreshToken(ctx: HandlerContext): Promise<Response> {
  const app = await appOf(ctx);
  if (app instanceof Response) return app;
  const b = bodyOf(ctx);
  if (b.grant_type !== 'refresh_token') return refuse(ctx, PARAM, 'grant_type must be refresh_token.');
  const held = typeof b.refresh_token === 'string' ? bySha(ctx, REFRESH, b.refresh_token) : undefined;
  // source: https://business-api.tiktok.com/gateway/api/doc/client/node/get/v2/?identify_key=c0138ffadd90a955c1f0670a56fe348d1d40680b3c89461e09f78ed26785164b&doc_id=1737172488964097&language=ENGLISH "Invalid or incorrect refresh token."
  if (!held || held.used === true || held.kind !== 'business' || held.app !== app.id || Number(held.expires_at) <= seconds(ctx.occurredAt)) return refuse(ctx, 40107, 'Invalid or incorrect refresh token.');
  await ctx.record(REFRESH, { ...held, used: true }, String(held.id));
  return issue(ctx, app, ctx.row(PERSON, String(held.person))!, String(held.scope));
}

// source: https://business-api.tiktok.com/gateway/api/doc/client/node/get/v2/?identify_key=c0138ffadd90a955c1f0670a56fe348d1d40680b3c89461e09f78ed26785164b&doc_id=1762228399168514&language=ENGLISH "Use this endpoint to access detailed analytics and insights about a TikTok account"
export async function businessGet(ctx: HandlerContext): Promise<Response> {
  const c = authorized(ctx);
  if (c instanceof Response) return c;
  const asked = jsonArray(ctx, 'fields');
  if (asked instanceof Response) return asked;
  const fields = asked ?? DEFAULT;
  const unknown = fields.filter((f) => !profileFields.includes(f));
  if (unknown.length) return refuse(ctx, PARAM, `Invalid fields: ${unknown.join(', ')}`);
  const p = c.person;
  const all: Row = {
    display_name: p.display_name, profile_image: mediaUrl(ctx, `avatar-${String(p.id)}`), username: p.username, profile_deep_link: `https://www.tiktok.com/@${String(p.username)}`,
    bio_description: p.bio_description ?? '', is_verified: p.is_verified === true, followers_count: Number(p.follower_count ?? 0), following_count: Number(p.following_count ?? 0),
    total_likes: Number(p.likes_count ?? 0),
    // the account's public videos, counted from the set
    videos_count: ctx.rowsRaw(VIDEO).filter((v) => v.deleted !== true && v._person === p.id && v._public === true).length,
  };
  return ok(ctx, Object.fromEntries(fields.map((f) => [f, all[f]])));
}

// source: https://business-api.tiktok.com/gateway/api/doc/client/node/get/v2/?identify_key=c0138ffadd90a955c1f0670a56fe348d1d40680b3c89461e09f78ed26785164b&doc_id=1762228421622786&language=ENGLISH "you need to at least include"
export async function businessVideoList(ctx: HandlerContext): Promise<Response> {
  const c = authorized(ctx);
  if (c instanceof Response) return c;
  const asked = jsonArray(ctx, 'fields');
  if (asked instanceof Response) return asked;
  const fields = asked ?? ['item_id'];
  if (!fields.includes('item_id') || fields.some((f) => !postsFields.includes(f))) return refuse(ctx, PARAM, 'fields must include item_id and name only the supported fields.');
  const q = new URL(ctx.call.request.url).searchParams;
  // source: https://business-api.tiktok.com/gateway/api/doc/client/node/get/v2/?identify_key=c0138ffadd90a955c1f0670a56fe348d1d40680b3c89461e09f78ed26785164b&doc_id=1762228421622786&language=ENGLISH "Maximum value"
  const max = q.get('max_count') === null ? 10 : Number(q.get('max_count'));
  if (!Number.isInteger(max) || max < 1 || max > 20) return refuse(ctx, PARAM, 'max_count must be between 1 and 20.');
  const cursor = q.get('cursor') === null ? Infinity : Number(q.get('cursor'));
  const { page, cursor: after, more } = videoPage(ctx, String(c.person.id), cursor, max);
  const post = (v: Row): Row => {
    const all: Row = {
      item_id: v.id, create_time: v.create_time, thumbnail_url: v.cover_image_url, share_url: v.share_url, embed_url: v.embed_link, caption: v.video_description,
      video_duration: v.duration, likes: v.like_count, comments: v.comment_count, shares: v.share_count, video_views: v.view_count,
    };
    return Object.fromEntries(fields.map((f) => [f, all[f]]));
  };
  return ok(ctx, { videos: page.map(post), cursor: after, has_more: more });
}

// source: https://business-api.tiktok.com/gateway/api/doc/client/node/get/v2/?identify_key=c0138ffadd90a955c1f0670a56fe348d1d40680b3c89461e09f78ed26785164b&doc_id=1762228496095234&language=ENGLISH "This field is required, even if you don't want to use any of the additional parameters"
export async function businessVideoPublish(ctx: HandlerContext): Promise<Response> {
  const c = authorized(ctx, 'video.publish');
  if (c instanceof Response) return c;
  const b = bodyOf(ctx);
  if (typeof b.video_url !== 'string' || !/^https?:\/\//.test(b.video_url)) return refuse(ctx, PARAM, 'video_url must be an http(s) URL.');
  if (b.post_info === undefined || typeof b.post_info !== 'object') return refuse(ctx, PARAM, 'post_info is required.');
  const post = publishObj(b.post_info);
  if (typeof post.is_brand_organic !== 'boolean' || typeof post.is_branded_content !== 'boolean') return refuse(ctx, PARAM, 'post_info.is_brand_organic and post_info.is_branded_content are required.');
  return publish(ctx, 'VIDEO', [b.video_url], post, post.upload_to_draft === true, c.person);
}

// source: https://business-api.tiktok.com/gateway/api/doc/client/node/get/v2/?identify_key=c0138ffadd90a955c1f0670a56fe348d1d40680b3c89461e09f78ed26785164b&doc_id=1803630424390658&language=ENGLISH "A list of up to 35 publicly accessible HTTP(s) URLs for the photo content to be published."
export async function businessPhotoPublish(ctx: HandlerContext): Promise<Response> {
  const c = authorized(ctx, 'video.publish');
  if (c instanceof Response) return c;
  const b = bodyOf(ctx);
  const images = Array.isArray(b.photo_images) ? (b.photo_images as unknown[]).map(String) : [];
  if (images.length < 1 || images.length > 35) return refuse(ctx, PARAM, 'photo_images must hold 1 to 35 URLs.');
  const cover = Number(b.photo_cover_index ?? 0);
  if (!Number.isInteger(cover) || cover < 0 || cover >= images.length) return refuse(ctx, PARAM, 'photo_cover_index must index photo_images.');
  const post = publishObj(b.post_info);
  const draft = post.is_draft === true;
  if (typeof post.is_brand_organic !== 'boolean' || typeof post.is_branded_content !== 'boolean') return refuse(ctx, PARAM, 'post_info.is_brand_organic and post_info.is_branded_content are required.');
  // source: https://business-api.tiktok.com/gateway/api/doc/client/node/get/v2/?identify_key=c0138ffadd90a955c1f0670a56fe348d1d40680b3c89461e09f78ed26785164b&doc_id=1803630424390658&language=ENGLISH "Length limit: 90 runes (UTF-16 code units)."
  if (typeof post.title === 'string' && post.title.length > 90) return refuse(ctx, PARAM, 'post_info.title is over 90 characters.');
  if (!draft && !privacyOptions(c.person).includes(String(post.privacy_level))) return refuse(ctx, PARAM, 'post_info.privacy_level must be one of the account\'s privacy levels.');
  return publish(ctx, 'PHOTO', images, post, draft, c.person);
}

// source: https://business-api.tiktok.com/gateway/api/doc/client/node/get/v2/?identify_key=c0138ffadd90a955c1f0670a56fe348d1d40680b3c89461e09f78ed26785164b&doc_id=1816387106635778&language=ENGLISH "The publishing status of the TikTok post."
// post_ids are "Returned only when" the status is PUBLISH_COMPLETE, the reason when FAILED
// source: https://business-api.tiktok.com/gateway/api/doc/client/node/get/v2/?identify_key=c0138ffadd90a955c1f0670a56fe348d1d40680b3c89461e09f78ed26785164b&doc_id=1816387106635778&language=ENGLISH "Returned only when"
export async function businessPublishStatus(ctx: HandlerContext): Promise<Response> {
  const c = authorized(ctx);
  if (c instanceof Response) return c;
  const id = String(ctx.params.publish_id ?? '');
  const p = ctx.row(PUBLISH, id);
  if (!p || p.deleted === true) return refuse(ctx, PARAM, 'publish_id does not exist.');
  if (p._person !== c.person.id) return refuse(ctx, NO_PERMISSION, 'No permission to read this publishing task.');
  return ok(ctx, { status: p.status, ...(p.status === 'PUBLISH_COMPLETE' ? { post_ids: p.post_ids ?? [] } : {}), ...(p.status === 'FAILED' ? { reason: p.reason } : {}) });
}

// source: https://business-api.tiktok.com/gateway/api/doc/client/node/get/v2/?identify_key=c0138ffadd90a955c1f0670a56fe348d1d40680b3c89461e09f78ed26785164b&doc_id=1870580030749698&language=ENGLISH "Length limit: 100 characters."
export async function businessPublishLocation(ctx: HandlerContext): Promise<Response> {
  const c = authorized(ctx);
  if (c instanceof Response) return c;
  const q = String(ctx.params.search_query ?? '');
  if (!q || q.length > 100) return refuse(ctx, PARAM, 'search_query must be 1 to 100 characters.');
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const found = ctx.rowsRaw('_location').filter((l) => words.every((w) => `${String(l.location_name)} ${String(l.location_address)}`.toLowerCase().includes(w)));
  return ok(ctx, { locations: found.map((l) => ({ location_id: l.id, location_name: l.location_name, location_address: l.location_address })) });
}

// source: https://business-api.tiktok.com/gateway/api/doc/client/node/get/v2/?identify_key=c0138ffadd90a955c1f0670a56fe348d1d40680b3c89461e09f78ed26785164b&doc_id=1825119063013505&language=ENGLISH "Commercial Music Library"
export async function discoveryCmlTrendingList(ctx: HandlerContext): Promise<Response> {
  const c = authorized(ctx);
  if (c instanceof Response) return c;
  // source: https://business-api.tiktok.com/gateway/api/doc/client/node/get/v2/?identify_key=c0138ffadd90a955c1f0670a56fe348d1d40680b3c89461e09f78ed26785164b&doc_id=1825119063013505&language=ENGLISH "Default value"
  const genre = typeof ctx.params.genre === 'string' && ctx.params.genre.toUpperCase() !== 'ALL' ? ctx.params.genre.toUpperCase() : undefined;
  const tracks = ctx.rowsRaw('_track').filter((t) => !genre || t.genre === genre);
  return ok(ctx, {
    list: tracks.map((t) => ({
      commercial_music_id: t.id, commercial_music_name: t.name, artist: t.artist, thumbnail_url: t.thumbnail_url, duration: t.duration, preview_url: t.preview_url, genre: t.genre,
      full_duration_song_clip: { song_clip_id: t.song_clip_id, duration: t.duration, preview_url: t.preview_url },
    })),
  });
}
