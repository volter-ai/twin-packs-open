// Gateway's behaviour (docs/contributing/architecture.md, "Behaviour"): a generative pack, and a turn is a scripted
// scenario's when the World loads one (handlers/merge.json), else the labeled deterministic stub, never a model. One
// scenario scripts the three surfaces alike (the kernel's openaiWire.scenario; the Messages surface's request read by
// anthropicWire's reader); a fault is answered in Gateway's error envelope.
import { anthropicWire, openaiWire } from '@volter/world-core';
import { nativeResponsesBody } from './shared.ts';

// source: https://docs.merge.dev/merge-gateway/errors "Broad category:"
// source: https://docs.merge.dev/merge-gateway/errors "Transient vendor failure, overload, or a stalled stream"
const TYPES: Record<number, string> = { 400: 'invalid_request_error', 401: 'invalid_api_key', 402: 'budget_exceeded', 403: 'permission_error', 404: 'not_found_error', 429: 'rate_limit_error', 500: 'internal_error', 503: 'provider_error' };

export const scenario = openaiWire.scenario('merge', ['chatCompletions_create', 'responses_create', 'messages_create'], (status, message) => ({
  error: { type: TYPES[status] ?? (status >= 500 ? 'provider_error' : 'invalid_request_error'), message: message ?? 'The request was refused by a scripted fault.', param: null, source: status >= 500 ? 'provider' : 'gateway', provider: null },
}), { messages_create: anthropicWire.messagesWireRequest, responses_create: (body) => openaiWire.wireRequest(nativeResponsesBody(body)) });
