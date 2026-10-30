// Production and sandbox have independent data and credentials.
// source: https://polar.sh/docs/api-reference/introduction "Create separate tokens in each environment."
import type { HandlerContext } from '@volter/world-core';
import { orgId } from './shared.ts';
export function tenant(ctx: HandlerContext): string { return orgId(ctx); }
