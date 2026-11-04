// The upload URLs LinkedIn answers on www.linkedin.com: a video's parts (its upload instructions' URLs, which carry
// their own authorization and take no OAuth token), an image's bytes (which take the caller's OAuth token as well),
// and a video's thumbnail.
import type { HandlerContext } from '@volter/world-core';
import { bytesOf, callerOf, IMAGE, imageForbidden, imageVerdict, keep, mayUploadImage, putImage, putVideoPart, queryOf, refuse, uploadOf, VIDEO } from './shared.ts';

/** PUT /dms-uploads/{asset}/uploadedVideo?sau=: one part's bytes, answered 200 with its ETag. */
export async function uploadVideoPart(ctx: HandlerContext): Promise<Response> {
  const etag = await putVideoPart(ctx, String(ctx.call.params.asset), queryOf(ctx, 'sau'), await bytesOf(ctx));
  if (etag instanceof Response) return etag;
  // source: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/videos-api?view=li-lms-2026-09 "A successful response returns a 200 OK status code."
  return new Response(null, { status: 200, headers: { etag, 'content-length': '0' } });
}

/** PUT /dms-uploads/{asset}/uploaded-image/0?ut=: the image's bytes, answered 201. */
export async function uploadImage(ctx: HandlerContext): Promise<Response> {
  // source: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/vector-asset-api?view=li-lms-2026-09 "The upload call requires a valid OAuth token in the 'Authorization' header."
  const who = callerOf(ctx);
  if (who instanceof Response) return who;
  const asset = String(ctx.call.params.asset);
  const image = ctx.row(IMAGE, asset);
  if (!image || String(ctx.call.params.part) !== '0') return refuse(401, 'The upload URL is not valid');
  if (!mayUploadImage(ctx, who, String(image.owner))) return imageForbidden();
  const refused = await putImage(ctx, asset, queryOf(ctx, 'ut'), await bytesOf(ctx));
  if (refused) return refused;
  // source: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/vector-asset-api?view=li-lms-2026-09 "HTTP/2 201"
  return new Response(null, { status: 201 });
}

/** PUT /dms-uploads/{asset}/ads-video-userUploadedThumbnail/0?ut=: the video's thumbnail image, answered 201. */
export async function uploadVideoThumbnail(ctx: HandlerContext): Promise<Response> {
  const asset = String(ctx.call.params.asset);
  const upload = uploadOf(ctx, queryOf(ctx, 'ut'), asset, 'video-thumbnail');
  if (upload instanceof Response) return upload;
  const bytes = await bytesOf(ctx);
  // Where the documentation stops: a thumbnail that is not an image is refused as the documented 400; the words are
  // the twin's
  const verdict = imageVerdict(bytes);
  if (verdict._outcome !== 'AVAILABLE') return refuse(400, 'The thumbnail is not a JPG, GIF or PNG image', 'INVALID_VALUE_FOR_FIELD');
  const digest = await keep(ctx, bytes);
  await ctx.write(VIDEO, asset, { _thumbnail_sha256: digest, _thumbnail_type: verdict._content_type }, 'video.thumbnail');
  // source: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/videos-api?view=li-lms-2026-09 "A successful response returns a 201 Created status code."
  return new Response(null, { status: 201 });
}
