// The AI Gateway's behaviour (docs/contributing/architecture.md, "Behaviour"): a generative pack, and a turn is a
// scripted scenario's when the World loads one (handlers/ai-gateway.json), else the labeled deterministic stub, never a
// model. The scenario is the kernel wire's (openaiWire.scenario), which reads a chat completion and an AI SDK call alike;
// a fault is answered in the gateway's error body.
import { openaiWire, type PackScenario } from '@volter/world-core';
import { evaluationResponseError } from '../engine/evaluation.ts';
import { obj } from './shared.ts';

const chat = openaiWire.scenario('ai-gateway', ['createChatCompletion', 'languageModel'], (status, message) => ({
  error: { message: message ?? (status === 429 ? 'Rate limit exceeded' : 'The request was refused by a scripted fault.'), type: status === 429 ? 'rate_limit_exceeded' : 'internal_server_error', param: null, code: null },
}));

export const scenario: PackScenario<openaiWire.WireRequest & { evaluation?: boolean }> = {
  ...chat,
  operations: [...chat.operations, 'evaluationModel'],
  adapter: {
    ...chat.adapter,
    validateRespond: (respond, handler) => obj(respond).answers !== undefined ? evaluationResponseError(respond) : chat.adapter.validateRespond!(respond, handler),
    admits: (request, respond) => Boolean(request.evaluation) === (obj(respond).answers !== undefined) && chat.adapter.admits!(request, respond),
  },
  request(ctx) {
    if (ctx.call.operation.id !== 'evaluationModel') return chat.request(ctx);
    return { ...openaiWire.wireRequest({ model: ctx.call.request.headers.get('ai-model-id'), messages: [{ role: 'user', content: JSON.stringify(ctx.body) }] }), evaluation: true };
  },
};
