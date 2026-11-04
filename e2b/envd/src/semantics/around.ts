import type { HandlerContext } from '@volter/world-core';
import { fileFailure } from './shared.ts';

// source: spec:/components/schemas/Error "Error code"
export async function around(ctx: HandlerContext, next: () => Promise<Response>): Promise<Response> {
  const response = await next();
  // envd's REST file door has an integer error skin, including core refusals before its handler.
  return new URL(ctx.call.request.url).pathname === '/files' && !response.ok ? fileFailure(response, true) : response;
}
