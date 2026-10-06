// The Claude API's behaviour (docs/contributing/architecture.md, "Behaviour"): anthropic is a generative pack, and a
// Messages turn is a scripted scenario's when the World loads one (the MSW-shaped handlers of the world dir's
// handlers/anthropic.json), else the labeled deterministic stub, never a model. The kernel loads the scenario, decides
// the turn of each operation named here, answers a fault it scripts at once (before anything is written) in Anthropic's
// error envelope, and hands the decision to the handler as `ctx.scenario`. What is Anthropic's: the request a turn is
// (its model, system, messages and tools), the `on` keys a handler matches on and the `respond` it may script.
import type { PackScenario, PackScenarioAdapter, ScenarioFeatures } from '@volter/world-core';
import { lastUserText, messageShapeError, RESPOND_KEYS, type Row, STOP_REASONS, textOf, toolResultNames } from './shared.ts';

type Request = { model: string; system: string; messages: Row[]; tools: string[]; toolsForbidden?: boolean; choice: Row };

const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const lastText = (r: Request): string => textOf(r.messages[r.messages.length - 1]?.content);

// the fault's type, by its status, as the API's errors page names them
// source: https://platform.claude.com/docs/en/api/errors "529 - overloaded_error: The API is temporarily overloaded."
const FAULT_TYPES: Record<number, string> = { 400: 'invalid_request_error', 401: 'authentication_error', 403: 'permission_error', 404: 'not_found_error', 413: 'request_too_large', 429: 'rate_limit_error', 500: 'api_error', 504: 'timeout_error', 529: 'overloaded_error' };

const adapter: PackScenarioAdapter<Request> = {
  // a turn that uses a tool is no answer to a request that forbids tools: the next handler that matches answers, else the stub
  // source: https://platform.claude.com/docs/en/api/messages "The model will not be allowed to use tools."
  admits: (r, respond) => {
    const raw = (respond as Row | undefined)?.toolUses;
    const client = raw === undefined ? [] : Array.isArray(raw) ? raw as Row[] : [raw as Row];
    const tools = [...client, ...((respond as Row | undefined)?.serverTools as Row[] | undefined ?? [])];
    if (r.toolsForbidden && tools.length) return false;
    if (tools.some(tool => !r.tools.includes(String(tool.name)))) return false;
    if (r.choice.disable_parallel_tool_use === true && tools.length > 1) return false;
    if (r.choice.type === 'any' && !tools.length) return false;
    return r.choice.type !== 'tool' || (tools.length > 0 && tools.every(tool => tool.name === r.choice.name));
  },
  vendor: 'anthropic',
  renderFault: (f) => ({ body: { type: 'error', error: { type: FAULT_TYPES[f.status] ?? (f.status >= 500 ? 'api_error' : 'invalid_request_error'), message: f.message ?? (f.status === 529 ? 'Overloaded' : f.status === 429 ? 'Number of request tokens has exceeded your per-minute rate limit' : 'The request was refused by a scripted fault.') } } }),
  features: (r): ScenarioFeatures => ({ model: r.model, lastUserText: lastUserText(r.messages).slice(0, 300), tools: r.tools, lastMessageIsToolResult: toolResultNames(r.messages).length > 0, toolResultFor: toolResultNames(r.messages) }),
  matchers: {
    modelEquals: (r, c) => nonEmpty(c) && r.model === c,
    userTextIncludes: (r, c) => nonEmpty(c) && lastUserText(r.messages).toLowerCase().includes(c.toLowerCase()),
    anyTextIncludes: (r, c) => nonEmpty(c) && [r.system, ...r.messages.map((m) => textOf(m.content))].join('\n').toLowerCase().includes(c.toLowerCase()),
    lastMessageTextIncludes: (r, c) => nonEmpty(c) && lastText(r).toLowerCase().includes(c.toLowerCase()),
    lastMessageIsToolResult: (r, c) => typeof c === 'boolean' && (toolResultNames(r.messages).length > 0) === c,
    toolResultFor: (r, c) => nonEmpty(c) && toolResultNames(r.messages).includes(c),
    hasTool: (r, c) => nonEmpty(c) && r.tools.includes(c),
  },
  text: (r) => [r.system, ...r.messages.map((m) => textOf(m.content))].join('\n'),
  validateOn: (on) => {
    for (const k of ['modelEquals', 'userTextIncludes', 'anyTextIncludes', 'lastMessageTextIncludes', 'toolResultFor', 'hasTool'] as const) if (on[k] !== undefined && !nonEmpty(on[k])) return `on.${k} is a non-empty string`;
    if (on.lastMessageIsToolResult !== undefined && typeof on.lastMessageIsToolResult !== 'boolean') return 'on.lastMessageIsToolResult is a boolean';
    return null;
  },
  validateRespond: (respond) => {
    if (typeof respond !== 'object' || respond === null || Array.isArray(respond)) return 'respond is an object { text?, toolUses?, thinking?, stopReason? }';
    const r = respond as Row;
    for (const k of Object.keys(r)) if (!RESPOND_KEYS.has(k)) return `respond: unknown key "${k}" (valid: ${[...RESPOND_KEYS].join(', ')})`;
    if (r.text !== undefined && typeof r.text !== 'string') return 'respond.text is a string';
    if (r.thinking !== undefined && typeof r.thinking !== 'string') return 'respond.thinking is a string';
    if (r.stopReason !== undefined && (typeof r.stopReason !== 'string' || !STOP_REASONS.has(r.stopReason))) return `respond.stopReason is one of ${[...STOP_REASONS].join(', ')}`;
    for (const t of r.toolUses === undefined ? [] : Array.isArray(r.toolUses) ? r.toolUses : [r.toolUses]) {
      const u = t as Row;
      if (!u || typeof u !== 'object' || Array.isArray(u) || !nonEmpty(u.name)) return 'respond.toolUses[].name is a non-empty string';
      if (!u.input || typeof u.input !== 'object' || Array.isArray(u.input)) return 'respond.toolUses[].input is an object';
    }
    if (r.serverTools !== undefined && (!Array.isArray(r.serverTools) || r.serverTools.some((tool: Row) => !tool || tool.name !== 'web_search' || !tool.input || typeof tool.input !== 'object' || Array.isArray(tool.input) || !Array.isArray(tool.results)))) return 'respond.serverTools is web_search calls with input and result blocks';
    if (r.text === undefined && r.toolUses === undefined && r.serverTools === undefined) return 'respond needs text or toolUses';
    return null;
  },
};

export const scenario: PackScenario<Request> = {
  adapter,
  operations: ['messages_post', 'beta_messages_post'],
  request: (ctx) => {
    const b = (ctx.body ?? {}) as Row;
    if (messageShapeError(b) || b.max_tokens === 0) return undefined;
    const system = typeof b.system === 'string' ? b.system : textOf(b.system);
    const forbidden = ((b.tool_choice ?? {}) as Row).type === 'none';
    return { model: String(b.model ?? ''), system, messages: Array.isArray(b.messages) ? (b.messages as Row[]) : [], tools: ((b.tools as Row[] | undefined) ?? []).map((t) => String(t.name)), choice: (b.tool_choice ?? {}) as Row, ...(forbidden ? { toolsForbidden: true } : {}) };
  },
};
