// Gateway's native Responses (streamed as response.stream snapshots and a response.done, with no [DONE]): the turn is
// the scenario's when it scripts one, else the labeled stub. THE TWIN RUNS NO MODEL.
import { openaiWire, type HandlerContext } from '@volter/world-core';
import { admitted, arr, idOf, LABEL, nativeResponsesBody, nativeWarnings, obj, priced, routingAsked, routingOf, type Row, spend, turnHeaders } from './shared.ts';

// source: spec:responses_create "Create an LLM response in Gateway's native Responses shape."
export async function responses_create(ctx: HandlerContext): Promise<Response> {
  const a = admitted(ctx);
  if (a instanceof Response) return a;
  const { org, model, body } = a;
  const call = await ctx.issue('_call');
  const wireBody = nativeResponsesBody(body);
  let turn = openaiWire.scenarioTurn(ctx.scenario) ?? openaiWire.responsesStubTurn(wireBody, LABEL);
  // source: https://docs.merge.dev/merge-gateway/api-overview "limits the model to one tool call per turn"
  if (body.parallel_tool_calls === false && turn.toolCalls) turn = { ...turn, toolCalls: turn.toolCalls.slice(0, 1) };
  // source: spec:responses_create "max_output_tokens"
  const max = typeof body.max_tokens === 'number' ? body.max_tokens : typeof body.max_output_tokens === 'number' ? body.max_output_tokens : undefined;
  let text = turn.text ?? null;
  let cut = false;
  if (text !== null && max !== undefined && openaiWire.estimateTokens(text) > max) { text = text.slice(0, Math.max(1, max) * 4); cut = true; }
  const calls = turn.toolCalls ?? [];
  const content: Row[] = [...(text !== null ? [{ type: 'text', text, annotations: [] }] : []), ...calls.map((c, i) => ({ type: 'tool_use', id: `toolu_${idOf(ctx, call, `tool${i}`)}`, name: c.name, input: c.arguments ?? {} }))];
  // source: spec:/components/schemas/OutputMessageFinishReason "tool_use"
  const finish = cut ? 'max_tokens' : turn.finishReason === 'length' ? 'max_tokens' : turn.finishReason === 'tool_calls' ? 'tool_use' : turn.finishReason ?? (calls.length ? 'tool_use' : 'stop');
  const input = openaiWire.estimateTokens(openaiWire.wireRequest(wireBody).text);
  const output = openaiWire.estimateTokens([text ?? '', ...calls.map((c) => JSON.stringify(c.arguments ?? {}))].join(''));
  const charge = priced(model, input, output);
  const warnings = nativeWarnings(body);
  const done: Row = {
    id: `resp_${idOf(ctx, call, 'resp')}`, object: 'response', created_at: ctx.occurredAt, model: model.id, vendor: model.vendor, provider_request_id: null,
    output: [{ id: `msg_${idOf(ctx, call, 'msg')}`, type: 'message', role: 'assistant', finish_reason: finish, content }],
    usage: { input_tokens: input, output_tokens: output, total_tokens: input + output, cost: charge.cost },
    ...(routingAsked(ctx, body) ? { routing: routingOf(model, String(body.model), charge) } : {}), service_tier: 'standard', ...(warnings ? { warnings } : {}),
  };
  await spend(ctx, org, charge);
  if (body.stream !== true) return Response.json(done, { headers: turnHeaders(ctx, call, model, false) });
  // source: https://docs.merge.dev/merge-gateway/streaming "The full response so far. Each frame replaces the previous one"
  // source: https://docs.merge.dev/merge-gateway/streaming "There is no data: [DONE]."
  const half = text ? Math.ceil(text.length / 2) : 0;
  const snapshot = (t: string | null): Row => ({ ...done, object: 'response.stream', output: [{ ...obj(arr(done.output)[0]), finish_reason: null, content: t === null ? [] : [{ type: 'text', text: t, annotations: [] }] }], usage: null, routing: undefined, service_tier: null, warnings: undefined });
  const frames = [...(text ? [snapshot(text.slice(0, half)), snapshot(text)] : [snapshot(null)]), { ...done, object: 'response.done' }];
  return new Response(frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join(''), { headers: turnHeaders(ctx, call, model, true) });
}
