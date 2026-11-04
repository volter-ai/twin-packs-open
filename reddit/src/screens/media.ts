// REDDIT'S MEDIA HOSTS — v.redd.it, i.redd.it, preview.redd.it, external-preview.redd.it and b.thumbs.redditmedia.com
// (a content screen, twin-world's architecture, "Screens"): what a post's media URLs name, served from the bytes its upload
// left. A video's page address (v.redd.it/<id>) sends a browser to its post; its renditions (DASH_<height>.mp4) are the
// uploaded file, for the twin transcodes nothing, so its DASH and HLS playlists are not there; an image, its previews
// and its thumbnail are the uploaded image, at any of the sizes Reddit names.
import { bytesResponse, type HandlerContext } from '@volter/world-core';
import { ASSET, LINK } from '../semantics/shared.ts';

const hostOf = (request: Request): string => (request.headers.get('x-volter-twin-original-host') ?? request.headers.get('host') ?? new URL(request.url).host).replace(/:\d+$/, '').toLowerCase();
const notFound = (): Response => new Response('Not Found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });

/** The uploaded bytes of an asset whose file arrived, with its media type. */
async function bytesOf(ctx: HandlerContext, id: string): Promise<{ bytes: Uint8Array; type: string } | undefined> {
  const asset = ctx.row(ASSET, id);
  if (!asset || asset._uploaded !== true) return undefined;
  const bytes = await ctx.blobs.get(`asset:${id}`);
  return bytes ? { bytes, type: String(asset.mimetype) } : undefined;
}

export async function screen(ctx: HandlerContext): Promise<Response> {
  const request = ctx.call.request;
  if (request.method !== 'GET' && request.method !== 'HEAD') return notFound();
  const host = hostOf(request);
  const path = new URL(request.url).pathname;
  if (host === 'v.redd.it') {
    const page = /^\/([a-z0-9]+)\/?$/.exec(path);
    if (page) {
      // a video's own address opens the post it is in
      // (at a World's place, the post on the twin's base)
      const post = ctx.rowsRaw(LINK).find((l) => l._asset === page[1] && l.is_video === true);
      const place = ctx.call.request.headers.has('x-forwarded-prefix') ? new URL(ctx.publicBase).pathname.replace(/\/+$/, '') : undefined;
      return post ? new Response(null, { status: 302, headers: { location: `${place ?? 'https://www.reddit.com'}${String(post.permalink)}` } }) : notFound();
    }
    const rendition = /^\/([a-z0-9]+)\/DASH_\d{2,4}\.mp4$/.exec(path);
    const found = rendition ? await bytesOf(ctx, rendition[1]!) : undefined;
    return found ? bytesResponse(request, found.bytes, found.type) : notFound();
  }
  // i.redd.it/<id>.<ext>, preview.redd.it/<id>.<ext>?…, external-preview.redd.it/<id>.<ext>?…, b.thumbs.redditmedia.com/<id>.<ext>
  const file = /^\/([a-z0-9]+)\.(png|jpg|gif)$/.exec(path);
  const found = file ? await bytesOf(ctx, file[1]!) : undefined;
  return found && found.type.startsWith('image/') ? bytesResponse(request, found.bytes, found.type) : notFound();
}
