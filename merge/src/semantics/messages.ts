// Anthropic's Messages on Gateway (streamed and not), on the kernel's anthropicWire: the turn is the scenario's when it
// scripts one, else the labeled stub. THE TWIN RUNS NO MODEL. Its usage carries no cost.
import { anthropicWire, openaiWire, type HandlerContext } from '@volter/world-core';
import { admitted, idOf, LABEL, obj, priced, routingAsked, routingOf, spend, turnHeaders } from './shared.ts';

// source: spec:messages_create "Anthropic-compatible Messages endpoint."
export async function messages_create(ctx: HandlerContext): Promise<Response> {
  const a = admitted(ctx);
  if (a instanceof Response) return a;
  const { org, model, body } = a;
  const call = await ctx.issue('_call');
  const turn = openaiWire.scenarioTurn(ctx.scenario) ?? anthropicWire.messagesStubTurn(body, LABEL);
  const m = anthropicWire.message({
    id: `msg_${idOf(ctx, call, 'msg')}`, model: model.id, turn, body, toolId: (i) => `toolu_${idOf(ctx, call, `tool${i}`)}`,
    signature: (thinking) => ctx.crypto.digest('sha256', `merge:signature:${thinking}`, 'base64'),
  });
  const usage = obj(m.usage);
  const charge = priced(model, Number(usage.input_tokens), Number(usage.output_tokens));
  await spend(ctx, org, charge);
  const routing = routingAsked(ctx, body) ? { routing: routingOf(model, String(body.model), charge) } : {};
  // source: https://docs.merge.dev/merge-gateway/streaming "The last two also carry routing, guardrails, and warnings when present."
  // source: https://docs.merge.dev/merge-gateway/streaming "No ping events to use for liveness"
  // source: https://docs.merge.dev/merge-gateway/streaming "Tool-use input arrives as one complete input_json_delta"
  if (body.stream === true) return new Response(anthropicWire.messageSSE(m, routing, { ping: false, completeToolInput: true }), { headers: turnHeaders(ctx, call, model, true) });
  // source: https://docs.merge.dev/merge-gateway/streaming "is reported on non-streaming responses only"
  return Response.json({ ...m, usage: { ...usage, service_tier: 'standard' }, ...routing }, { headers: turnHeaders(ctx, call, model, false) });
}
