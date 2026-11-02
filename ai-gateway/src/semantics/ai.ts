// AI SDK LanguageModelV4 generate results and stream parts.
import { openaiWire, type HandlerContext } from '@volter/world-core';
import { obj, shapeOf, gatewayError, languageModel as refuseModel } from './shared.ts';
import { evaluationQuestionsError, evaluationStub } from '../engine/evaluation.ts';

// source: https://unpkg.com/@ai-sdk/gateway@4.0.87/dist/index.js "ai-evaluation-model-specification-version"
export async function evaluationModel(ctx: HandlerContext): Promise<Response> {
  const model = ctx.call.request.headers.get('ai-model-id');
  // The SDK documents the native headers and body, but not exact invalid-request wording.
  if (!model) return gatewayError(400, 'invalid_request_error', 'Missing ai-model-id', 'ai-model-id', 'missing_parameter');
  const body = obj(ctx.body);
  const invalid = evaluationQuestionsError(body.questions);
  if (invalid) return gatewayError(400, 'invalid_request_error', invalid, 'questions', 'invalid_parameter');
  const scripted = ctx.scenario?.kind === 'handler' ? obj(ctx.scenario.respond) : undefined;
  return Response.json(scripted?.answers ? scripted : evaluationStub(obj(body.questions)));
}

// source: https://unpkg.com/@ai-sdk/gateway@4.0.80/dist/index.js "return `${this.config.baseURL}/language-model`;"
export async function languageModel(ctx: HandlerContext): Promise<Response> {
  const h = ctx.call.request.headers;
  const model = h.get('ai-language-model-id') ?? '';
  if (!model) return gatewayError(400, 'invalid_request_error', "Invalid request: missing required header 'ai-language-model-id'", 'ai-language-model-id', 'missing_parameter');
  const refused = refuseModel(model);
  if (refused) return refused;
  const call = obj(ctx.body);
  if (!Array.isArray(call.prompt)) return gatewayError(400, 'invalid_request_error', "Invalid request: missing required parameter 'prompt'", 'prompt', 'missing_parameter');
  const shape = await shapeOf(ctx, openaiWire.aiSdkChatBody(call, model), model);
  shape.extra = { providerMetadata: { gateway: { generationId: shape.id, cost: '0' } } };
  return h.get('ai-language-model-streaming') === 'true'
    ? new Response(openaiWire.languageModelSSE(shape), { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' } })
    : Response.json(openaiWire.languageModelResult(shape));
}
