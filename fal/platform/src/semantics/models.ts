import type { HandlerContext } from '@volter/world-core';
import { platformError } from './shared.ts';

// source: spec:getPricing "Accepts 1-50 endpoint IDs."
export async function getPricing(ctx: HandlerContext): Promise<Response> {
  const ids = new URL(ctx.call.request.url).searchParams.getAll('endpoint_id').flatMap((v) => v.split(','));
  if (ids.length < 1 || ids.length > 50 || ids.some((v) => !v.trim())) return platformError(400, 'validation_error', 'Invalid request parameters');
  // source: spec:getPricing "Pricing information retrieved successfully"
  if (ctx.scenario?.kind === 'handler') return Response.json(ctx.scenario.respond);
  // source: spec:getPricing "Resource not found"
  // Only the documented fixture is configured by default; other endpoint prices require a World scenario.
  if (ids.some((id) => id !== 'fal-ai/flux/dev')) return platformError(404, 'not_found', 'Resource not found');
  // source: https://fal.ai/docs/platform-apis/v1/models/pricing.md "0.025"
  return Response.json({ prices: [...new Set(ids)].map((endpoint_id) => ({ endpoint_id, unit_price: 0.025, unit: 'image', currency: 'USD' })), next_cursor: null, has_more: false });
}
