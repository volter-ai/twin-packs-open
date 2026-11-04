import type { HandlerContext } from '@volter/world-core';
import { tenantFor } from './shared.ts';

export function tenant(ctx: HandlerContext): string {
  return tenantFor(ctx);
}
