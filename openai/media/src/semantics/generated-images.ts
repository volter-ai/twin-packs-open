import type { HandlerContext } from '@volter/world-core';
import { epoch } from './shared.ts';
// source: spec:downloadGeneratedImage "URLs are only valid for 60 minutes after the image has been generated."
export async function downloadGeneratedImage(ctx: HandlerContext): Promise<Response> {
  const id = String(ctx.call.params.file).replace(/\.png$/, '');
  const row = ctx.row('_generated_image', id);
  const bytes = row && epoch(ctx) < Number(row._expires) && ctx.params.sig === row._sig ? await ctx.blobs.get(id) : null;
  return bytes ? ctx.raw(new Uint8Array(bytes), { headers: { 'content-type': 'image/png', 'content-length': String(bytes.length) } }) : ctx.notFound('_generated_image', id);
}
