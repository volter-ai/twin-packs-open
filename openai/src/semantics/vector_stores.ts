import type { HandlerContext } from '@volter/world-core';
import { epoch, objectOr } from './shared.ts';
// source: spec:createVectorStore "Create a vector store."
export async function createVectorStore(ctx: HandlerContext): Promise<Response> {
  return ctx.reply(await ctx.create('VectorStoreObject', {
    object: 'vector_store', created_at: epoch(ctx), name: ctx.params.name ?? null,
    status: 'completed', usage_bytes: 0, bytes: 0, file_counts: { in_progress: 0, completed: 0, failed: 0, cancelled: 0, total: 0 },
    metadata: objectOr(ctx.params.metadata, {}), expires_after: ctx.params.expires_after ?? null, expires_at: null, last_active_at: epoch(ctx),
  }, 'vector_store.create'));
}
