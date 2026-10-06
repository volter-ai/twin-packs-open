// Images: a real placeholder image (base64 for the GPT image models, a URL for DALL·E); the twin renders no
// pixels. An edit or a variation takes its image as a multipart file of a format the endpoint takes.
import type { Handler, HandlerContext } from '@volter/world-core';
import { gptImage, handleImageEdit, handleImages, type ImageAnswer, modelOf, epoch, recordUsage, send, timeline } from './shared.ts';

/** The images, or their events when the request streamed them; each call made is billed by its images, of the size
 *  asked, from its source (the usage report's `images`, `size`, `source`). */
async function answer(ctx: Parameters<Handler>[0], r: ImageAnswer, source: string): Promise<Response> {
  if (r.status === 200) {
    const n = ((r.body as { data?: unknown[] }).data ?? []).length;
    const model = modelOf(ctx.call.operation.id, ctx.params as { model?: unknown })!;
    if (!gptImage(model) && ctx.params.response_format !== 'b64_json') {
      const data = (r.body as { data: Array<Record<string, unknown>> }).data;
      for (const item of data) {
        const bytes = Uint8Array.from(atob(String(item.b64_json)), (c) => c.charCodeAt(0));
        const held = await ctx.create('_generated_image', { _expires: epoch(ctx) + 3600 }, 'generated_image.create');
        const id = String(held.id), sig = await ctx.secret(`image:${id}`);
        await ctx.write('_generated_image', id, { _sig: sig }, 'generated_image.update');
        await ctx.blobs.put(id, bytes);
        delete item.b64_json;
        item.url = `${ctx.publicBase}/generated-images/${id}.png?sig=${encodeURIComponent(sig)}`;
        if (model === 'dall-e-3') item.revised_prompt = `[twin-stub] ${String(ctx.params.prompt)}`;
      }
    }
    await recordUsage(ctx, 'images', model, 0, 0, { images: n, size: typeof ctx.params.size === 'string' ? ctx.params.size : '1024x1024', source });
  }
  return r.events ? ctx.sse(r.events) : send(ctx, r);
}

export async function createImage(ctx: HandlerContext): Promise<Response> {
  const gone = timeline(ctx);
  if (gone) return gone;
  return answer(ctx, handleImages({ ...ctx.params, response_format: 'b64_json' }, ctx.occurredAt), 'image.generation');
}

// source: spec:createImageEdit "Creates an edited or extended image given one or more source images and a prompt."
export async function createImageEdit(ctx: HandlerContext): Promise<Response> {
  const gone = timeline(ctx);
  if (gone) return gone;
  return answer(ctx, handleImageEdit({ ...ctx.params, response_format: 'b64_json' }, ctx.occurredAt), 'image.edit');
}
