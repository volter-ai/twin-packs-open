import type { HandlerContext } from '@volter/world-core';
import { tenantFor } from '../../../src/semantics/shared.ts';

export async function tenant(ctx: HandlerContext): Promise<string> {
  return tenantFor(ctx);
}
