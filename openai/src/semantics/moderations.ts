// Moderations: a deterministic classification of each input, never a model. Text naming a category's own words is
// flagged in it (shared.ts moderateText); every call is recorded for the organization's usage report.
import type { HandlerContext } from '@volter/world-core';
import { estimateTokens, handleModerations, modelOf, recordUsage, send, timeline } from './shared.ts';

// source: spec:createModeration "Classifies if text and/or image inputs are potentially harmful."
export async function createModeration(ctx: HandlerContext): Promise<Response> {
  const gone = timeline(ctx);
  if (gone) return gone;
  const r = handleModerations(ctx.params, '');
  if (r.status === 200) {
    // OpenAI keeps no moderation, and issues each its id (the manifest's _moderation: `modr-` and base62)
    r.body = { ...(r.body as Record<string, unknown>), id: await ctx.issue('_moderation') };
    const input = ctx.params.input;
    const text = typeof input === 'string' ? input : JSON.stringify(input ?? '');
    await recordUsage(ctx, 'moderations', modelOf('createModeration', ctx.params as { model?: unknown })!, estimateTokens(text), 0);
  }
  return send(ctx, r);
}
