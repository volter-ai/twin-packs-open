import type { HandlerContext } from '@volter/world-core';
import { machineRequest, lifecycle } from './shared.ts';
// source: spec:execute "Execute code in a persistent context and stream newline-delimited execution events"
export async function execute(ctx: HandlerContext): Promise<Response> { return machineRequest(ctx, 49999, lifecycle); }
