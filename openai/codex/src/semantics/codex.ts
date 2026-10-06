import type { HandlerContext } from '@volter/world-core';
import { codexBody, codexCatalog, codexError, codexGrant, codexOpaque, codexShape, openaiWire } from './shared.ts';

// source: https://raw.githubusercontent.com/openai/codex/78c290807ce710180111df227df3b7a4fe845452/codex-rs/codex-api/src/endpoint/responses.rs "Self::Responses =>"
export async function codex_responses(ctx: HandlerContext): Promise<Response> {
  const auth = codexGrant(ctx); if (auth instanceof Response) return auth;
  const b = codexBody(ctx);
  if (typeof b.model !== 'string' || !b.model || !Array.isArray(b.input)) return codexError('invalid_request', 'model and input are required.');
  const turn = openaiWire.scenarioTurn(ctx.scenario) ?? openaiWire.responsesStubTurn(b, 'OpenAI Codex twin');
  const shape = codexShape(ctx, b, turn), answer = openaiWire.responsesAnswer(shape);
  // store:false does not create a vendor-readable response. This private call record is only the World's usage.
  // source: https://raw.githubusercontent.com/openai/codex/78c290807ce710180111df227df3b7a4fe845452/codex-rs/core/src/client.rs "store: false"
  await ctx.write('_codex_call', shape.id, { _account: auth._account, _model: b.model, _usage: answer.usage }, 'codex.responses');
  return b.stream === false ? Response.json(answer) : new Response(openaiWire.responsesSSE(shape), { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' } });
}
// source: https://raw.githubusercontent.com/openai/codex/78c290807ce710180111df227df3b7a4fe845452/codex-rs/codex-api/src/endpoint/compact.rs "Ok(parsed.output)"
export async function codex_compact(ctx: HandlerContext): Promise<Response> {
  const auth = codexGrant(ctx); if (auth instanceof Response) return auth;
  const b = codexBody(ctx);
  if (typeof b.model !== 'string' || !Array.isArray(b.input)) return codexError('invalid_request', 'model and input are required.');
  // No summarizing model runs: a labeled synthetic compaction item is returned in the accepted output shape.
  // source: https://raw.githubusercontent.com/openai/codex/78c290807ce710180111df227df3b7a4fe845452/codex-rs/codex-api/src/endpoint/compact.rs "output: Vec<ResponseItem>"
  return Response.json({ output: [...b.input, { type: 'compaction', encrypted_content: `twin-stub:${await codexOpaque(ctx, 'compaction')}` }] });
}
// source: https://raw.githubusercontent.com/openai/codex/78c290807ce710180111df227df3b7a4fe845452/codex-rs/codex-api/src/endpoint/models.rs "let ModelsResponse { models }"
export async function codex_models(ctx: HandlerContext): Promise<Response> {
  const auth = codexGrant(ctx); if (auth instanceof Response) return auth;
  return Response.json({ models: codexCatalog });
}
