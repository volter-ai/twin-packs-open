// OpenAI-compatible Chat Completions, on the kernel wire. The World runs no model.
import { openaiWire, type HandlerContext } from '@volter/world-core';
import { obj, arr, shapeOf, optionsRefusal, gatewayError, languageModel as refuseModel } from './shared.ts';

// source: https://vercel.com/docs/ai-gateway/sdks-and-apis/openai-chat-completions "Create chat completions, with support for"
export async function createChatCompletion(ctx: HandlerContext): Promise<Response> {
  const b = obj(ctx.body);
  if (typeof b.model !== 'string' || !b.model) return gatewayError(400, 'invalid_request_error', "Invalid request: missing required parameter 'model'", 'model', 'missing_parameter');
  const refused = refuseModel(b.model);
  if (refused) return refused;
  if (!arr(b.messages).length) return gatewayError(400, 'invalid_request_error', "Invalid request: missing required parameter 'messages'", 'messages', 'missing_parameter');
  const invalidOptions = optionsRefusal(b);
  if (invalidOptions) return invalidOptions;
  const shape = await shapeOf(ctx, b, b.model);
  return b.stream === true
    ? new Response(openaiWire.chatCompletionSSE(shape), { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' } })
    : Response.json(openaiWire.chatCompletion(shape));
}

