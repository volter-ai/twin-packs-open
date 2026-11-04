// Chat completions (spec: sendChatCompletionRequest; the API reference overview): a turn answered as OpenRouter answers
// one, on the kernel's OpenAI-compatible wire (openaiWire) with OpenRouter's own facts: a `gen-` id, the provider that
// served it, the normalized and the provider's native finish reasons, the reasoning when asked, the usage with its cost,
// and in a stream its keep-alive comment. The turn is the World's scenario's when it scripts one (ctx.scenario), else
// the labeled stub: the twin runs no model.
import { openaiWire, type HandlerContext } from '@volter/world-core';
import { generationFailure, arr, LABEL, obj, orError, providerOf, SSE, unixNow, validModel } from './shared.ts';

// source: spec:sendChatCompletionRequest "Sends a request for a model response for the given chat conversation."
export async function sendChatCompletionRequest(ctx: HandlerContext): Promise<Response> {
  const b = obj(ctx.body);
  const model = b.model ?? (Array.isArray(b.models) ? (b.models as unknown[])[0] : undefined);
  // Where the documentation stops: the refusal's wording is OpenRouter's as its clients report it
  if (!validModel(model, ctx.occurredAt)) return orError(400, `${String(model ?? '')} is not a valid model ID`);
  const messages = arr(b.messages);
  if (!messages.length) return orError(400, 'Input required: specify "prompt" or "messages"');
  const t = openaiWire.scenarioTurn(ctx.scenario) ?? openaiWire.chatStubTurn({ ...b, model }, LABEL);
  // reasoning, when asked and not excluded, is carried in the message (the stub's says what it was about)
  // source: spec:/components/schemas/ChatRequest/properties/reasoning_effort/description "Equivalent to setting reasoning.effort."
  const configuration = obj(b.reasoning);
  if (b.reasoning_effort !== undefined && configuration.effort !== undefined && b.reasoning_effort !== configuration.effort) return orError(400, 'Conflicting reasoning effort values');
  const effort = b.reasoning_effort ?? configuration.effort;
  const excluded = configuration.exclude === true || configuration.enabled === false || effort === 'none';
  const asked = !excluded && (b.reasoning !== undefined || b.reasoning_effort !== undefined);
  const reasoning = excluded ? null : t.reasoning ?? (asked ? `[twin-stub] Reasoning about: ${openaiWire.chatText(messages.at(-1)?.content).slice(0, 120) || '(empty)'}` : null);
  // the generation's id, issued: each call's is another (ctx.issue)
  const completion = await ctx.issue('_generation');
  const failed = generationFailure(ctx, completion, 'chat', b);
  if (failed) return failed;
  const shape: openaiWire.ChatShape = {
    id: `gen-${unixNow(ctx)}-${completion}`, model: String(model), created: unixNow(ctx),
    turn: { ...t, reasoning }, messages, callId: (i) => `call_${ctx.crypto.digest('sha256', `${completion}:call:${i}`, 'hex').slice(0, 24)}`, nativeFinish: true,
    maxTokens: typeof b.max_completion_tokens === 'number' ? b.max_completion_tokens : typeof b.max_tokens === 'number' ? b.max_tokens : undefined,
    extra: { provider: providerOf(String(model)) },
    // Where the documentation stops: a generation's cost is its model's price on OpenRouter's catalogue; the twin charges
    // nothing and says so
    usageExtra: { cost: 0 },
  };
  // source: https://openrouter.ai/docs/api_reference/streaming ": OPENROUTER PROCESSING"
  // source: https://openrouter.ai/docs/api_reference/streaming "the terminal finish_reason appears twice"
  // source: https://openrouter.ai/docs/api_reference/streaming "X-Generation-Id"
  const headers = { ...SSE, 'X-Generation-Id': shape.id };
  return b.stream === true
    ? new Response(openaiWire.chatCompletionSSE({ ...shape, comment: 'OPENROUTER PROCESSING', separateUsageChunk: true }), { headers })
    // a completion names its system fingerprint, which the result requires (null admitted); the twin runs no provider, so
    // it has none to name
    // source: spec:/components/schemas/ChatResult/properties/system_fingerprint "System fingerprint"
    : Response.json({ ...openaiWire.chatCompletion(shape), system_fingerprint: null }, { headers: { 'X-Generation-Id': shape.id } });
}
