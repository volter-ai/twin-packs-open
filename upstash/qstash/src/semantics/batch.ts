// Batch: several messages in one request, each published (or enqueued) as its own request would be.
import type { HandlerContext } from '@volter/world-core';
import { callerQStash, fail, publishOne, type Row } from './shared.ts';

/** `POST /v2/batch` `[{ destination, headers, body, queue? }]`: each item published (or enqueued) as its own request would
 *  be, answered in order; a refused item refuses the batch. */
// source: spec:post_v2_batch "Send multiple messages in a single request"
export async function post_v2_batch(ctx: HandlerContext): Promise<Response> {
  const items = Array.isArray(ctx.body) ? (ctx.body as Row[]) : undefined;
  if (!items) return fail(400, 'the batch must be a JSON array');
  const account = callerQStash(ctx)!;
  const answers: Row[] = [];
  for (const item of items) {
    if (typeof item.destination !== 'string') return fail(400, 'destination is required');
    const headers = new Headers(Object.entries((item.headers as Record<string, string> | undefined) ?? {}));
    const out = await publishOne(ctx, account, { destination: item.destination, body: typeof item.body === 'string' ? item.body : item.body === undefined ? '' : JSON.stringify(item.body), headers, ...(typeof item.queue === 'string' ? { queueName: item.queue } : {}) });
    if (out instanceof Response) return out;
    answers.push(out.answer);
  }
  return Response.json(answers);
}
