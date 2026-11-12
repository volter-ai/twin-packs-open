import type { HandlerContext } from '@volter/world-core';
import { ASSET, thumbPath } from './shared.ts';

// source: spec:getThumbnail "The URL of the preview image thumbnail for this asset"
export async function getThumbnail(ctx: HandlerContext): Promise<Response> {
  const file = String(ctx.call.params.file);
  const id = file.endsWith('.png') ? file.slice(0, -'.png'.length) : '';
  const a = id ? ctx.row(ASSET, id) : undefined;
  // Where the documentation stops: an asset published without a thumbnail has none to show; the twin answers 404
  const body = a && a.deleted !== true && a._thumbnail === true ? await ctx.blobs.get(thumbPath(id).slice(1)) : null;
  if (!body) return new Response('Not Found', { status: 404, headers: { 'content-type': 'text/plain' } });
  return new Response(new Uint8Array(body).buffer, { headers: { 'content-type': 'image/png', 'content-length': String(body.length) } });
}
