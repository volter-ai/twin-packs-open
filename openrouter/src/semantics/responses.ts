// The Responses API on OpenRouter (spec: createResponses; docs/api_reference/responses/overview): what Codex calls when
// Volter Editor points its wire_api responses at https://openrouter.ai/api/v1 for BYOK coding. A turn on the kernel's
// Responses wire (openaiWire), streamed as its events or whole, the World's scenario's when it scripts one, else the
// labeled stub: the twin runs no model.
import { openaiWire, type HandlerContext } from '@volter/world-core';
import { generationFailure, idOf, LABEL, obj, orError, SSE, unixNow, validModel } from './shared.ts';

// source: spec:createResponses "Creates a streaming or non-streaming response using OpenResponses API format"
export async function createResponses(ctx: HandlerContext): Promise<Response> {
  const body = obj(ctx.body);
  // Where the documentation stops: the refusals' words; their form and status are the spec's 400
  // source: spec:createResponses "Bad Request - Invalid request parameters or malformed input"
  // source: https://openrouter.ai/docs/api_reference/responses/overview "Missing required parameter: 'model'."
  if (body.model === undefined || body.model === null) return Response.json({ error: { code: 'invalid_prompt', message: "Missing required parameter: 'model'." }, metadata: null }, { status: 400 });
  if (!validModel(body.model, ctx.occurredAt)) return orError(400, `${String(body.model ?? '')} is not a valid model ID`);
  if (body.input === undefined || body.input === null || body.input === '') return orError(400, 'Invalid request parameters');
  // source: https://openrouter.ai/docs/api_reference/responses/overview "Requests that set store: true or a non-null previous_response_id are rejected with a 400 error."
  if (body.store === true || body.previous_response_id != null) return orError(400, 'Invalid request parameters');
  const generation = await ctx.issue('_generation');
  const failed = generationFailure(ctx, generation, 'responses', body);
  if (failed) return failed;
  const turn = openaiWire.scenarioTurn(ctx.scenario) ?? openaiWire.responsesStubTurn(body, LABEL);
  const created = unixNow(ctx);
  const shape: openaiWire.ResponsesShape = {
    // source: spec:createResponses "resp_abc123"
    id: `resp_${generation}`, model: String(body.model), createdAt: created, turn, body, defaults: { store: false, metadata: null, temperature: null, top_p: null },
    // source: spec:createResponses "msg-abc123"
    itemId: (kind, i) => (kind === 'call' ? `call_${idOf(ctx, generation, `call${i}`)}` : `${kind}-${idOf(ctx, generation, `${kind}${i}`)}`),
    // source: spec:createResponses "completed_at"
    extra: { completed_at: created, frequency_penalty: body.frequency_penalty ?? null, presence_penalty: body.presence_penalty ?? null },
  };
  // source: https://openrouter.ai/docs/api_reference/streaming "X-Generation-Id"
  const headers = { ...SSE, 'X-Generation-Id': `gen-${generation}` };
  return body.stream === true ? new Response(openaiWire.responsesSSE(shape), { headers }) : Response.json(openaiWire.responsesAnswer(shape), { headers: { 'X-Generation-Id': headers['X-Generation-Id'] } });
}
