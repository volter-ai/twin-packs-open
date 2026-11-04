// LinkedIn's own moves as the World clock passes (docs/contributing/architecture.md, clock.ts): an uploaded image or a
// finalized video LinkedIn has finished processing becomes AVAILABLE (or PROCESSING_FAILED), stamped at the moment it
// fell due, and every post that was waiting on it is published (or fails) with it.
import type { HandlerContext } from '@volter/world-core';
import { IMAGE, nowMs, settle, VIDEO } from './shared.ts';

export async function clock(ctx: HandlerContext): Promise<void> {
  const now = nowMs(ctx);
  for (const resource of [IMAGE, VIDEO] as const) {
    for (const row of ctx.rowsRaw(resource).filter((r) => r.status === 'PROCESSING' && Number(r._due_at) <= now).sort((a, b) => Number(a._due_at) - Number(b._due_at))) {
      await settle(ctx, resource, row);
    }
  }
}
