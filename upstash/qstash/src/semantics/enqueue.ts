// Enqueue: a message into a named queue, delivered in the queue's order as many at a time as its parallelism.
import type { HandlerContext } from '@volter/world-core';
import { callerQStash, fail, publishOne, published } from './shared.ts';

// source: spec:post_v2_enqueue_queuename_destination "Enqueue a message to the specified queue"
export async function post_v2_enqueue_queuename_destination(ctx: HandlerContext): Promise<Response> {
  const queueName = String(ctx.call.params.queueName);
  if (!/^[A-Za-z0-9._-]+$/.test(queueName)) return fail(400, 'Queue name is invalid. Queue names can only contain alphanumeric characters, hyphens, periods, and underscores.');
  const out = await publishOne(ctx, callerQStash(ctx)!, { destination: String(ctx.call.params.destination), body: ctx.text, headers: ctx.call.request.headers, queueName });
  return out instanceof Response ? out : published(out);
}
