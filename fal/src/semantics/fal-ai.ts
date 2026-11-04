import type { HandlerContext } from '@volter/world-core';
import { falError, imageUrl, keepImage, type Row } from './shared.ts';

// source: spec:/components/schemas/IdeogramV2Input "The aspect ratio of the generated image"
const ASPECTS = ['10:16', '16:10', '9:16', '16:9', '4:3', '3:4', '1:1', '1:3', '3:1', '3:2', '2:3'];
// source: spec:/components/schemas/IdeogramV2Input "The style of the generated image"
const STYLES = ['auto', 'general', 'realistic', 'design', 'render_3D', 'anime'];

// source: https://fal.ai/docs/documentation/model-apis/overview.md "returns the result directly"
export async function post_fal_ai_ideogram_v2(ctx: HandlerContext): Promise<Response> {
  const refused = ctx.validate();
  if (refused) return refused;
  const b = (ctx.body && typeof ctx.body === 'object' && !Array.isArray(ctx.body) ? ctx.body : {}) as Row;
  // source: spec:/components/schemas/IdeogramV2Input "prompt"
  // Required fields and scalar types are checked by the derived validator above.
  // source: spec:/components/schemas/IdeogramV2Input "The aspect ratio of the generated image"
  const aspect = b.aspect_ratio === undefined ? '1:1' : b.aspect_ratio as string;
  if (!ASPECTS.includes(aspect)) return falError(422, [{ loc: ['body', 'aspect_ratio'], msg: 'value is not a valid enumeration member', type: 'enum', url: 'https://docs.fal.ai/errors#enum' }]);
  // source: spec:/components/schemas/IdeogramV2Input "The style of the generated image"
  if (b.style !== undefined && !STYLES.includes(b.style as string)) return falError(422, [{ loc: ['body', 'style'], msg: 'value is not a valid enumeration member', type: 'enum', url: 'https://docs.fal.ai/errors#enum' }]);
  // source: spec:/components/schemas/IdeogramV2Input "Seed for the random number generator"
  if (b.seed !== undefined && b.seed !== null && !Number.isInteger(b.seed)) return falError(422, [{ loc: ['body', 'seed'], msg: 'value is not a valid integer', type: 'int_parsing', url: 'https://docs.fal.ai/errors#int_parsing' }]);
  const seed = typeof b.seed === 'number' ? b.seed : Number.parseInt(ctx.crypto.digest('sha256', `${ctx.occurredAt}:${b.prompt}`, 'hex').slice(0, 8), 16) % 2147483647;
  const image = await keepImage(ctx, b.prompt as string, seed, aspect);
  // source: spec:/components/schemas/File "The URL where the file can be downloaded from."
  return Response.json({ images: [{ url: imageUrl(ctx, image.id, image.bytes, b.sync_mode === true), content_type: 'image/png', file_name: `${image.id}.png`, file_size: image.bytes.length }], seed });
}
