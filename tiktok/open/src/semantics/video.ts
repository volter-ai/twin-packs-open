import type { HandlerContext } from '@volter/world-core';
import { CHUNK, PUBLISH, VIDEO, authorized, fieldsOf, mediaUrl, next, ok, partialChunk, project, publishObj, refuse, seconds, sha256, type Row, videoMoment, videoPage, videosObj } from './shared.ts';
import { mp4Facts } from '../engine/mp4.ts';

// source: https://developers.tiktok.com/doc/tiktok-api-v2-video-list "sorted by"
export async function videoList(ctx: HandlerContext): Promise<Response> {
  const c = authorized(ctx, 'video.list');
  if (c instanceof Response) return c;
  const fields = fieldsOf(ctx);
  if (fields instanceof Response) return fields;
  const b = videosObj(ctx.body);
  // source: https://developers.tiktok.com/doc/tiktok-api-v2-video-list "Default is 10. Maximum is 20."
  const max = b.max_count === undefined ? 10 : Number(b.max_count);
  if (!Number.isInteger(max) || max < 1 || max > 20) return refuse(ctx, 400, 'invalid_params', 'max_count must be between 1 and 20');
  // source: https://developers.tiktok.com/doc/tiktok-api-v2-video-list "the cursor value is a"
  const cursor = b.cursor === undefined ? Infinity : Number(b.cursor);
  const { page, cursor: after, more } = videoPage(ctx, String(c.person.id), cursor, max);
  return ok(ctx, { videos: page.map((v) => project(ctx, v, fields)), cursor: after, has_more: more });
}

// source: https://developers.tiktok.com/doc/tiktok-api-v2-video-query "verifies that the videos belong to the user and returns video details."
export async function videoQuery(ctx: HandlerContext): Promise<Response> {
  const c = authorized(ctx, 'video.list');
  if (c instanceof Response) return c;
  const fields = fieldsOf(ctx);
  if (fields instanceof Response) return fields;
  const ids = Array.isArray(videosObj(videosObj(ctx.body).filters).video_ids) ? (videosObj(videosObj(ctx.body).filters).video_ids as unknown[]).map(String) : [];
  // source: https://developers.tiktok.com/doc/tiktok-api-v2-video-query "Up to 20 video IDs can be included per request."
  if (!ids.length || ids.length > 20) return refuse(ctx, 400, 'invalid_params', 'filters.video_ids must hold 1 to 20 ids');
  const mine = ctx.rowsRaw(VIDEO).filter((v) => v.deleted !== true && v._person === c.person.id && ids.includes(String(v.id)));
  return ok(ctx, { videos: mine.map((v) => project(ctx, v, fields)) });
}

// source: https://developers.tiktok.com/doc/content-posting-api-media-transfer-guide "All parts are uploaded."
export async function uploadVideo(ctx: HandlerContext): Promise<Response> {
  const q = new URL(ctx.call.request.url).searchParams;
  const p = ctx.rowsRaw(PUBLISH).find((x) => x.deleted !== true && x._upload_id === q.get('upload_id'));
  // source: https://developers.tiktok.com/doc/content-posting-api-media-transfer-guide "TikTok cannot find a valid upload task given the"
  if (!p || p._upload_token_sha256 !== sha256(ctx, q.get('upload_token') ?? '')) return new Response(null, { status: 404 });
  // source: https://developers.tiktok.com/doc/content-posting-api-media-transfer-guide "has expired."
  if (Number(p._upload_expires) <= seconds(ctx.occurredAt)) return new Response(null, { status: 403 });
  const size = Number(p._video_size);
  const id = String(p.id);
  // the chunks received are one subject each; the progress is their sum, never a running total
  const received = (): Row[] => ctx.rowsRaw(CHUNK).filter((k) => k.publish === id);
  const uploaded = received().reduce((n, k) => n + Number(k.bytes), 0);
  const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(ctx.call.request.headers.get('content-range') ?? '');
  const bytes = new Uint8Array(await ctx.call.request.clone().arrayBuffer());
  const progress = { 'content-range': `bytes 0-${Math.max(uploaded - 1, 0)}/${size}` };
  if (!range) return new Response(null, { status: 400, headers: progress });
  const [first, last, total] = [Number(range[1]), Number(range[2]), Number(range[3])];
  // source: https://developers.tiktok.com/doc/content-posting-api-media-transfer-guide "does not reflect the actual upload progress."
  if (p.status !== 'PROCESSING_UPLOAD' || first !== uploaded || total !== size) return new Response(null, { status: 416, headers: progress });
  const chunk = Number(p._chunk_size);
  const index = Math.floor(first / chunk);
  const expected = index === Number(p._chunks) - 1 ? size - first : chunk;
  // source: https://developers.tiktok.com/doc/content-posting-api-media-transfer-guide "does not reflect the true byte size of the binary in the request body."
  if (last - first + 1 !== bytes.byteLength || bytes.byteLength !== expected) return new Response(null, { status: 400, headers: progress });
  await ctx.blobs.put(`publish:${id}:${index}`, bytes);
  await ctx.record(CHUNK, { publish: id, index, first, bytes: bytes.byteLength }, `${id}:${index}`);
  const now = received().reduce((n, k) => n + Number(k.bytes), 0);
  if (now < size) return partialChunk(ctx, id, now, size);
  // the last chunk: the whole file is kept, and the post moves
  const parts: Uint8Array[] = [];
  for (let i = 0; i < Number(p._chunks); i++) parts.push((await ctx.blobs.get(`publish:${id}:${i}`)) ?? new Uint8Array(0));
  const whole = new Uint8Array(size);
  let at = 0;
  for (const part of parts) { whole.set(part, at); at += part.byteLength; }
  const direct = p._kind === 'direct';
  const to = direct ? 'PUBLISH_COMPLETE' : 'SEND_TO_USER_INBOX';
  const refused = ctx.legal(PUBLISH, 'status', 'uploadVideo', 'PROCESSING_UPLOAD', to, id, 'vendor');
  if (refused) throw new Error(refused.message);
  const post = publishObj(p._post_info);
  let postIds: number[] = [];
  if (direct) {
    const facts = mp4Facts(whole);
    const n = await next(ctx, 'video');
    const videoId = String(7_400_000_000_000_000_000 + n * 1024);
    const person = ctx.row('_person', String(p._person));
    const isPublic = post.privacy_level === 'PUBLIC_TO_EVERYONE';
    const title = typeof post.title === 'string' ? post.title : '';
    // a video as the Video Object answers it ("Max length: 150" for title and description)
    await ctx.write(VIDEO, videoId, {
      id: videoId, create_time: seconds(ctx.occurredAt), _moment: videoMoment(ctx, String(person?.id ?? p._person)), cover_image_url: mediaUrl(ctx, `cover-${videoId}`), share_url: `https://www.tiktok.com/@${String(person?.username)}/video/${videoId}`,
      video_description: title.slice(0, 150), duration: facts.duration, height: facts.height, width: facts.width, title: title.slice(0, 150),
      embed_html: `<blockquote class="tiktok-embed" cite="https://www.tiktok.com/@${String(person?.username)}/video/${videoId}" data-video-id="${videoId}"></blockquote>`,
      embed_link: `https://www.tiktok.com/player/v1/${videoId}`, like_count: 0, comment_count: 0, share_count: 0, view_count: 0, is_aigc: post.is_aigc === true,
      _person: p._person, _public: isPublic, _publish: id,
    }, 'video.publish');
    // source: https://developers.tiktok.com/doc/content-posting-api-reference-get-video-status "is returned only if the post is published for public viewership"
    if (isPublic) postIds = [Number(videoId)];
  }
  await ctx.write(PUBLISH, id, { status: to, uploaded_bytes: now, publicaly_available_post_id: postIds }, 'uploadVideo');
  await ctx.blobs.put(`publish:${id}`, whole);
  for (let i = 0; i < Number(p._chunks); i++) await ctx.blobs.remove(`publish:${id}:${i}`);
  return new Response(null, { status: 201, headers: { 'content-range': `bytes 0-${now - 1}/${size}` } });
}
