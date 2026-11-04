// LinkedIn's media hosts (docs/contributing/architecture.md, "Screens": a content screen): an image's bytes and a
// video's cover at media.licdn.com, a video's file at dms.licdn.com, where every downloadUrl and thumbnail the Images
// and Videos APIs answer, and every post's page, load them from. Only a processed (AVAILABLE) asset is served, by a URL
// LinkedIn made for that very asset, handed out and still within its time (../semantics/shared.ts mediaSigner), and held
// by its reader alone (private, for as long as the URL is good); a video's cover is the thumbnail
// its owner uploaded, and a video with none has no cover here (the twin decodes no video to make one).
import { bytesResponse, type HandlerContext } from '@volter/world-core';
import { IMAGE, mediaUrlHolds, nowMs, VIDEO } from '../semantics/shared.ts';

const IMAGE_PATH = /^\/dms\/image\/v2\/([A-Za-z0-9_-]+)\/(image-shrink_1280|videocover-high)\/0\/\d+$/;
const VIDEO_PATH = /^\/playlist\/vid\/v2\/([A-Za-z0-9_-]+)\/mp4-720p-30fp-crf28\/0\/\d+$/;
const notFound = (): Response => new Response('Not Found', { status: 404 });

export async function screen(ctx: HandlerContext): Promise<Response> {
  const request = ctx.call.request;
  const url = new URL(request.url);
  const image = IMAGE_PATH.exec(url.pathname);
  const video = VIDEO_PATH.exec(url.pathname);
  const row = image?.[2] === 'image-shrink_1280' ? ctx.row(IMAGE, image[1]!) : image || video ? ctx.row(VIDEO, (image ?? video)![1]!) : undefined;
  if ((request.method !== 'GET' && request.method !== 'HEAD') || row?.status !== 'AVAILABLE') return notFound();
  // the path is the asset's own, every segment of it (the trailing number its processing's moment): a URL LinkedIn
  // made for this asset, or none
  const own = image?.[2] === 'videocover-high' ? row.thumbnail : row.downloadUrl;
  if (typeof own !== 'string' || new URL(own).pathname !== url.pathname) return notFound();
  if (!(await mediaUrlHolds(ctx, url))) return notHandedOut();
  // held by the reader alone, and no longer than the URL is good for: the URL is signed for whoever it was handed to
  const cache = `private, max-age=${Math.max(0, Number(url.searchParams.get('e')) - Math.floor(nowMs(ctx) / 1000))}`;
  if (video) return served(ctx, row._sha256, 'video/mp4', cache);
  if (image?.[2] === 'image-shrink_1280') return served(ctx, row._sha256, String(row._content_type ?? 'image/png'), cache);
  return served(ctx, row._thumbnail_sha256, String(row._thumbnail_type ?? 'image/png'), cache);
}

/** A URL past its time, or one LinkedIn never signed. Where the documentation stops: the pages say such a URL has
 *  expired, not what the host answers; the twin answers 403. */
function notHandedOut(): Response {
  return new Response('Forbidden', { status: 403 });
}

/** A kept file's bytes, by their digest. */
async function served(ctx: HandlerContext, digest: unknown, type: string, cache: string): Promise<Response> {
  const bytes = typeof digest === 'string' ? await ctx.blobs.get(`media/${digest}`) : null;
  return bytes ? bytesResponse(ctx.call.request, bytes, type, cache) : notFound();
}
