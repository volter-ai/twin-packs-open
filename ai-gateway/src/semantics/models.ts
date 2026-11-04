// Models: Vercel's catalogue (recorded), as the OpenAI-compatible API lists it.
import type { HandlerContext } from '@volter/world-core';
import { MODELS } from './shared.ts';

// source: https://vercel.com/docs/ai-gateway/sdks-and-apis/openai-chat-completions "Retrieve a list of all available models that can be used with the AI Gateway."
export async function listModels(_ctx: HandlerContext): Promise<Response> {
  return Response.json({ object: 'list', data: MODELS });
}
