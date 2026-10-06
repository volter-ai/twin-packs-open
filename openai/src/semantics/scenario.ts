// OpenAI's behaviour (docs/contributing/architecture.md, "Behaviour"): openai is a generative pack, and a chat
// completion or a response is a scripted scenario's turn when the World loads one (the MSW-shaped handlers of the world
// dir's handlers/openai.json), else the labeled deterministic stub, never a model. The kernel loads the scenario, decides
// the turn of each operation named here, answers a fault it scripts at once (before anything is written) in OpenAI's
// error body, and hands the decision to the handler as `ctx.scenario`. What is OpenAI's: the request a turn is (its
// model, messages, tools and output cap, the previous response's items included), the `on` keys a handler matches on and
// the `respond` it may script.
import type { PackScenario, PackScenarioAdapter, ScenarioFeatures } from '@volter/world-core';
import { type ChatMessageParam, contentToText, FINISH_REASONS, lastUserText, nonEmptyString, type OpenAIScenarioRequest, positiveNumber, RESPOND_KEYS, scenarioRequest } from './shared.ts';

function lastToolResultNames(messages: ChatMessageParam[]): Set<string> {
  const names = new Set<string>();
  const last = messages[messages.length - 1] as { role?: string; tool_call_id?: unknown } | undefined;
  if (!last || last.role !== 'tool' || typeof last.tool_call_id !== 'string') return names;
  for (const m of messages) {
    const am = m as { role?: string; tool_calls?: Array<{ id?: unknown; function?: { name?: unknown } }> };
    if (am.role !== 'assistant' || !Array.isArray(am.tool_calls)) continue;
    for (const tc of am.tool_calls) {
      if (tc?.id === last.tool_call_id && typeof tc?.function?.name === 'string') names.add(tc.function.name);
    }
  }
  return names;
}
function toolNames(tools: unknown): string[] {
  if (!Array.isArray(tools)) return [];
  return (tools as Array<{ function?: { name?: unknown }; name?: unknown }>).map((t) =>
    typeof t?.function?.name === 'string' ? t.function.name : typeof t?.name === 'string' ? t.name : null,
  ).filter((n): n is string => n !== null);
}
const renderFault: PackScenarioAdapter<OpenAIScenarioRequest>['renderFault'] = (f) => ({
    body: {
      error: {
        message: f.message ?? (f.status === 429 ? 'Rate limit reached for requests. Limit your request rate or retry after the indicated delay.' : f.status >= 500 ? 'The server had an error while processing your request. Sorry about that!' : 'The request was refused by a scripted fault.'),
        type: f.status === 429 ? 'rate_limit_exceeded' : f.status >= 500 ? 'server_error' : 'invalid_request_error',
        param: null,
        code: f.status === 429 ? 'rate_limit_exceeded' : null,
      },
    },
  });

const features: PackScenarioAdapter<OpenAIScenarioRequest>['features'] = (req): ScenarioFeatures => ({
    model: req.model,
    lastUserText: lastUserText(req.messages).slice(0, 300),
    tools: toolNames(req.tools),
    lastMessageIsToolResult: (req.messages[req.messages.length - 1] as { role?: string } | undefined)?.role === 'tool',
    toolResultFor: [...lastToolResultNames(req.messages)],
    // The output cap the caller asked for (max_tokens / max_completion_tokens), or 0 when it sent none. A
    // proxy between the agent and this twin may clamp it; a handler keyed on it makes that clamp visible.
    maxTokens: req.maxTokens ?? 0,
  });

const validateOn: PackScenarioAdapter<OpenAIScenarioRequest>['validateOn'] = (on) => {
    for (const k of ['modelEquals', 'userTextIncludes', 'anyTextIncludes', 'lastMessageTextIncludes', 'toolResultFor', 'hasTool'] as const) if (on[k] !== undefined && (typeof on[k] !== 'string' || !on[k])) return `on.${k} is a non-empty string`;
    if (on.lastMessageIsToolResult !== undefined && typeof on.lastMessageIsToolResult !== 'boolean') return 'on.lastMessageIsToolResult is a boolean';
    for (const k of ['maxTokensBelow', 'maxTokensAtLeast'] as const) if (on[k] !== undefined && !positiveNumber(on[k])) return `on.${k} is a positive number`;
    return null;
  };

const validateRespond: PackScenarioAdapter<OpenAIScenarioRequest>['validateRespond'] = (respond) => {
    if (typeof respond !== 'object' || respond === null || Array.isArray(respond)) return 'respond is an object { text?, toolCalls?, finishReason? }';
    const r = respond as Record<string, unknown>;
    for (const k of Object.keys(r)) if (!RESPOND_KEYS.has(k)) return `respond: unknown key "${k}" (valid: ${[...RESPOND_KEYS].join(', ')})`;
    if (r.text !== undefined && typeof r.text !== 'string') return 'respond.text is a string';
    if (r.finishReason !== undefined && (typeof r.finishReason !== 'string' || !FINISH_REASONS.has(r.finishReason))) return `respond.finishReason is one of ${[...FINISH_REASONS].join(', ')}`;
    if (r.toolCalls !== undefined) {
      for (const tc of Array.isArray(r.toolCalls) ? r.toolCalls : [r.toolCalls]) {
        const t = tc as Record<string, unknown>;
        if (!t || typeof t !== 'object' || Array.isArray(t)) return 'respond.toolCalls entries are objects';
        if (typeof t.name !== 'string' || !t.name) return 'respond.toolCalls[].name is a non-empty string';
        if (!t.arguments || typeof t.arguments !== 'object' || Array.isArray(t.arguments)) return 'respond.toolCalls[].arguments is an object';
        if (t.id !== undefined && typeof t.id !== 'string') return 'respond.toolCalls[].id is a string';
      }
    }
    if (r.text === undefined && r.toolCalls === undefined) return 'respond needs text or toolCalls';
    return null;
  };

const adapter: PackScenarioAdapter<OpenAIScenarioRequest> = {
  // a turn that calls a tool is no answer to a request that forbids one: the next handler that matches answers, else the stub
  // source: https://platform.openai.com/docs/api-reference/chat/create "none means the model will not call any tool and instead generates a message"
  admits: (r, respond) => !(r.toolChoice === 'none' && (respond as { toolCalls?: unknown } | undefined)?.toolCalls !== undefined),
  // R15 — a status fault in THIS vendor's envelope: the same {error:{message,type,param,code}}
  // semantics/shared.ts serves for its own refusals (its 429 is `type: 'rate_limit_exceeded'`).
  renderFault,
  vendor: 'openai',
  features,
  matchers: {
    modelEquals: (req, cond) => nonEmptyString(cond) && req.model === cond,
    userTextIncludes: (req, cond) => nonEmptyString(cond) && lastUserText(req.messages).toLowerCase().includes(cond.toLowerCase()),
    anyTextIncludes: (req, cond) => nonEmptyString(cond) && req.messages.map((m) => contentToText(m.content)).join('\n').toLowerCase().includes(cond.toLowerCase()),
    // the latest message alone (a tool's result just returned, not one from earlier in the conversation)
    lastMessageTextIncludes: (req, cond) => nonEmptyString(cond) && contentToText((req.messages[req.messages.length - 1] as { content?: unknown } | undefined)?.content as never).toLowerCase().includes(cond.toLowerCase()),
    lastMessageIsToolResult: (req, cond) => typeof cond === 'boolean' && ((req.messages[req.messages.length - 1] as { role?: string } | undefined)?.role === 'tool') === cond,
    toolResultFor: (req, cond) => nonEmptyString(cond) && lastToolResultNames(req.messages).has(cond),
    hasTool: (req, cond) => nonEmptyString(cond) && toolNames(req.tools).includes(cond),
    // A request whose output cap is below N (a cap it did not send counts as below every N).
    maxTokensBelow: (req, cond) => positiveNumber(cond) && (req.maxTokens ?? 0) < cond,
    maxTokensAtLeast: (req, cond) => positiveNumber(cond) && (req.maxTokens ?? 0) >= cond,
  },
  text: (req) => req.messages.map((m) => contentToText(m.content)).join('\n'),
  validateOn,
  validateRespond,
};

export const scenario: PackScenario<OpenAIScenarioRequest> = {
  adapter,
  operations: ['createChatCompletion', 'createResponse'],
  request: (ctx) => scenarioRequest(ctx, ctx.call.operation.id),
};
