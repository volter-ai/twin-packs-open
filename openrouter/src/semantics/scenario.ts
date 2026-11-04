// The kernel scenario grammar, with OpenRouter's operation vocabulary and error envelopes.
// Successful scripted turns are compute only; account/key/exchange operations accept faults only.
import { anthropicWire, openaiWire, type PackScenario } from '@volter/world-core';
import { obj } from './shared.ts';

const turns = ['sendChatCompletionRequest', 'createResponses', 'createMessages'];
const operations = [...turns, 'exchangeAuthCodeForAPIKey', 'getCurrentKey', 'getModels'];
const base = openaiWire.scenario('openrouter', turns, (status, message) => ({ error: { code: status, message } }),
  { createMessages: anthropicWire.messagesWireRequest });
type WireRequest = ReturnType<typeof base.request> & { operation: string };

export const scenario: PackScenario<WireRequest> = {
  operations,
  request: (ctx) => ({ ...base.request(ctx)!, operation: ctx.call.operation.id }),
  adapter: {
    ...base.adapter,
    admits: (r, respond) => turns.includes(r.operation) && (base.adapter.admits?.(r, respond) ?? true),
    features: (r) => ({ ...base.adapter.features(r), operation: r.operation }),
    matchers: { ...base.adapter.matchers, operationEquals: (r, c) => r.operation === c },
    validateOn: (on) => on.operationEquals !== undefined && !operations.includes(String(on.operationEquals))
      ? 'operationEquals names a served operation' : base.adapter.validateOn!(on),
    validateRespond: (respond, handler) => {
      if (handler.on.operationEquals !== undefined && !turns.includes(String(handler.on.operationEquals)))
        return 'Stored mutations and catalogue/key reads accept faults only; seed accounts and keys through their doors.';
      if (handler.on.operationEquals === undefined && !Object.keys(handler.on).some((k) => k !== 'nthCall'))
        return 'A success-shaped catch-all must name a compute operation with operationEquals.';
      return base.adapter.validateRespond!(respond, handler);
    },
    validateGenerationFault: (fault, handler) => {
      if (!turns.includes(String(handler.on.operationEquals))) return 'Generation faults must name a compute operation with operationEquals.';
      if (fault.event !== undefined && (handler.on.operationEquals !== 'createResponses' || !['response.failed', 'response.error', 'error'].includes(fault.event))) return 'Only Responses generation faults name response.failed, response.error or error.';
      return null;
    },
    renderFault: (fault, r) => {
      // source: spec:/components/schemas/AnthropicMessagesErrorResponse/description "Error response from the Anthropic Messages API"
      if (r.operation === 'createMessages') {
        const types: Record<number, string> = { 400: 'invalid_request_error', 401: 'authentication_error', 403: 'permission_error', 404: 'not_found_error', 429: 'rate_limit_error', 402: 'billing_error', 500: 'api_error', 502: 'api_error', 504: 'timeout_error', 503: 'overloaded_error', 529: 'overloaded_error' };
        return { body: { type: 'error', error: { type: types[fault.status] ?? 'api_error', error_type: fault.errorType ?? ({ 400: 'invalid_request', 401: 'authentication', 402: 'payment_required', 403: 'permission_denied', 404: 'not_found', 429: 'rate_limit_exceeded', 500: 'server', 502: 'provider_unavailable', 503: 'provider_overloaded', 504: 'timeout', 529: 'provider_overloaded' } as Record<number, string>)[fault.status] ?? 'server', message: fault.message ?? 'Internal server error' }, request_id: null } };
      }
      // source: https://openrouter.ai/docs/api_reference/errors-and-debugging "The HTTP Response will have the same status code as error.code"
      return { body: { error: { code: fault.status, message: fault.message ?? (fault.status === 402 ? 'Insufficient credits. Add more using https://openrouter.ai/credits' : fault.status === 429 ? 'Rate limit exceeded' : fault.status === 502 ? 'Provider returned error' : 'The request was refused by a scripted fault.'), ...(fault.metadata || fault.errorType ? { metadata: { ...fault.metadata, ...(fault.errorType ? { error_type: fault.errorType } : {}) } } : {}) } } };
    },
  },
};
