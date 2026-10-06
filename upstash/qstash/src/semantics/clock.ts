// QStash's own moves as the World clock passes (docs/contributing/architecture.md, clock.ts): each message is sent when
// it falls due (its not-before, or its next retry), at that moment, in time order, and its answer is taken when it
// arrives (at once from an application; a stand-in's after its `takes`, the slot it holds held until then). A queue's
// messages go in order, as many at a time as its parallelism: "The next message will wait for retries of the current
// one", and is ACTIVE only after the one before it is DELIVERED or FAILED.
// source: https://upstash.com/docs/qstash/features/queues "The next message will wait for retries of the current one"
import type { HandlerContext } from '@volter/world-core';
import { FLOW, flowKey, iso, MESSAGE, nowMs, pending, QUEUE, type Row, send, sent, settle } from './shared.ts';

/** The kernel's read-and-write under the World's lock, which a context opened at an instant carries (its type names it
 *  on the semantics context only). */
type Atomic = { atomically<T>(decide: (rows: (resource: string) => Row[]) => { value: T; write?: { resource: string; id: string; fields: Row; operation: string } }): Promise<T> };

/** When a message may next be attempted: its due time, or, in a queue, once enough of the messages before it there have
 *  ended (undefined while they have not). */
function readyAt(m: Row, all: Row[], queues: Map<string, number>, flows: Map<string, Row>): number | undefined {
  let due = Number(m._due);
  // source: https://upstash.com/docs/qstash/features/flowcontrol "The limits are applied per flow-control key, not per URL."
  const flow = flows.get(flowKey(m));
  if (flow) {
    due = Math.max(due, Number(flow.lastAt ?? due));
    // source: https://upstash.com/docs/qstash/features/flowcontrol "the response is not received yet."
    const activeIds = (flow.active as string[] | undefined) ?? [];
    if (activeIds.includes(String(m.messageId))) return undefined;
    const active = activeIds.length;
    if (active >= Number(flow.parallelism ?? Infinity)) return undefined;
    // source: https://upstash.com/docs/qstash/features/flowcontrol "Number of messages dispatched in the current rate period"
    if (Number(flow.count ?? 0) >= Number(flow.rate ?? Infinity)) due = Math.max(due, Number(flow.start) + Number(flow.period));
  }
  if (typeof m.queueName !== 'string') return due;
  // the messages ahead of it in its queue: made earlier, or in the same instant but written before it
  const at = all.indexOf(m);
  const before = all.filter((x, i) => x._account === m._account && x.queueName === m.queueName && x !== m
    && (Number(x.createdAt) < Number(m.createdAt) || (Number(x.createdAt) === Number(m.createdAt) && i < at)));
  const open = before.filter(pending).length;
  if (open >= (queues.get(`${String(m._account)}::${m.queueName}`) ?? 1)) return undefined;
  const ended = before.map((x) => Number(x._resolved ?? 0));
  return Math.max(due, ...ended);
}

/** The order due messages are attempted in: by the instant each is ready, then by when it was made, then in the order
 *  they were written (a batch's messages as the batch lists them), so a pass delivers the same messages in the same order
 *  every time. */
const before = (a: { m: Row; at: number; i: number }, b: { m: Row; at: number; i: number }): number =>
  a.at - b.at || Number(a.m.createdAt) - Number(b.m.createdAt) || a.i - b.i;

export async function clock(ctx: HandlerContext): Promise<void> {
  // Every finite backlog drains, including queued retries and callbacks; a round count is not a vendor limit.
  // source: https://upstash.com/docs/qstash/features/queues "The next message will wait for retries of the current one"
  while (await round(ctx)) { /* settle or send the next due attempts */ }
}

/** An attempt in flight: its message, the instant its answer arrives, and its place in the order. */
const inflight = (m: Row): Row | undefined => (m._inflight && typeof m._inflight === 'object' ? (m._inflight as Row) : undefined);

/** One round, at the earliest instant anything is due. The answers that arrive then come first, each taken in a stable
 *  order (by when it arrives, when its attempt was sent, the order the messages were written): they free the slots and
 *  end the queue places the next messages wait on, which the next round sees. Otherwise every message ready then, in
 *  its stable order, is reserved in turn (the calls reserved before it count against its key's parallelism and rate, as
 *  calls awaiting their answers do), then each is asked and its attempt written, one at a time in that order: an
 *  application asked may publish during its own request (a workflow's serve() publishes its next step), so asking the
 *  next only after it has answered keeps the ids it mints and the World's writes in the same order on every pass, never
 *  in the order wall-clock answers happen to arrive (a stand-in answers at once, its `takes` passing on the World's
 *  clock, so it costs the round no wall time). A key's limit that holds a message back reconsiders it once an answer frees it. False when nothing is
 *  due. Where the documentation stops: real applications are asked one at a time in that stable order too (the
 *  determinism above), so a queue whose parallelism is above 1 never sends its destinations concurrent requests, and a
 *  slow application holds its whole round in wall time while it answers. */
async function round(ctx: HandlerContext): Promise<boolean> {
  const all = ctx.rowsRaw(MESSAGE);
  const now = nowMs(ctx);
  const answers = all.flatMap((m, i) => {
    const attempt = inflight(m);
    return attempt && Number(attempt.answerAt) <= now ? [{ id: String(m.messageId), at: Number(attempt.answerAt), sentAt: Date.parse(String(attempt.at)), i }] : [];
  }).sort((a, b) => a.at - b.at || a.sentAt - b.sentAt || a.i - b.i);
  const queues = new Map(ctx.rowsRaw(QUEUE).filter((q) => q.deleted !== true).map((q) => [`${String(q._account)}::${String(q.name)}`, Number(q.parallelism ?? 1)]));
  const flows = new Map(ctx.rowsRaw(FLOW).map((f) => [String(f.id), f]));
  const ready: Array<{ m: Row; at: number; i: number }> = [];
  all.forEach((m, i) => {
    if (!pending(m) || m._active === true) return;
    const at = readyAt(m, all, queues, flows);
    if (at !== undefined && at <= now) ready.push({ m, at, i });
  });
  ready.sort(before);
  if (answers.length && (!ready.length || answers[0]!.at <= ready[0]!.at)) {
    const at = await ctx.at(iso(answers[0]!.at));
    for (const answer of answers.filter((a) => a.at === answers[0]!.at)) await settle(at, answer.id);
    return true;
  }
  if (!ready.length) return false;
  const due = ready.filter((r) => r.at === ready[0]!.at);
  const at = await ctx.at(iso(due[0]!.at));
  const reserved: Row[] = [];
  for (const next of due) {
    const id = String(next.m.messageId);
    const key = flowKey(next.m);
    const held = await (at as unknown as Atomic).atomically((rows) => {
      const messages = rows(MESSAGE);
      const m = messages.find((x) => x.messageId === id);
      const heldFlows = new Map(rows(FLOW).map((f) => [String(f.id), f]));
      if (!m || !pending(m) || m._active || readyAt(m, messages, queues, heldFlows) !== next.at) return { value: 'none' as const };
      const flow = heldFlows.get(key);
      if (!flow) return { value: 'message' as const, write: { resource: MESSAGE, id, fields: { _active: true }, operation: 'message.dispatch' } };
      // source: https://upstash.com/docs/qstash/features/flowcontrol "The next message delivery will start a fresh rate period."
      const fresh = flow.start === undefined || next.at >= Number(flow.start) + Number(flow.period);
      return { value: 'flow' as const, write: { resource: FLOW, id: key, operation: 'flow.dispatch', fields: {
        active: [...((flow.active as string[] | undefined) ?? []), id], lastAt: next.at,
        ...(flow.rate ? { start: fresh ? next.at : flow.start, count: fresh ? 1 : Number(flow.count) + 1 } : {}),
      } } };
    });
    if (held === 'none') continue;
    // a key's reservation is its flow's; the message is marked in flight beside it
    if (held === 'flow') await at.write(MESSAGE, id, { _active: true }, 'message.dispatch');
    reserved.push(next.m);
  }
  // each reserved attempt asked in order, the next only once the one before has answered and been written
  for (const m of reserved) await sent(at, m, await send(at, m));
  return true;
}

