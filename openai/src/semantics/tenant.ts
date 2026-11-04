import type { HandlerContext } from '@volter/world-core';
import { tenantFor } from './shared.ts';

export async function tenant(ctx: HandlerContext): Promise<string> {
  return tenantFor(ctx);
}
