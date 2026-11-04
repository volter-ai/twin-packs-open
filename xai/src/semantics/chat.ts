import { openaiWire, type HandlerContext } from '@volter/world-core';
import { MODELS, noModel, xaiError, obj, arr, stubReasoning, sse, chatUsage } from './shared.ts';

// source: spec:handle_generic_completion_request "Create a chat response from text/image chat prompts."
export async function handle_generic_completion_request(ctx: HandlerContext): Promise<Response> {
  const b = obj(ctx.body);
  const model = String(b.model ?? '');
  if (!MODELS.has(model)) return noModel(model);
  const messages = arr(b.messages);
  if (!messages.length) return xaiError(422, 'Client specified an invalid argument', 'messages: must contain at least one message');
  const t = openaiWire.scenarioTurn(ctx.scenario) ?? openaiWire.chatStubTurn(b, 'xAI API twin');
  // Issue a private identity for this answer and its tool calls; it is bookkeeping, not a vendor write.
  const completion = await ctx.issue('_completion');
  const shape: openaiWire.ChatShape = {
    id: ctx.crypto.uuidFrom(`xai-completion:${ctx.occurredAt}:${completion}`), model, created: Math.floor(Date.parse(ctx.occurredAt) / 1000),
    turn: { ...t, reasoning: t.reasoning ?? stubReasoning(model, openaiWire.chatLastUserText(messages)) }, messages, callId: (i) => `call_${ctx.crypto.digest('sha256', `${completion}:call:${i}`, 'hex').slice(0, 24)}`,
    maxTokens: typeof b.max_completion_tokens === 'number' ? b.max_completion_tokens : typeof b.max_tokens === 'number' ? b.max_tokens : undefined,
    extra: { system_fingerprint: 'fp_twin_stub', service_tier: b.service_tier ?? 'default' }, reasoningField: 'reasoning_content',
  };
  // source: spec:/components/schemas/Usage "Number of individual live search source used."
  shape.usageExtra = chatUsage(shape);
  // source: spec:handle_generic_completion_request "Create a chat response from text/image chat prompts."
  return b.stream === true ? sse(openaiWire.chatCompletionSSE(shape)) : Response.json(openaiWire.chatCompletion(shape));
}

