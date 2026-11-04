import type { HandlerContext } from '@volter/world-core';
import { account } from './shared.ts';

// source: spec:/tags/0 "Every user will be in at least one group"
export function tenant(ctx: HandlerContext): string | undefined { return account(ctx); }
