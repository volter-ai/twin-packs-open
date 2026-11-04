import type { HandlerContext } from '@volter/world-core';
import { ACCESS, ACCESS_TTL, APP, CHUNK, CODE, FIELDS, FIELD_SCOPE, MB, PERSON, PUBLISH, REFRESH, REFRESH_TTL, UPLOAD_HOST, VIDEO, appByKey, authorized, bySha, chunkRefusal, clientSecret, credential, fieldsOf, initVideo, invalid, issue, logId, mediaUrl, next, oauthError, ok, openIdOf, partialChunk, pkceRefused, privacyOptions, project, publishObj, pull, refuse, seconds, sha256, type Caller, type Row, unionIdOf, videoMoment, videoPage, videosObj } from './shared.ts';
import { mp4Facts } from '../engine/mp4.ts';

// source: https://developers.tiktok.com/doc/content-posting-api-reference-query-creator-info "This API returns profile and permission information of the current user."
export async function creatorInfoQuery(ctx: HandlerContext): Promise<Response> {
  const c = authorized(ctx, 'video.publish');
  if (c instanceof Response) return c;
  const p = c.person;
  return ok(ctx, {
    creator_avatar_url: mediaUrl(ctx, `avatar-${String(p.id)}`), creator_username: p.username, creator_nickname: p.display_name,
    privacy_level_options: privacyOptions(p), comment_disabled: p.comment_disabled === true,
    // "Returns true if the creator account is private or they set the Duet interaction to "No one""
    duet_disabled: p.private === true || p.duet_disabled === true, stitch_disabled: p.private === true || p.stitch_disabled === true,
    max_video_post_duration_sec: Number(p.max_video_post_duration_sec ?? 180),
  });
}

// source: https://developers.tiktok.com/doc/content-posting-api-reference-direct-post "To directly post a video to users"
export async function videoInit(ctx: HandlerContext): Promise<Response> { return initVideo(ctx, true); }

// source: https://developers.tiktok.com/doc/content-posting-api-reference-upload-video "inbox"
export async function inboxVideoInit(ctx: HandlerContext): Promise<Response> { return initVideo(ctx, false); }

// source: https://developers.tiktok.com/doc/content-posting-api-reference-photo-post "Currently only PHOTO is allowed"
export async function contentInit(ctx: HandlerContext): Promise<Response> {
  const b = publishObj(ctx.body);
  const direct = b.post_mode === 'DIRECT_POST';
  const c = authorized(ctx, direct ? 'video.publish' : 'video.upload');
  if (c instanceof Response) return c;
  if (b.media_type !== 'PHOTO') return invalid(ctx, 'media_type must be PHOTO');
  if (!direct && b.post_mode !== 'MEDIA_UPLOAD') return invalid(ctx, 'post_mode must be DIRECT_POST or MEDIA_UPLOAD');
  const post = publishObj(b.post_info);
  const source = publishObj(b.source_info);
  // source: https://developers.tiktok.com/doc/content-posting-api-reference-photo-post "Only PULL_FROM_URL is allowed"
  if (source.source !== 'PULL_FROM_URL') return invalid(ctx, 'source must be PULL_FROM_URL');
  const images = Array.isArray(source.photo_images) ? (source.photo_images as unknown[]).map(String) : [];
  // source: https://developers.tiktok.com/doc/content-posting-api-reference-photo-post "An array containing up to 35 photo content URLs."
  if (images.length < 1 || images.length > 35) return invalid(ctx, 'photo_images must hold 1 to 35 URLs');
  const cover = Number(source.photo_cover_index ?? 0);
  if (!Number.isInteger(cover) || cover < 0 || cover >= images.length) return invalid(ctx, 'photo_cover_index must index photo_images');
  // source: https://developers.tiktok.com/doc/content-posting-api-reference-photo-post "The maximum length for photo posts is 90 in UTF-16 runes."
  if (typeof post.title === 'string' && post.title.length > 90) return invalid(ctx, 'title is over 90 characters');
  // source: https://developers.tiktok.com/doc/content-posting-api-reference-photo-post "The maximum length for photo posts is 4000 in UTF-16 runes."
  if (typeof post.description === 'string' && post.description.length > 4000) return invalid(ctx, 'description is over 4000 characters');
  if (direct && !privacyOptions(c.person).includes(String(post.privacy_level))) return refuse(ctx, 403, 'privacy_level_option_mismatch', 'privacy_level is not specified or not among the options from the privacy_level_options returned in /publish/creator_info/query/ API.');
  return pull(ctx, c, direct ? 'direct' : 'inbox', 'PHOTO', images, post);
}

// source: https://developers.tiktok.com/doc/content-posting-api-reference-get-video-status "An API endpoint for polling the status of the post."
export async function publishStatusFetch(ctx: HandlerContext): Promise<Response> {
  const c = authorized(ctx, 'video.upload', 'video.publish');
  if (c instanceof Response) return c;
  const id = String(publishObj(ctx.body).publish_id ?? '');
  const p = ctx.row(PUBLISH, id);
  // source: https://developers.tiktok.com/doc/content-posting-api-reference-get-video-status "does not exist"
  if (!p || p.deleted === true) return refuse(ctx, 400, 'invalid_publish_id', 'The publish_id does not exist.');
  if (p._person !== c.person.id || p._app !== c.app.id) return refuse(ctx, 400, 'token_not_authorized_for_specified_publish_id', 'The access_token does not have authorization for the publish_id.');
  return ok(ctx, ctx.get(PUBLISH, id));
}
