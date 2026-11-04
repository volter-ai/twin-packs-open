import type { HandlerContext } from '@volter/world-core';
import { FILE, assetKey, htmlError } from '../../../src/semantics/shared.ts';

export async function downloadFont(ctx: HandlerContext): Promise<Response> {
  const request = new URL(ctx.call.request.url);
  const vendorUrl = new URL(request.pathname + request.search, 'https://fonts.gstatic.com');
  const row = ctx.row(FILE, assetKey(vendorUrl.href));
  if (!row) return htmlError(404, 'Font file not found');
  const body = await ctx.blobs.get(String(row.blob));
  if (!body) return htmlError(404, 'Font file not found');
  return new Response(Uint8Array.from(body).buffer, { headers: { 'content-type': String(row.contentType), 'content-length': String(body.length),
    'access-control-allow-origin': '*', 'cache-control': 'public, max-age=31536000, immutable' } });
}
