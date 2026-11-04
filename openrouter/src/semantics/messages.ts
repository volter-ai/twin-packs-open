// Anthropic's Messages on OpenRouter (spec: createMessages; docs/cookbook/coding-agents/claude-code-integration): what
// Claude Code calls when its ANTHROPIC_BASE_URL is https://openrouter.ai/api and its ANTHROPIC_AUTH_TOKEN an OpenRouter
// key, as Volter Editor launches it for BYOK coding. A turn on the kernel's Messages wire (anthropicWire), streamed or
// whole, the World's scenario's when it scripts one, else the labeled stub: the twin runs no model. Its refusals are in
// the Anthropic error body this surface answers; the kernel selects that auth wire before scenario matching.
import { anthropicWire, openaiWire, type HandlerContext } from '@volter/world-core';
import { generationFailure, arr, idOf, LABEL, messagesError, obj, SSE, validModel } from './shared.ts';

// source: spec:createMessages "Creates a message using the Anthropic Messages API format. Supports text, images, PDFs, tools, and extended thinking."
export async function createMessages(ctx: HandlerContext): Promise<Response> {
  // source: https://openrouter.ai/docs/cookbook/coding-agents/claude-code-integration "OpenRouter is an LLM gateway that authenticates requests with a bearer token"
  // source: spec:createMessages "Invalid API key"
  const body = obj(ctx.body);
  // source: spec:createMessages "Invalid request: messages is required"
  if (!arr(body.messages).length) return messagesError(400, 'invalid_request_error', 'Invalid request: messages is required');
  // source: spec:createMessages "Model not found"
  if (!validModel(body.model, ctx.occurredAt)) return messagesError(404, 'not_found_error', 'Model not found');
  const generation = await ctx.issue('_generation');
  const failed = generationFailure(ctx, generation, 'messages', body);
  if (failed) return failed;
  const turn = openaiWire.scenarioTurn(ctx.scenario) ?? anthropicWire.messagesStubTurn(body, LABEL);
  const m = anthropicWire.message({
    // source: spec:createMessages "msg_abc123"
    id: `msg_${generation}`, model: String(body.model), turn, body,
    toolId: (i) => `toolu_${idOf(ctx, generation, `tool${i}`)}`,
    signature: (thinking) => ctx.crypto.digest('sha256', `openrouter:signature:${generation}:${thinking}`, 'base64'),
    // source: spec:createMessages "service_tier"
    usage: { service_tier: 'standard', cache_creation: null, inference_geo: null, output_tokens_details: null, server_tool_use: null },
  });
  // source: spec:createMessages "citations"
  for (const block of m.content as Array<Record<string, unknown>>) if (block.type === 'text') block.citations = [];
  // source: spec:createMessages "container"
  m.container = null;
  // source: spec:createMessages "stop_details"
  m.stop_details = null;
  // source: https://openrouter.ai/docs/api_reference/streaming "X-Generation-Id"
  const headers = { ...SSE, 'X-Generation-Id': `gen-${generation}` };
  return body.stream === true ? new Response(anthropicWire.messageSSE(m), { headers }) : Response.json(m, { headers: { 'X-Generation-Id': headers['X-Generation-Id'] } });
}
