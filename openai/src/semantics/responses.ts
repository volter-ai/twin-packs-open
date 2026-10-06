// Responses API semantics. A response is the pack's behaviour, never a model: a scripted scenario's
// turn when one is loaded and a handler matches, else the labeled deterministic stub. A stored
// response (the default) reads back with its input items; `previous_response_id` continues one; a
// background response is created queued and processed on its first poll. The machine in
// ../manifest.ts declares `status` (the vendor's work a poll observes, cancel) and refuses what OpenAI refuses; delete is the
// derived core's.
import type { Handler, HandlerContext, ScenarioDecision } from '@volter/world-core';
import { buildResponse, createStoredResponse, emitResponse, epoch, type OpenAIResponse, readOnly, recordUsage, responseMessages, type ResponsesArgs, type Row, send, timeline, validateResponses, schemaFailure, } from './shared.ts';

type Ops = { resource: string; get: string; cancel: string };
const GA: Ops = { resource: 'Response', get: 'getResponse', cancel: 'cancelResponse' };

/** Each built-in tool call a response made is billed as one (the usage reports' web search and file search calls). */
async function recordToolCalls(ctx: Parameters<Handler>[0], resp: OpenAIResponse): Promise<void> {
  for (const item of resp.output) {
    if (item.type === 'web_search_call') await recordUsage(ctx, 'web_search_calls', resp.model, 0, 0);
    if (item.type === 'file_search_call') await recordUsage(ctx, 'file_search_calls', resp.model, 0, 0);
  }
}

const create = (ops: Ops): Handler => async (ctx) => {
  const validated = validateResponses(ctx.params);
  if ('error' in validated) return send(ctx, validated.error);
  const args = validated.args;
  // each stored input already holds its ancestry: continuing appends the prior output once
  if (args.previousResponseId) {
    const prior = ctx.row(ops.resource, args.previousResponseId);
    if (!prior) return ctx.notFound(ops.resource, args.previousResponseId);
    args.inputItems = [...((prior._input_items ?? []) as Row[]), ...((prior.output ?? []) as Row[]), ...args.inputItems];
    args.messages = responseMessages(args.inputItems, args.instructions);
  }
  // the scenario's turn, decided by the front before dispatch (../fetch.ts), as on chat
  const decision = ctx.scenario;
  // a background response keeps its decision until its first poll, and streams nothing now
  if (args.background && !args.stream) {
    const queued = await createStoredResponse(args, ctx, ops.resource, decision);
    return ctx.reply(queued);
  }
  const resp = args.store ? ((await createStoredResponse(args, ctx, ops.resource, decision)) as OpenAIResponse) : buildResponse(args, ctx.occurredAt, (await ctx.issue('_response_call')).replace(/^resp_/, ''), decision);
  const events: Array<{ event?: string; data: unknown }> = [];
  if (args.stream) emitResponse(resp, (e) => { if (e.data) events.push({ event: String((e.data as { type?: unknown }).type ?? ''), data: e.data }); });
  await recordUsage(ctx, 'responses', resp.model, resp.usage.input_tokens, resp.usage.output_tokens);
  await recordToolCalls(ctx, resp);
  return args.stream ? ctx.sse(events) : ctx.reply(resp);
};

// A background response is OpenAI's work, done over time: it is `queued`, then `in_progress` as its output is written,
// then `completed` (https://platform.openai.com/docs/guides/background: "you can poll the response object... while the
// status is `queued` or `in_progress`"). Extrapolation, the twin's own timing: a response waits a second in the queue, then
// writes its output at 50 tokens a second; a poll in between sees the text written so far in a message still in progress.
const QUEUED_SECONDS = 1;
const TOKENS_PER_SECOND = 50;

/** Where a background response has got to at `now`: its status and, in progress, the output written so far. */
function backgroundAt(current: Row, now: number, occurredAt: string | undefined): { status: 'queued' } | { status: 'in_progress'; output: unknown[] } | { status: 'completed'; resp: OpenAIResponse; at: number } {
  const created = Number(current.created_at);
  const start = created + QUEUED_SECONDS;
  if (now < start) return { status: 'queued' };
  const args = JSON.parse(String(current._bg_args ?? '{}')) as ResponsesArgs;
  const decision = current._bg_decision ? (JSON.parse(String(current._bg_decision)) as ScenarioDecision) : undefined;
  const resp = buildResponse(args, occurredAt, String(current._bg_suffix ?? ''), decision);
  const finish = start + Math.max(1, Math.ceil(resp.usage.output_tokens / TOKENS_PER_SECOND));
  if (now >= finish) return { status: 'completed', resp: { ...resp, created_at: created, completed_at: finish }, at: finish };
  const share = (now - start) / (finish - start);
  const output = resp.output.flatMap((item): unknown[] => {
    if (item.type !== 'message') return item.type === 'reasoning' ? [item] : [];
    const whole = item.content[0]?.text ?? '';
    return [{ ...item, status: 'in_progress', content: [{ ...item.content[0], text: whole.slice(0, Math.floor(whole.length * share)) }] }];
  });
  return { status: 'in_progress', output };
}

/** The completion branch is reached only when a caller allows background processing to finish. */
function completedBackground(resp: OpenAIResponse, claim: (resp: OpenAIResponse) => void): Row {
  claim(resp);
  return { ...resp, background: true, _bg_args: null, _bg_suffix: null, _bg_decision: null };
}

/** Claim each background transition once, using the kernel's conditional write. */
async function observe(ctx: HandlerContext, ops: Ops, id: string): Promise<Row | undefined> {
  let completed: OpenAIResponse | undefined;
  // a background response's progress is OpenAI's own move whoever polls it
  await ctx.asVendor(async () => {
    await ctx.change(ops.resource, id, (current) => {
      if (current.status !== 'queued' && current.status !== 'in_progress') return undefined;
      const at = backgroundAt(current, epoch(ctx), ctx.occurredAt);
      if (at.status === 'queued') return undefined;
      if (at.status !== current.status && ctx.legal(ops.resource, 'status', ops.get, current.status, at.status, id, 'vendor')) return undefined;
      if (at.status === 'completed') return completedBackground(at.resp, (resp) => { completed = resp; });
      return { status: 'in_progress', output: at.output };
    }, 'response.update');
    if (completed) await recordCompleted(ctx, completed);
  });
  return ctx.row(ops.resource, id);
}

const retrieve = (ops: Ops): Handler => async (ctx) => {
  const id = String(ctx.id);
  const row = ctx.row(ops.resource, id);
  if (!row) return ctx.notFound(ops.resource, id);
  // a read-only (mirror) twin holds the vendor's own state: it answers it as stored
  if ((row.status !== 'queued' && row.status !== 'in_progress') || readOnly(ctx)) return ctx.reply(ctx.get(ops.resource, id)!);
  const seen = await observe(ctx, ops, id);
  return seen ? ctx.reply(ctx.get(ops.resource, id)!) : ctx.notFound(ops.resource, id);
};

// cancelling stops the response where OpenAI's work has got to: a queued one with no output, one in progress with the
// output written so far, its message still `in_progress` (the reference's cancel example); a finished one is refused
const cancel = (ops: Ops): Handler => async (ctx) => {
  const id = String(ctx.id);
  let row = ctx.row(ops.resource, id);
  if (!row) return ctx.notFound(ops.resource, id);
  if ((row.status === 'queued' || row.status === 'in_progress') && !readOnly(ctx)) row = (await observe(ctx, ops, id)) ?? row;
  let refusal: ReturnType<HandlerContext['legal']>;
  const result = await ctx.change(ops.resource, id, (current) => {
    refusal = ctx.legal(ops.resource, 'status', ops.cancel, current.status, 'cancelled');
    if (refusal) return undefined;
    if (current.status === 'cancelled') return { status: 'cancelled' };
    return { status: 'cancelled', _bg_args: null, _bg_suffix: null, _bg_decision: null };
  }, 'response.cancel');
  return refusal ? ctx.refuse(refusal) : result ? ctx.reply(result) : ctx.notFound(ops.resource, id);
};

// the input items folded into a stored response (its ancestry included)
const inputItems = (ops: Ops): Handler => async (ctx) => {
  const id = String(ctx.id);
  const row = ctx.row(ops.resource, id);
  if (!row) return ctx.notFound(ops.resource, id);
  // the list page names its first and last items, as every OpenAI list does
  // (https://platform.openai.com/docs/api-reference/responses/input-items)
  const data = (row._input_items as Row[] | undefined) ?? [];
  return ctx.reply({ object: 'list', data, first_id: data[0]?.id ?? null, last_id: data.at(-1)?.id ?? null, has_more: false });
};

export async function createResponse(ctx: HandlerContext): Promise<Response> {
  const gone = timeline(ctx);
  if (gone) return gone;
  return create(GA)(ctx).catch(schemaFailure.bind(null, ctx, 'text.format'));
}

// source: spec:getResponse "Retrieves a model response with the given ID."
export async function getResponse(ctx: HandlerContext): Promise<Response> {
  const gone = timeline(ctx);
  if (gone) return gone;
  return (retrieve(GA))(ctx);
}

// source: spec:cancelResponse "Only responses created with the `background` parameter set to `true` can be cancelled."
export async function cancelResponse(ctx: HandlerContext): Promise<Response> {
  const gone = timeline(ctx);
  if (gone) return gone;
  return (cancel(GA))(ctx);
}

// source: spec:listInputItems "Returns a list of input items for a given response."
export async function listInputItems(ctx: HandlerContext): Promise<Response> {
  const gone = timeline(ctx);
  if (gone) return gone;
  return (inputItems(GA))(ctx);
}

// source: spec:getResponse "Retrieves a model response with the given ID."
async function recordCompleted(ctx: HandlerContext, response: OpenAIResponse): Promise<void> {
  await recordUsage(ctx, 'responses', response.model, response.usage.input_tokens, response.usage.output_tokens);
  await recordToolCalls(ctx, response);
}
