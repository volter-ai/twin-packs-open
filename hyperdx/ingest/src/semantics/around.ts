// What OTLP does around every request (architecture, around.ts): the body is kept as its bytes, which a binary
// protobuf payload is (it is not text), before the dispatch reads it. Its CORS is the manifest's (`cors`).
import { s3, type HandlerContext } from '@volter/world-core';

export async function around(ctx: HandlerContext, next: (request?: Request) => Promise<Response>): Promise<Response> {
  return next(await s3.withBytes(ctx.call.request));
}
