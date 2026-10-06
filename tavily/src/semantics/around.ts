// What Tavily's API does around every request (architecture, around.ts): a request carries a key the World issued
// (`Authorization: Bearer tvly-…`, or the body's `api_key`), else the 401.
import type { HandlerContext } from '@volter/world-core';
import { keyOf, tavilyError } from './shared.ts';

// source: spec:search "Unauthorized - Your API key is wrong or missing."
export async function around(ctx: HandlerContext, next: (request?: Request) => Promise<Response>): Promise<Response> {
  if (new URL(ctx.call.request.url).pathname.startsWith('/_twin/')) return next();
  if (!keyOf(ctx).row) return tavilyError(401, 'Unauthorized: missing or invalid API key.');
  return next();
}
