// What Axiom does around every request (architecture, around.ts): the body is kept as its bytes, which an ingest body
// (NDJSON, CSV, JSON, after the kernel decodes its Content-Encoding) is read from, before the dispatch reads it.
import { s3, type HandlerContext } from '@volter/world-core';

export async function around(ctx: HandlerContext, next: (request?: Request) => Promise<Response>): Promise<Response> {
  return next(await s3.withBytes(ctx.call.request));
}
