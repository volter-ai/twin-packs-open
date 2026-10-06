// Queues: an account's named queues, delivered in order as many at a time as their parallelism.
import type { HandlerContext } from '@volter/world-core';
import { callerQStash, fail, QUEUE, queueKey, type Row } from './shared.ts';

/** `POST /v2/queues` `{ queueName, parallelism }`: the queue made, or its parallelism changed ("Updates or creates a queue"). */
// source: spec:post_v2_queues "Updates or creates a queue"
export async function post_v2_queues(ctx: HandlerContext): Promise<Response> {
  const b = (ctx.body && typeof ctx.body === 'object' ? ctx.body : {}) as Row;
  const name = typeof b.queueName === 'string' ? b.queueName : '';
  if (!/^[A-Za-z0-9._-]+$/.test(name)) return fail(400, 'Queue name is invalid. Queue names can only contain alphanumeric characters, hyphens, periods, and underscores.');
  const parallelism = b.parallelism === undefined ? 1 : Number(b.parallelism);
  if (!Number.isInteger(parallelism) || parallelism < 1) return fail(400, 'parallelism must be greater than 0');
  const account = callerQStash(ctx)!;
  const key = queueKey(account, name);
  const held = ctx.row(QUEUE, key);
  const now = Date.parse(ctx.occurredAt);
  await ctx.write(QUEUE, key, { name, parallelism, updatedAt: now, ...(held ? {} : { paused: false, createdAt: now, _account: account.id }) }, held ? 'queue.update' : 'queue.create');
  return new Response(null, { status: 200 });
}
