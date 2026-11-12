// What PostHog's capture does around every request (architecture, around.ts): the body is kept as its bytes (a gzip-js
// body is not text) before the dispatch reads it.
import { s3, type HandlerContext } from '@volter/world-core';

export async function around(ctx: HandlerContext, next: (request?: Request) => Promise<Response>): Promise<Response> {
  return next(await s3.withBytes(ctx.call.request));
}
