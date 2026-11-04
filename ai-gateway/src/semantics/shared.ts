// What every family of Vercel's AI Gateway shares: its API keys (made on the AI Gateway's API Keys page), its error body,
// and its models (Vercel's catalogue, recorded). A turn's shapes and its labeled stub are the kernel's wire (openaiWire):
// OpenAI's chat completions for the OpenAI-compatible API, the AI SDK's language-model protocol for @ai-sdk/gateway.
// THE TWIN RUNS NO MODEL.
import { openaiWire, type HandlerContext } from '@volter/world-core';
import { catalogue } from '../engine/catalogue.ts';

export type Row = Record<string, unknown>;
export const KEY = '_api_key';
const sha256 = (ctx: Pick<HandlerContext, 'crypto'>, v: string): string => ctx.crypto.digest('sha256', v, 'hex');

// ── keys ───────────────────────────────────────────────────────────────────────────────────────
// Where the documentation stops: a key is `vck_` and 56 letters and digits, the form the API Keys page shows; the World
// keeps it by its SHA-256 and draws it from a secret it holds.

const keyValue = async (ctx: Pick<HandlerContext, 'secret'>, label: string): Promise<string> =>
  `vck_${`${await ctx.secret(label)}${await ctx.secret(`${label}:2`)}${await ctx.secret(`${label}:3`)}`.replace(/[^A-Za-z0-9]/g, '').slice(0, 56)}`;
export async function makeKey(ctx: HandlerContext, name: string, team: Row): Promise<string> {
  const id = await ctx.issue(KEY);
  const label = `ai-gateway-api-key:${id}`;
  const key = await keyValue(ctx, label);
  await ctx.record(KEY, { name, _team: team.id, _owner: team.owner, label, created: ctx.occurredAt, sha256: sha256(ctx, key) }, id);
  return id;
}
export async function readKey(ctx: HandlerContext, row: Row): Promise<string | undefined> {
  if (row.deleted === true) return undefined;
  const key = await keyValue(ctx, String(row.label));
  return sha256(ctx, key) === row.sha256 ? key : undefined;
}
// source: https://vercel.com/docs/ai-gateway/sdks-and-apis/openai-chat-completions "Use your AI Gateway API key with the"

// ── errors ─────────────────────────────────────────────────────────────────────────────────────
// source: https://vercel.com/docs/ai-gateway/sdks-and-apis/openai-chat-completions "The API returns standard HTTP status codes and error responses:"

/** The error body, `{error: {message, type, param, code}}`. The types are those @ai-sdk/gateway tells apart
 *  (authentication_error, invalid_request_error, model_not_found with `param: {modelId}`, rate_limit_exceeded, …). */
export const gatewayError = (status: number, type: string, message: string, param: unknown = null, code: string | null = null): Response =>
  Response.json({ error: { message, type, param, code } }, { status });

// ── models ─────────────────────────────────────────────────────────────────────────────────────
// Vercel's catalogue as GET /v1/models answered it on 2026-09-30 (spec/recordings/2026-09-30-models.json.gz), retained with every field the list answered.

export const MODELS = catalogue as Row[];
export const modelOf = (id: string): Row | undefined => MODELS.find((m) => m.id === id);
// source: https://vercel.com/docs/ai-gateway/sdks-and-apis/openai-chat-completions "Model or endpoint not found"
/** A language model the catalogue holds, or the gateway's model_not_found. */
export function languageModel(id: string): Response | undefined {
  const m = modelOf(id);
  return m && m.type === 'language' ? undefined : gatewayError(404, 'model_not_found', `Model '${id}' not found`, { modelId: id }, 'model_not_found');
}

export const obj = (v: unknown): Row => (v && typeof v === 'object' && !Array.isArray(v) ? v as Row : {});
export const arr = (v: unknown): Row[] => (Array.isArray(v) ? v as Row[] : []);

const LABEL = 'Vercel AI Gateway twin';
export async function shapeOf(ctx: HandlerContext, body: Row, model: string): Promise<openaiWire.ChatShape> {
  // source: https://vercel.com/docs/ai-gateway/sdks-and-apis/openai-chat-completions/structured-outputs "The following format is supported for backward compatibility."
  const format = obj(body.response_format);
  const normalized = format.type === 'json' ? { ...body, response_format: format.schema ? { type: 'json_schema', json_schema: { schema: format.schema } } : { type: 'json_object' } } : body;
  const scripted = openaiWire.scenarioTurn(ctx.scenario) ?? openaiWire.chatStubTurn(normalized, LABEL);
  // source: https://vercel.com/docs/ai-gateway/sdks-and-apis/openai-chat-completions/reasoning "When true, omit reasoning content from the response."
  const turn = obj(body.reasoning).exclude === true ? { ...scripted, reasoning: undefined, reasoningDetails: undefined } : scripted;
  // the generation's id, issued: each call's is another (ctx.issue)
  const completion = await ctx.issue('_generation');
  const id = `gen_${ctx.crypto.uuidFrom(`ai-gateway:${ctx.occurredAt}:${completion}`).replace(/-/g, '').slice(0, 26).toUpperCase()}`;
  return {
    id, model, created: Math.floor(Date.parse(ctx.occurredAt) / 1000), turn, messages: arr(body.messages), callId: (i) => `call_${ctx.crypto.digest('sha256', `${completion}:call:${i}`, 'hex').slice(0, 24)}`,
    maxTokens: typeof body.max_completion_tokens === 'number' ? body.max_completion_tokens : typeof body.max_tokens === 'number' ? body.max_tokens : undefined,
  };
}


// source: https://vercel.com/docs/ai-gateway/sdks-and-apis/openai-chat-completions/reasoning "Can't be combined with effort."
// source: https://vercel.com/docs/ai-gateway/sdks-and-apis/openai-chat-completions/advanced "If both are provided for the same option, they must resolve to the same value or the request will fail."
// Object key order is not part of the value of a routing option; array order is.
const optionValue = (value: unknown): unknown => Array.isArray(value) ? value.map(optionValue) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, optionValue((value as Row)[key])])) : value;

export function optionsRefusal(body: Row): Response | undefined {
  // source: https://vercel.com/docs/ai-gateway/sdks-and-apis/openai-chat-completions/chat-completions "Controls randomness in the output. Range: 0-2"
  // source: https://vercel.com/docs/ai-gateway/sdks-and-apis/openai-chat-completions/chat-completions "Nucleus sampling parameter. Range: 0-1"
  // source: https://vercel.com/docs/ai-gateway/sdks-and-apis/openai-chat-completions/chat-completions "Penalty for frequent tokens. Range: -2 to 2"
  // source: https://vercel.com/docs/ai-gateway/sdks-and-apis/openai-chat-completions/chat-completions "Penalty for present tokens. Range: -2 to 2"
  for (const [key, min, max] of [['temperature', 0, 2], ['top_p', 0, 1], ['frequency_penalty', -2, 2], ['presence_penalty', -2, 2]] as const) if (body[key] !== undefined && (typeof body[key] !== 'number' || !Number.isFinite(body[key]) || body[key] < min || body[key] > max)) return gatewayError(400, 'invalid_request_error', key + ' must be between ' + min + ' and ' + max, key, 'invalid_parameter');
  // source: https://vercel.com/docs/ai-gateway/sdks-and-apis/openai-chat-completions/structured-outputs "Object containing schema definition"
  const format = obj(body.response_format);
  // Exact schema-validation wording is not specified; use the documented invalid-request class.
  if (format.type === 'json_schema' && (typeof obj(format.json_schema).name !== 'string' || !obj(format.json_schema).schema || typeof obj(format.json_schema).schema !== 'object' || Array.isArray(obj(format.json_schema).schema))) return gatewayError(400, 'invalid_request_error', 'json_schema requires name and schema', 'response_format', 'missing_parameter');
  const reasoning = obj(body.reasoning);
  // source: https://vercel.com/docs/ai-gateway/sdks-and-apis/openai-chat-completions/reasoning "The request schema accepts"
  if (reasoning.effort !== undefined && (typeof reasoning.effort !== "string" || !["none", "minimal", "low", "medium", "high", "xhigh", "max"].includes(reasoning.effort))) return gatewayError(400, "invalid_request_error", "Unsupported reasoning effort", "reasoning.effort", "invalid_parameter");
  // The reference documents the conflict, but not its precise message; use its invalid-request class.
  if (reasoning.effort !== undefined && reasoning.max_tokens !== undefined) return gatewayError(400, 'invalid_request_error', 'reasoning.effort and reasoning.max_tokens cannot be combined', 'reasoning', 'invalid_parameter');
  const shorthand = obj(body.provider);
  const gateway = obj(obj(body.providerOptions).gateway);
  for (const key of Object.keys(shorthand)) if (gateway[key] !== undefined && JSON.stringify(optionValue(shorthand[key])) !== JSON.stringify(optionValue(gateway[key]))) return gatewayError(400, 'invalid_request_error', 'provider and providerOptions.gateway must agree on ' + key, key, 'invalid_parameter');
  return undefined;
}
