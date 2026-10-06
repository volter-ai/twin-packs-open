// Publish: a message to a URL, delivered by the clock (./clock.ts) when it is due.
import type { HandlerContext } from '@volter/world-core';
import { callerQStash, publishOne, published } from './shared.ts';

// source: spec:post_v2_publish_destination "Publish a message to the specified destination"
export async function post_v2_publish_destination(ctx: HandlerContext): Promise<Response> {
  const out = await publishOne(ctx, callerQStash(ctx)!, { destination: String(ctx.call.params.destination), body: ctx.text, headers: ctx.call.request.headers });
  return out instanceof Response ? out : published(out);
}
