// Assistants API (beta) semantics: assistants, threads, their messages, and runs with their steps.
// Reads and deletes are the derived core's: an assistant, a thread, and a thread's messages (each
// under its thread), and cancelling a run (the machine in ../manifest.ts moves its `status`). A run
// is created `queued`, as OpenAI creates it; it cannot invoke a model, so when a read of it first
// looks (shared.ts) a run with function tools stops at `requires_action` for them (the placeholder
// model calls them) and, once their outputs are submitted, completes, appending a labeled stub reply to
// its thread; its steps (a tool-call step, a message-creation step) are read off the run, never stored;
// a cancelled run ends `cancelled`.
import type { HandlerContext  } from '@volter/world-core';
import { ASSISTANT, assistantFields, epoch, invalid, pick, timeline, toolResources } from './shared.ts';

// ── assistants ──────────────────────────────────────────────────────────────────────────────

export async function createAssistant(ctx: HandlerContext): Promise<Response> {
  const gone = timeline(ctx);
  if (gone) return gone;
  const p = ctx.params;
  if (p.model === undefined || p.model === '') return invalid(ctx, 'you must provide a model parameter', 'model');
  return ctx.reply(await ctx.create(ASSISTANT, assistantFields(p, epoch(ctx)), 'assistant.create'));
}

// modify replaces only the fields the request names
export async function modifyAssistant(ctx: HandlerContext): Promise<Response> {
  const gone = timeline(ctx);
  if (gone) return gone;
  const id = String(ctx.id);
  const current = ctx.get(ASSISTANT, id);
  if (!current) return ctx.notFound(ASSISTANT, id);
  const fields = pick(ctx.params, ['name', 'description', 'model', 'instructions', 'tools', 'tool_resources', 'metadata', 'temperature', 'top_p', 'response_format']);
  if (fields.tools !== undefined || fields.tool_resources !== undefined) fields.tool_resources = toolResources(fields.tools ?? current.tools, fields.tool_resources ?? current.tool_resources);
  return ctx.reply(await ctx.write(ASSISTANT, id, fields, 'assistant.update'));
}

