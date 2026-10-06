import type { HandlerContext } from '@volter/world-core';
import { append, ASSISTANT, at, epoch, invalid, objectOr, run, steps, streamRun, submitToolOutputs, THREAD, thread, THREAD_RUN, timeline, workRun } from './shared.ts';


export async function listRunSteps(ctx: HandlerContext): Promise<Response> {
  const gone = timeline(ctx);
  if (gone) return gone;
  await workRun(ctx, at(ctx, 'run_id'));
  const found = run(ctx);
  if ('answer' in found) return found.answer;
  const data = steps(found.run);
  return ctx.reply({ object: 'list', data, has_more: false, first_id: data[0]?.id ?? null, last_id: data.at(-1)?.id ?? null });
}
export async function submitToolOuputsToRun(ctx: HandlerContext): Promise<Response> {
  const gone = timeline(ctx);
  if (gone) return gone;
  return (submitToolOutputs)(ctx);
}

export async function createRun(ctx: HandlerContext): Promise<Response> {
  const gone = timeline(ctx);
  if (gone) return gone;
  const found = thread(ctx);
  if ('answer' in found) return found.answer;
  const p = ctx.params;
  if (p.assistant_id === undefined || p.assistant_id === '') return invalid(ctx, 'you must provide an assistant_id parameter', 'assistant_id');
  const assistantId = String(p.assistant_id);
  const assistant = ctx.get(ASSISTANT, assistantId);
  if (!assistant) return ctx.notFound(ASSISTANT, assistantId);
  const created = epoch(ctx);
  const model = typeof p.model === 'string' && p.model ? p.model : String(assistant.model);
  const fields = {
    object: 'thread.run', created_at: created, thread_id: found.id, assistant_id: assistantId,
    status: 'queued', model, instructions: [p.instructions ?? assistant.instructions, p.additional_instructions].filter((v) => typeof v === 'string' && v.length).join('\n') || null,
    tools: Array.isArray(p.tools) ? p.tools : (assistant.tools ?? []),
    // the tool resources it runs with, its assistant's (the reference's cancelRun example; spec/patches.json)
    tool_resources: assistant.tool_resources ?? {},
    // a run in flight expires ten minutes after it was created; a completed one no longer does (the reference's
    // streamed run: `expires_at` 600 seconds past `created_at` until `thread.run.completed` answers it null)
    started_at: null, completed_at: null, expires_at: created + 600, cancelled_at: null, failed_at: null,
    required_action: null, last_error: null, usage: null, incomplete_details: null,
    // the request's sampling, else the assistant's (https://platform.openai.com/docs/api-reference/runs/object)
    temperature: p.temperature ?? assistant.temperature ?? 1, top_p: p.top_p ?? assistant.top_p ?? 1,
    // the request's settings as sent, or OpenAI's defaults for a run
    max_prompt_tokens: p.max_prompt_tokens ?? null, max_completion_tokens: p.max_completion_tokens ?? null,
    parallel_tool_calls: p.parallel_tool_calls ?? true, tool_choice: p.tool_choice ?? 'auto',
    response_format: p.response_format ?? assistant.response_format ?? 'auto', truncation_strategy: p.truncation_strategy ?? { type: 'auto', last_messages: null },
    metadata: objectOr(p.metadata, {}),
  };
  const created_ = await ctx.create(THREAD_RUN, fields, 'run.create');
  return p.stream === true ? streamRun(ctx, created_) : ctx.reply(created_);
}

// source: spec:createThread "Create a thread."
export async function createThread(ctx: HandlerContext): Promise<Response> {
  const gone = timeline(ctx); if (gone) return gone;
  const p = ctx.params;
  const row = await ctx.create(THREAD, { object: 'thread', created_at: epoch(ctx), metadata: objectOr(p.metadata, {}), tool_resources: objectOr(p.tool_resources, {}) }, 'thread.create');
  for (const message of Array.isArray(p.messages) ? p.messages : []) await append(ctx, String(row.id), message);
  return ctx.reply(row);
}
// source: spec:createMessage "Create a message."
export async function createMessage(ctx: HandlerContext): Promise<Response> {
  const gone = timeline(ctx); if (gone) return gone;
  const found = thread(ctx); if ('answer' in found) return found.answer;
  return ctx.reply(await append(ctx, found.id, ctx.params));
}
// source: spec:getRunStep "Retrieves a run step."
export async function getRunStep(ctx: HandlerContext): Promise<Response> {
  const gone = timeline(ctx); if (gone) return gone;
  await workRun(ctx, at(ctx, 'run_id'));
  const found = run(ctx); if ('answer' in found) return found.answer;
  const step = steps(found.run).find(s => s.id === at(ctx, 'step_id'));
  return step ? ctx.reply(step) : ctx.notFound('RunStepObject', at(ctx, 'step_id'));
}


// source: spec:cancelRun "Cancels a run that is `in_progress`."
export async function cancelRun(ctx: HandlerContext): Promise<Response> {
  const gone = timeline(ctx); if (gone) return gone;
  const found = run(ctx); if ('answer' in found) return found.answer;
  const id = at(ctx, 'run_id');
  let refusal: Parameters<HandlerContext['refuse']>[0] | undefined;
  // The vendor starts queued work in its own stored move before the caller cancels it.
  await ctx.asVendor(() => ctx.change(THREAD_RUN, id, (current) => {
    if (current.status !== 'queued') return undefined;
    const denied = ctx.legal(THREAD_RUN, 'status', 'cancelRun', 'queued', 'in_progress', id, 'vendor');
    return denied ? undefined : { status: 'in_progress', started_at: epoch(ctx) };
  }, 'run.update'));
  const row = await ctx.change(THREAD_RUN, id, (current) => {
    const from = String(current.status);
    refusal = ctx.legal(THREAD_RUN, 'status', 'cancelRun', from, 'cancelling', id);
    return refusal ? undefined : { status: 'cancelling', required_action: null, ...(current.started_at ? {} : { started_at: epoch(ctx) }) };
  }, 'run.cancel');
  return refusal ? ctx.refuse(refusal) : row ? ctx.reply(row) : ctx.notFound(THREAD_RUN, id);
}
