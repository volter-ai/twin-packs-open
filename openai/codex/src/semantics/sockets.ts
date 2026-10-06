import { openaiWire, type HandlerContext, type SocketEngine } from '@volter/world-core';
import { codexGrant, codexShape } from './shared.ts';
// source: https://raw.githubusercontent.com/openai/codex/78c290807ce710180111df227df3b7a4fe845452/codex-rs/codex-api/src/endpoint/responses_websocket.rs "previous_response_id"
// source: https://raw.githubusercontent.com/openai/codex/78c290807ce710180111df227df3b7a4fe845452/codex-rs/codex-api/src/endpoint/responses_websocket.rs "warmup: ws_request.generate == Some(false)"
export const codexResponses: SocketEngine<HandlerContext> = {
  open(session, ctx) { const auth = codexGrant(ctx); if (auth instanceof Response) { session.close(1008, 'Authentication required'); return; } session.state = { input: [], last: null }; },
  async message(session, data, ctx) {
    const auth = codexGrant(ctx);
    if (auth instanceof Response) { session.send({ type: 'error', status: auth.status, error: await auth.json() }); return; }
    let b: Record<string, unknown>;
    try { b = JSON.parse(data); } catch { session.send({ type: 'error', status: 400, error: { code: 'invalid_request', message: 'Invalid JSON.' } }); return; }
    if (b.type !== 'response.create' || typeof b.model !== 'string' || !Array.isArray(b.input)) { session.send({ type: 'error', status: 400, error: { code: 'invalid_request', message: 'response.create needs model and input.' } }); return; }
    // A previous response refers to this connection's last turn; disconnected history is not vendor-stored.
    if (b.previous_response_id && b.previous_response_id !== session.state.last) { session.send({ type: 'error', status: 400, error: { code: 'previous_response_not_found', message: 'Previous response is not available on this connection.' } }); return; }
    const input = b.previous_response_id ? [...session.state.input as unknown[], ...b.input] : b.input;
    const body = { ...b, input, stream: true, store: false };
    const decision = b.generate === false ? undefined : await session.decide(openaiWire.wireRequest(body));
    if (decision?.kind === 'fault') { session.send({ type: 'error', status: decision.result.status, error: decision.result.body }); return; }
    const turn = b.generate === false ? { text: '' } : openaiWire.scenarioTurn(decision) ?? openaiWire.responsesStubTurn(body, 'OpenAI Codex twin');
    const shape = codexShape(ctx, body, turn), answer = openaiWire.responsesAnswer(shape);
    for (const part of openaiWire.responsesSSE(shape).split('\n\n')) {
      const line = part.split('\n').find(l => l.startsWith('data: '));
      if (line) session.send(JSON.parse(line.slice(6)));
    }
    session.state.last = shape.id;
    session.state.input = [...input, ...answer.output as unknown[]];
    await ctx.write('_codex_call', shape.id, { _account: auth._account, _model: b.model, _usage: b.generate === false ? null : answer.usage }, 'codex.responses');
  },
};
