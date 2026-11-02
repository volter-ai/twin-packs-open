// The Gemini API's behaviour (docs/contributing/architecture.md, "Behaviour"): gemini is a generative pack, and a turn is
// a scripted scenario's when the World loads one (the handlers of the world dir's handlers/gemini.json), else the labeled
// deterministic stub, never a model. The kernel loads the scenario, decides the turn of each operation named here,
// answers a fault it scripts at once in Google's error envelope, and hands the decision to the handler as
// `ctx.scenario`. What is Gemini's: the request a turn is (its model, system instruction, contents and functions), the
// `on` keys a handler matches on and the `respond` it may script.
import type { PackScenario, PackScenarioAdapter, ScenarioFeatures } from '@volter/world-core';
import { arr, obj, functionResults, lastUserText, modelName, partsText, toolsOf, type Row } from './shared.ts';

type Request = { model: string; system: string; contents: Row[]; functions: string[]; generation: Row; calling: Row; tools: string[] };

const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const RESPOND_KEYS = new Set(['text', 'functionCalls', 'thinking', 'finishReason', 'parts', 'groundingMetadata', 'safetyRatings', 'promptFeedback']);
// source: https://ai.google.dev/api/generate-content "STOP"
const FINISH = new Set(["FINISH_REASON_UNSPECIFIED", "STOP", "MAX_TOKENS", "SAFETY", "RECITATION", "LANGUAGE", "OTHER", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII", "MALFORMED_FUNCTION_CALL", "IMAGE_SAFETY", "IMAGE_PROHIBITED_CONTENT", "IMAGE_OTHER", "NO_IMAGE", "IMAGE_RECITATION", "UNEXPECTED_TOOL_CALL", "TOO_MANY_TOOL_CALLS", "MISSING_THOUGHT_SIGNATURE", "MALFORMED_RESPONSE", "ESCALATION", "PUP_LIMITED_DISABLED"]);
// Google's canonical codes by HTTP status (google.rpc.Code)
const STATUS: Record<number, string> = { 400: 'INVALID_ARGUMENT', 401: 'UNAUTHENTICATED', 403: 'PERMISSION_DENIED', 404: 'NOT_FOUND', 429: 'RESOURCE_EXHAUSTED', 500: 'INTERNAL', 503: 'UNAVAILABLE', 504: 'DEADLINE_EXCEEDED' };

const adapter: PackScenarioAdapter<Request> = {
  vendor: 'gemini',
  renderFault: (f) => ({ body: { error: { code: f.status, message: f.message ?? (f.status === 429 ? 'Resource has been exhausted (e.g. check quota).' : f.status === 503 ? 'The model is overloaded. Please try again later.' : 'The request was refused by a scripted fault.'), status: STATUS[f.status] ?? (f.status >= 500 ? 'INTERNAL' : 'INVALID_ARGUMENT') } } }),
  features: (r): ScenarioFeatures => ({ model: r.model, lastUserText: lastUserText(r.contents).slice(0, 300), tools: r.tools, lastMessageIsToolResult: functionResults(r.contents).length > 0, toolResultFor: functionResults(r.contents) }),
  matchers: {
    modelEquals: (r, c) => nonEmpty(c) && r.model === c,
    userTextIncludes: (r, c) => nonEmpty(c) && lastUserText(r.contents).toLowerCase().includes(c.toLowerCase()),
    anyTextIncludes: (r, c) => nonEmpty(c) && [r.system, ...r.contents.map((x) => partsText(x.parts))].join('\n').toLowerCase().includes(c.toLowerCase()),
    lastMessageIsToolResult: (r, c) => typeof c === 'boolean' && (functionResults(r.contents).length > 0) === c,
    toolResultFor: (r, c) => nonEmpty(c) && functionResults(r.contents).includes(c),
    hasTool: (r, c) => nonEmpty(c) && r.tools.includes(c),
    generationConfigEquals: (r, c) => !!c && typeof c === 'object' && !Array.isArray(c) && Object.entries(c).every(([key, value]) => JSON.stringify(r.generation[key]) === JSON.stringify(value)),
  },
  // source: spec:/components/schemas/FunctionCallingConfig/properties/mode "NONE"
  // A script predicts only calls the request admits, otherwise another script or the stub answers.
  admits: (r, respond) => {
    const calls = arr(obj(respond).functionCalls);
    const mode = String(r.calling.mode ?? 'AUTO').toUpperCase();
    const allowed = r.calling.allowedFunctionNames ?? r.calling.allowed_function_names;
    return !(mode === 'NONE' && calls.length) && !(mode === 'ANY' && !calls.length) &&
      calls.every((call) => r.functions.includes(String(call.name)) && (!Array.isArray(allowed) || allowed.includes(call.name)));
  },
  text: (r) => [r.system, ...r.contents.map((x) => partsText(x.parts))].join('\n'),
  validateOn: (on) => {
    for (const k of ['modelEquals', 'userTextIncludes', 'anyTextIncludes', 'toolResultFor', 'hasTool'] as const) if (on[k] !== undefined && !nonEmpty(on[k])) return `on.${k} is a non-empty string`;
    if (on.lastMessageIsToolResult !== undefined && typeof on.lastMessageIsToolResult !== 'boolean') return 'on.lastMessageIsToolResult is a boolean';
    if (on.generationConfigEquals !== undefined && (!on.generationConfigEquals || typeof on.generationConfigEquals !== 'object' || Array.isArray(on.generationConfigEquals))) return 'on.generationConfigEquals is an object';
    return null;
  },
  validateRespond: (respond) => {
    if (typeof respond !== 'object' || respond === null || Array.isArray(respond)) return 'respond is an object { text?, functionCalls?, thinking?, finishReason? }';
    const r = respond as Row;
    for (const k of Object.keys(r)) if (!RESPOND_KEYS.has(k)) return `respond: unknown key "${k}" (valid: ${[...RESPOND_KEYS].join(', ')})`;
    if (r.text !== undefined && typeof r.text !== 'string') return 'respond.text is a string';
    if (r.thinking !== undefined && typeof r.thinking !== 'string') return 'respond.thinking is a string';
    if (r.finishReason !== undefined && (typeof r.finishReason !== 'string' || !FINISH.has(r.finishReason))) return `respond.finishReason is one of ${[...FINISH].join(', ')}`;
    if (r.functionCalls !== undefined && !Array.isArray(r.functionCalls)) return 'respond.functionCalls is an array';
    for (const c of r.functionCalls === undefined ? [] : Array.isArray(r.functionCalls) ? r.functionCalls : [r.functionCalls]) {
      const u = c as Row;
      if (!u || typeof u !== 'object' || Array.isArray(u) || !nonEmpty(u.name)) return 'respond.functionCalls[].name is a non-empty string';
      if (u.args !== undefined && (!u.args || typeof u.args !== 'object' || Array.isArray(u.args))) return 'respond.functionCalls[].args is an object';
    }
    for (const key of ['parts', 'safetyRatings'] as const) if (r[key] !== undefined && (!Array.isArray(r[key]) || r[key].some((value) => !value || typeof value !== 'object' || Array.isArray(value)))) return 'respond.' + key + ' is an array of objects';
    for (const key of ['groundingMetadata', 'promptFeedback'] as const) if (r[key] !== undefined && (!r[key] || typeof r[key] !== 'object' || Array.isArray(r[key]))) return 'respond.' + key + ' is an object';
    if (r.text === undefined && r.functionCalls === undefined && r.parts === undefined && r.promptFeedback === undefined) return 'respond needs text, functionCalls, parts or promptFeedback';
    return null;
  },
};

export const scenario: PackScenario<Request> = {
  adapter,
  operations: ['generativelanguage.models.generateContent', 'generativelanguage.models.streamGenerateContent'],
  request: (ctx) => {
    const b = (ctx.body ?? {}) as Row;
    const system = partsText(((b.systemInstruction ?? b.system_instruction) as Row | undefined)?.parts);
    const offered = toolsOf(b);
    const functions = offered.functions.map((f) => String(f.name));
    return { model: modelName(ctx.call.params.modelsId), system, contents: arr(b.contents), functions, tools: [...functions, ...(offered.googleSearch ? ['googleSearch'] : [])], generation: obj(b.generationConfig ?? b.generation_config), calling: obj(obj(b.toolConfig ?? b.tool_config).functionCallingConfig ?? obj(b.toolConfig ?? b.tool_config).function_calling_config) };
  },
};
