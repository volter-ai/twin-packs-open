// What every family of OpenRouter's API shares: its API keys (made on Settings > Keys, or by a person's approval on its
// /auth page), the people who sign in at openrouter.ai, its error bodies, its models' form and the catalogue of the
// models our applications name. A turn's shapes and its labeled stub are the kernel's wires (openaiWire, anthropicWire).
import { anthropicWire, openaiWire, type HandlerContext } from '@volter/world-core';

export type Row = Record<string, unknown>;
export const KEY = '_api_key';
export const PERSON = 'user';
export const CODE = '_auth_code';
/** The twin's label in a stub's text. */
export const LABEL = 'OpenRouter twin';
export const SSE = { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' };

export const obj = (v: unknown): Row => (v && typeof v === 'object' && !Array.isArray(v) ? v as Row : {});
export const arr = (v: unknown): Row[] => (Array.isArray(v) ? v as Row[] : []);
export const sha256 = (ctx: Pick<HandlerContext, 'crypto'>, v: string): string => ctx.crypto.digest('sha256', v, 'hex');
/** A short id drawn from a generation's issued value: each call's are others. */
export const idOf = (ctx: Pick<HandlerContext, 'crypto'>, generation: string, what: string, length = 24): string => sha256(ctx, `${generation}:${what}`).slice(0, length);
/** The World's clock in seconds. */
export const unixNow = (ctx: Pick<HandlerContext, 'occurredAt'>): number => Math.floor(Date.parse(ctx.occurredAt) / 1000);

// ── errors ─────────────────────────────────────────────────────────────────────────────────────
// source: https://openrouter.ai/docs/api_reference/errors-and-debugging "The HTTP Response will have the same status code as error.code"

/** OpenRouter's error body: `{error: {code, message, metadata?}}`. */
export const orError = (code: number, message: string, metadata?: Row): Response =>
  Response.json({ error: { code, message, ...(metadata ? { metadata } : {}) } }, { status: code });

/** The Anthropic Messages surface's error body: `{type: error, error: {type, message}, request_id}`. */
// source: spec:/components/schemas/AnthropicMessagesErrorResponse/description "Error response from the Anthropic Messages API"
export const messagesError = (status: number, type: string, message: string): Response =>
  Response.json({ type: 'error', error: { type, message, error_type: ({ authentication_error: 'authentication', invalid_request_error: 'invalid_request', not_found_error: 'not_found' } as Record<string, string>)[type] ?? 'server' }, request_id: null }, { status });

// ── keys ───────────────────────────────────────────────────────────────────────────────────────
// A key is `sk-or-v1-` and 64 hexadecimal digits; the World keeps it by its SHA-256 (the row's id is minted) and draws it
// from a secret it holds.

const keyValue = async (ctx: Pick<HandlerContext, 'secret' | 'crypto'>, label: string): Promise<string> =>
  `sk-or-v1-${ctx.crypto.digest('sha256', await ctx.secret(label), 'hex')}`;

/** A key of a person's (Settings > Keys, or the /auth page's approval for an application). Its `masked` form is the
 *  label OpenRouter shows for it: the prefix and three digits, then its last three. */
// source: spec:getCurrentKey "sk-or-v1-au7...890"
export async function makeKey(ctx: HandlerContext, user: string, name: string): Promise<string> {
  const id = await ctx.issue(KEY);
  const label = `openrouter-key:${id}`;
  const key = await keyValue(ctx, label);
  await ctx.record(KEY, { user, name, label, masked: `${key.slice(0, 12)}...${key.slice(-3)}`, created_at: ctx.occurredAt, disabled: false, limit: null, usage: 0, sha256: sha256(ctx, key) }, id);
  return id;
}

/** Read a user's native key only while its stored status and hash permit use. */
export async function readKey(ctx: HandlerContext, row: Row): Promise<string | undefined> {
  if (row.deleted === true || row.disabled === true) return undefined;
  const key = await keyValue(ctx, String(row.label));
  return sha256(ctx, key) === row.sha256 ? key : undefined;
}

/** The key a request's `Authorization: Bearer` names, if the World issued it and it is not disabled. */
export function keyOf(ctx: HandlerContext): Row | undefined {
  const raw = ctx.call.request.headers.get('authorization') ?? '';
  const bearer = /^Bearer\s+(\S+)$/i.exec(raw)?.[1];
  if (!bearer) return undefined;
  const hash = sha256(ctx, bearer);
  return ctx.rowsRaw(KEY).find((k) => k.deleted !== true && k.disabled !== true && k.sha256 === hash);
}

/** A person who signs in at openrouter.ai, by email. */
export const personByEmail = (ctx: Pick<HandlerContext, 'rowsRaw'>, email: string): Row | undefined =>
  ctx.rowsRaw(PERSON).find((p) => p.deleted !== true && String(p.email).toLowerCase() === email.toLowerCase());

// ── models ─────────────────────────────────────────────────────────────────────────────────────

/** The documented catalogue on the World clock; an uncatalogued model is unknown. */
// source: https://openrouter.ai/docs/api_reference/overview "select a value for model from the supported models"
export const validModel = (model: unknown, at: string): boolean =>
  typeof model === 'string' && MODELS.some((m) => m.id === model && Date.parse(at) >= Date.parse(m.released));

/** The provider a model is served by, as the answer names it: its author, as OpenRouter capitalizes the big ones. */
export function providerOf(model: string): string {
  const author = model.split('/')[0] ?? '';
  const known: Record<string, string> = { openai: 'OpenAI', anthropic: 'Anthropic', google: 'Google', 'meta-llama': 'Meta', mistralai: 'Mistral', 'x-ai': 'xAI', 'z-ai': 'Z.ai', deepseek: 'DeepSeek', qwen: 'Alibaba', openrouter: 'OpenRouter' };
  return known[author] ?? author.charAt(0).toUpperCase() + author.slice(1);
}

/** A model of the twin's catalogue: what its page on openrouter.ai states. Prices in USD per million tokens. */
export type Model = { id: string; name: string; released: string; input: number; output: number; context: number; maxOutput: number; inputs: string[]; tokenizer: string };

// The catalogue: the models our applications name (journeys/demand.json) that openrouter.ai serves today, each as its
// page states it. Llama 3 70B Instruct, LibreChat's example default, is left out: its page lists no provider or price.
export const MODELS: Model[] = [
  // source: https://openrouter.ai/openai/gpt-4o "GPT-4o costs $2.50/M input tokens and $10.00/M output tokens."
  // source: https://openrouter.ai/openai/gpt-4o "GPT-4o has a 128,000 token context window. It supports up to 16,384 completion tokens."
  // source: https://openrouter.ai/openai/gpt-4o "supporting both text and image inputs with text outputs"
  // source: https://openrouter.ai/openai/gpt-4o "Released May 13, 2024"
  { id: 'openai/gpt-4o', name: 'OpenAI: GPT-4o', released: '2024-05-13', input: 2.5, output: 10, context: 128_000, maxOutput: 16_384, inputs: ['text', 'image'], tokenizer: 'GPT' },
  // source: https://openrouter.ai/z-ai/glm-5.2 "GLM 5.2 costs $0.176/M input tokens and $4.00/M output tokens"
  // source: https://openrouter.ai/z-ai/glm-5.2 "GLM 5.2 has a 1,048,576 token context window. It supports up to 131,072 completion tokens."
  // source: https://openrouter.ai/z-ai/glm-5.2 "It supports text input and output"
  // source: https://openrouter.ai/z-ai/glm-5.2 "Released Jun 16, 2026"
  { id: 'z-ai/glm-5.2', name: 'Z.ai: GLM 5.2', released: '2026-06-16', input: 0.176, output: 4, context: 1_048_576, maxOutput: 131_072, inputs: ['text'], tokenizer: 'Other' },
  // source: https://openrouter.ai/anthropic/claude-opus-4.8 "Claude Opus 4.8 costs $5.00/M input tokens and $25.00/M output tokens"
  // source: https://openrouter.ai/anthropic/claude-opus-4.8 "Claude Opus 4.8 has a 1,000,000 token context window. It supports up to 128,000 completion tokens."
  // source: https://openrouter.ai/anthropic/claude-opus-4.8 "It supports text, image, and file inputs with text output"
  // source: https://openrouter.ai/anthropic/claude-opus-4.8 "Released May 27, 2026"
  { id: 'anthropic/claude-opus-4.8', name: 'Anthropic: Claude Opus 4.8', released: '2026-05-27', input: 5, output: 25, context: 1_000_000, maxOutput: 128_000, inputs: ['text', 'image', 'file'], tokenizer: 'Claude' },
  // source: https://openrouter.ai/openai/gpt-4 "GPT-4 was released on May 28, 2023."
  // source: https://openrouter.ai/openai/gpt-4 "GPT-4 costs $30.00/M input tokens and $60.00/M output tokens"
  // source: https://openrouter.ai/openai/gpt-4 "GPT-4 has a 8,191 token context window. It supports up to 4,096 completion tokens."
  {"id": "openai/gpt-4", "name": "OpenAI: GPT-4", "released": "2023-05-28", "input": 30, "output": 60, "context": 8191, "maxOutput": 4096, "inputs": ["text"], "tokenizer": "GPT"},
  // source: https://openrouter.ai/anthropic/claude-sonnet-4 "Claude Sonnet 4 was released on May 22, 2025."
  // source: https://openrouter.ai/anthropic/claude-sonnet-4 "Claude Sonnet 4 costs $3.00/M input tokens and $15.00/M output tokens"
  // source: https://openrouter.ai/anthropic/claude-sonnet-4 "Claude Sonnet 4 has a 200,000 token context window. It supports up to 64,000 completion tokens."
  {"id": "anthropic/claude-sonnet-4", "name": "Anthropic: Claude Sonnet 4", "released": "2025-05-22", "input": 3, "output": 15, "context": 200000, "maxOutput": 64000, "inputs": ["text", "image", "file"], "tokenizer": "Claude"},
  // source: https://openrouter.ai/openai/gpt-5.2 "GPT-5.2 was released on December 10, 2025."
  // source: https://openrouter.ai/openai/gpt-5.2 "GPT-5.2 costs $1.75/M input tokens and $14.00/M output tokens"
  // source: https://openrouter.ai/openai/gpt-5.2 "GPT-5.2 has a 400,000 token context window. It supports up to 128,000 completion tokens."
  {"id": "openai/gpt-5.2", "name": "OpenAI: GPT-5.2", "released": "2025-12-10", "input": 1.75, "output": 14, "context": 400000, "maxOutput": 128000, "inputs": ["text", "image"], "tokenizer": "GPT"},
  // source: https://openrouter.ai/openai/o4-mini "o4 Mini was released on April 16, 2025."
  // source: https://openrouter.ai/openai/o4-mini "o4 Mini costs $1.10/M input tokens and $4.40/M output tokens"
  // source: https://openrouter.ai/openai/o4-mini "o4 Mini has a 200,000 token context window. It supports up to 100,000 completion tokens."
  {"id": "openai/o4-mini", "name": "OpenAI: o4 Mini", "released": "2025-04-16", "input": 1.1, "output": 4.4, "context": 200000, "maxOutput": 100000, "inputs": ["text", "image"], "tokenizer": "GPT"},

];

/** A price per token as OpenRouter writes it: a decimal string. */
const perToken = (perMillion: number): string => (perMillion / 1_000_000).toFixed(12).replace(/0+$/, '').replace(/\.$/, '');

/** A catalogue model as GET /models lists it. */
// source: spec:/components/schemas/Model/description "Information about an AI model available on OpenRouter"
// source: spec:/components/schemas/ModelGroup/description "Tokenizer type used by the model"
export function publicModel(m: Model): Row {
  return {
    id: m.id, canonical_slug: m.id, hugging_face_id: null, name: m.name, created: Math.floor(Date.parse(`${m.released}T00:00:00Z`) / 1000),
    // Where the documentation stops: the pages carry no description, knowledge cutoff or expiry the catalogue needs
    description: m.name, knowledge_cutoff: null, expiration_date: null, context_length: m.context,
    architecture: { modality: `${m.inputs.join('+')}->text`, input_modalities: m.inputs, output_modalities: ['text'], tokenizer: m.tokenizer, instruct_type: null },
    pricing: { prompt: perToken(m.input), completion: perToken(m.output), image: '0', request: '0' },
    // Where the documentation stops: the pages do not say whether the top provider moderates content; the twin says not
    top_provider: { context_length: m.context, max_completion_tokens: m.maxOutput, is_moderated: false },
    per_request_limits: null,
    // source: https://openrouter.ai/openai/gpt-4o "GPT-4o accepts tools and tool_choice for function calling"
    supported_parameters: ['max_tokens', 'temperature', 'top_p', 'tools', 'tool_choice', 'response_format', 'structured_outputs'],
    default_parameters: null, supported_voices: null,
    links: { details: `/api/v1/models/${m.id}/endpoints` },
  };
}

/** The World's next number (a nonce in a secret's label, a numeric id), issued from the tree over `_serial` (ctx.issue),
 *  never a row count. */
export const serial = async (ctx: Pick<HandlerContext, 'issue'>): Promise<number> => Number(await ctx.issue('_serial'));

/** A scenario's post-admission provider failure: no model runs and no resource mutation is faked. */
// source: https://openrouter.ai/docs/api_reference/errors-and-debugging "Skin-specific error formats"
export function generationFailure(ctx: HandlerContext, generation: string, skin: 'chat' | 'responses' | 'messages', body: Row): Response | undefined {
  const fault = ctx.scenario?.kind === 'handler' ? ctx.scenario.fault : undefined;
  if (fault?.kind !== 'generation') return undefined;
  const id = `gen-${unixNow(ctx)}-${generation}`;
  const metadata = { ...fault.metadata, error_type: fault.errorType };
  const gatewayError = { code: fault.status, message: fault.message, metadata };
  let answer: Row | string;
  if (skin === 'chat') answer = openaiWire.chatCompletionFailure({ id, model: String(body.model), created: unixNow(ctx), error: gatewayError, text: fault.partialText, extra: { provider: providerOf(String(body.model)) } }, body.stream === true);
  else if (skin === 'responses') {
    // source: https://openrouter.ai/docs/api_reference/errors-and-debugging "the precise reason is preserved in a top-level error_type field on the response"
    const code = fault.event === 'error' ? 'invalid_api_key' : fault.errorType === 'rate_limit_exceeded' ? 'rate_limit_exceeded' : ['context_length_exceeded', 'invalid_request', 'refusal'].includes(fault.errorType) ? 'invalid_prompt' : fault.errorType === 'content_policy_violation' ? 'image_content_policy_violation' : 'server_error';
    answer = openaiWire.responsesFailure({ id: `resp_${generation}`, status: 'failed', error: { code, message: fault.message }, error_type: fault.errorType }, body.stream === true, fault.event);
  } else {
    // source: https://openrouter.ai/docs/api_reference/errors-and-debugging "The Anthropic Messages skin maps internal types to Anthropic-native error type strings"
    const native = ({ authentication: 'authentication_error', permission_denied: 'permission_error', payment_required: 'billing_error', not_found: 'not_found_error', image_not_found: 'not_found_error', rate_limit_exceeded: 'rate_limit_error', provider_overloaded: 'overloaded_error', timeout: 'timeout_error', context_length_exceeded: 'invalid_request_error', content_policy_violation: 'invalid_request_error', refusal: 'invalid_request_error', invalid_request: 'invalid_request_error' } as Record<string, string>)[fault.errorType] ?? 'api_error';
    answer = anthropicWire.messageFailure({ type: native, message: fault.message, error_type: fault.errorType }, body.stream === true, id);
  }
  return typeof answer === 'string' ? new Response(answer, { headers: { ...SSE, 'X-Generation-Id': id } }) : Response.json(answer, { headers: { 'X-Generation-Id': id } });
}
