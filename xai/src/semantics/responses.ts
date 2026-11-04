import { openaiWire, type HandlerContext } from '@volter/world-core';
import { MODELS, noModel, xaiError, obj, stubReasoning, sse, responseView, responseStream } from './shared.ts';

// source: spec:handle_generic_model_request "Generates a response based on text or image prompts."
export async function handle_generic_model_request(ctx: HandlerContext): Promise<Response> {
  const b = obj(ctx.body);
  const model = String(b.model ?? '');
  if (!MODELS.has(model)) return noModel(model);
  if (b.input === undefined || (Array.isArray(b.input) && !b.input.length)) return xaiError(422, 'Client specified an invalid argument', 'input: must be a string or at least one item');
  // Stored-context continuation has no measured caller; do not invent a successful conversation.
  // source: spec:handle_generic_model_request "The response ID can be used to retrieve the response later or to continue the conversation"
  if (b.previous_response_id) return xaiError(404, 'Some requested entity was not found', 'Stored response continuation is outside this twin surface.');
  const t = openaiWire.scenarioTurn(ctx.scenario) ?? openaiWire.responsesStubTurn(b, 'xAI API twin');
  // Issue a private identity for this answer and its items; it is bookkeeping, not a vendor write.
  const response = await ctx.issue('_response');
  const shape: openaiWire.ResponsesShape = {
    id: ctx.crypto.uuidFrom(`xai-response:${ctx.occurredAt}:${response}`), model, createdAt: Math.floor(Date.parse(ctx.occurredAt) / 1000),
    turn: { ...t, reasoning: t.reasoning ?? stubReasoning(model, openaiWire.responsesLastUserText(b.input)) }, body: b,
    itemId: (kind, i) => `${kind}_${ctx.crypto.digest('sha256', `${response}:${kind}:${i}`, 'hex').slice(0, 24)}`,
  };
  // source: spec:handle_generic_model_request "Generates a response based on text or image prompts."
  return b.stream === true ? sse(responseStream(openaiWire.responsesSSE(shape), b)) : Response.json(responseView(openaiWire.responsesAnswer(shape), b));
}
