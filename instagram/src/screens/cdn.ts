// Instagram's CDN (docs/contributing/architecture.md, "Screens": a content screen): a published media's file at its
// media_url, a reel's thumbnail at its thumbnail_url, and an account's profile picture at its profile_picture_url. A
// media's file is the one Instagram fetched for its container; a reel's thumbnail is the cover it was given, and the
// twin, which decodes no video, answers a placeholder picture for a reel with none, as it does for a profile picture.
import { bytesResponse, type HandlerContext } from '@volter/world-core';
import { ACCOUNT, MEDIA, profilePicture } from '../semantics/shared.ts';

const PATH = /^\/v\/t51\.2885-(15|19)\/(\d+)_(n|thumb|profile)\.(jpg|png|mp4)$/;
const notFound = (): Response => new Response('Not Found', { status: 404 });

// source: https://developers.facebook.com/documentation/instagram-platform/overview "The CDN URL is privacy-aware and will not return the media when the content has been deleted or has expired."
export async function screen(ctx: HandlerContext): Promise<Response> {
  const request = ctx.call.request;
  if (request.method !== 'GET' && request.method !== 'HEAD') return notFound();
  const m = PATH.exec(new URL(request.url).pathname);
  if (!m) return notFound();
  const [, kind, id, part] = m;
  if (kind === '19' && part === 'profile') {
    const account = ctx.row(ACCOUNT, id!);
    return account && account.deleted !== true ? bytesResponse(request, profilePicture(id!), 'image/png') : notFound();
  }
  const media = kind === '15' ? ctx.row(MEDIA, id!) : undefined;
  if (!media || media.deleted === true) return notFound();
  if (part === 'n') {
    const bytes = typeof media._sha256 === 'string' ? await ctx.blobs.get(`media/${media._sha256}`) : null;
    return bytes ? bytesResponse(request, bytes, String(media._content_type ?? 'application/octet-stream')) : notFound();
  }
  if (part === 'thumb' && media.media_type === 'VIDEO') {
    const cover = typeof media._cover_sha256 === 'string' ? await ctx.blobs.get(`media/${media._cover_sha256}`) : null;
    return cover ? bytesResponse(request, cover, 'image/jpeg') : bytesResponse(request, profilePicture(`thumb-${id!}`), 'image/png');
  }
  return notFound();
}
