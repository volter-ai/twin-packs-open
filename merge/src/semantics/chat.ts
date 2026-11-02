// OpenAI's chat completions on Gateway (streamed and not): the turn is the World's scenario's when it scripts one, else
// the labeled stub of the kernel's openaiWire. THE TWIN RUNS NO MODEL. Priced, drawn from the organization's credit,
// answered with its usage, its cost and, when asked, routing.
import { openaiWire, type HandlerContext } from '@volter/world-core';
import { admitted, arr, idOf, LABEL, obj, priced, routingAsked, routingOf, spend, turnHeaders } from './shared.ts';

// source: spec:chatCompletions_create "OpenAI-compatible chat completions endpoint."
export async function chatCompletions_create(ctx: HandlerContext): Promise<Response> {
  const a = admitted(ctx);
  if (a instanceof Response) return a;
  const { org, model, body } = a;
  const call = await ctx.issue('_call');
  let turn = openaiWire.scenarioTurn(ctx.scenario) ?? openaiWire.chatStubTurn(body, LABEL);
  // source: https://docs.merge.dev/merge-gateway/api-overview "limits the model to one tool call per turn"
  if (body.parallel_tool_calls === false && turn.toolCalls) turn = { ...turn, toolCalls: turn.toolCalls.slice(0, 1) };
  const shape: openaiWire.ChatShape = {
    id: `chatcmpl-${idOf(ctx, call, 'chat')}`, model: model.id, created: Math.floor(Date.parse(ctx.occurredAt) / 1000), turn, messages: arr(body.messages),
    callId: (i) => `call_${idOf(ctx, call, `call${i}`)}`,
    maxTokens: typeof body.max_completion_tokens === 'number' ? body.max_completion_tokens : typeof body.max_tokens === 'number' ? body.max_tokens : undefined,
  };
  const usage = obj(openaiWire.chatCompletion(shape).usage);
  const charge = priced(model, Number(usage.prompt_tokens), Number(usage.completion_tokens));
  // source: https://docs.merge.dev/merge-gateway/streaming "a final chunk with finish_reason, usage (with cost), service_tier, and routing"
  shape.usageExtra = { cost: charge.cost };
  shape.extra = { service_tier: 'standard', ...(routingAsked(ctx, body) ? { routing: routingOf(model, String(body.model), charge) } : {}) };
  // source: https://docs.merge.dev/merge-gateway/streaming "Interim frames report service_tier: null"
  shape.interimExtra = { service_tier: null };
  await spend(ctx, org, charge);
  return body.stream === true ? new Response(openaiWire.chatCompletionSSE(shape), { headers: turnHeaders(ctx, call, model, true) }) : Response.json(openaiWire.chatCompletion(shape), { headers: turnHeaders(ctx, call, model, false) });
}
