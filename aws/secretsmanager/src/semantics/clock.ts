// Secrets Manager's own moves as the World clock passes (docs/contributing/architecture.md, clock.ts): a scheduled
// rotation that has fallen due starts, as Secrets Manager starts it (./shared.ts catchUpRotations). The kernel runs it
// before any request is answered, as the vendor's move, so every door reads the account as it stands now.
import type { HandlerContext } from '@volter/world-core';
import { catchUpReplicas, catchUpRotations } from './shared.ts';

export async function clock(ctx: HandlerContext): Promise<void> {
  await catchUpReplicas(ctx);
  await catchUpRotations(ctx);
}
