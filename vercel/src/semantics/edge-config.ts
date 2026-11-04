import type { HandlerContext } from '@volter/world-core';
import { updateEdgeConfigItems } from './shared.ts';

// source: spec:patchEdgeConfigItems "items"
export async function patchEdgeConfigItemsAtEdgeConfigPath(ctx: HandlerContext): Promise<Response> {
  return updateEdgeConfigItems(ctx);
}
