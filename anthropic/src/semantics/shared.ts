// What the Claude API's front, handlers, doors and pages share: its error envelope and request ids, the key a request
// carries, the models the API knows, how many tokens a request is, the prompt cache, and the turn a request gets (the
// scenario's, else the labeled stub) with the answer and stream the Messages API wraps it in.
import { sampleFromSchema, type HandlerContext } from '@volter/world-core';

export type Row = Record<string, unknown>;

/** Structural validation shared with the scenario reader: malformed nested data makes no scenario decision.
 * Error messages identify fields; the documented refusal class is invalid_request_error. */
// source: spec:/components/schemas/CreateMessageParams "Input messages."
export function messageShapeError(body: Row): string | undefined {
  const object = (value: unknown): value is Row => !!value && typeof value === 'object' && !Array.isArray(value);
  if (!Array.isArray(body.messages)) return 'messages: Field required';
  for (const [i, message] of body.messages.entries()) {
    if (!object(message)) return `messages.${i}: Input should be an object`;
    if (message.role !== 'user' && message.role !== 'assistant') return `messages.${i}.role: Input should be user or assistant`;
    if (typeof message.content !== 'string' && !Array.isArray(message.content)) return `messages.${i}.content: Field required`;
    if (Array.isArray(message.content)) for (const [j, block] of message.content.entries()) {
      if (!object(block) || typeof block.type !== 'string') return `messages.${i}.content.${j}: Input should be a content block`;
      if (block.type === 'text' && typeof block.text !== 'string') return `messages.${i}.content.${j}.text: Input should be a string`;
      if (block.type === 'tool_result' && typeof block.tool_use_id !== 'string') return `messages.${i}.content.${j}.tool_use_id: Field required`;
      if (block.type === 'tool_use' && (!object(block.input) || typeof block.id !== 'string' || typeof block.name !== 'string')) return `messages.${i}.content.${j}: Invalid tool_use`;
    }
  }
  if (body.system !== undefined && typeof body.system !== 'string' && (!Array.isArray(body.system) || body.system.some(block => !object(block) || block.type !== 'text' || typeof block.text !== 'string'))) return 'system: Input should be text or text blocks';
  if (body.tools !== undefined && (!Array.isArray(body.tools) || body.tools.some(tool => !object(tool) || typeof tool.name !== 'string' || (tool.type === undefined && !object(tool.input_schema))))) return 'tools: Input should be tool definitions';
  for (const key of ['tool_choice', 'thinking', 'output_config', 'output_format', 'cache_control']) if (body[key] !== undefined && !object(body[key])) return `${key}: Input should be an object`;
  return undefined;
}

export const ORGANIZATION = 'organization';
export const WORKSPACE = 'workspace';
export const KEY = '_api_key';
export const CACHE = '_prompt_cache';
/** The workspace the request's key acts in, as the front (./around.ts) names it to a handler; it overwrites whatever a
 *  client sent under the name. */
export const WORKSPACE_HEADER = 'x-volter-anthropic-workspace';

// ── errors ────────────────────────────────────────────────────────────────────────────────────────────────────────
/** A request id, as every answer carries it (the `request-id` header, and `request_id` in an error). */
// source: https://platform.claude.com/docs/en/api/errors "The response also includes a request_id field"
export const REQUEST_HEADER = 'x-volter-anthropic-request-id';
/** The request's id: the one the front issued for it (./around.ts, ctx.issue), handed on as a header. */
export const requestId = (ctx: Pick<HandlerContext, 'call'>): string => ctx.call.request.headers.get(REQUEST_HEADER) ?? 'req_011C';

/** Anthropic's refusal: `{ type: "error", error: { type, message }, request_id }`. */
// source: https://platform.claude.com/docs/en/api/errors "with a top-level error object that always includes a type and message value"
export function refuse(ctx: Pick<HandlerContext, 'call'>, status: number, type: string, message: string, headers: Record<string, string> = {}): Response {
  const id = headers['request-id'] ?? requestId(ctx);
  return Response.json({ type: 'error', error: { type, message }, request_id: id }, { status, headers: { 'request-id': id, ...headers } });
}
export const invalid = (ctx: Pick<HandlerContext, 'call'>, message: string): Response => refuse(ctx, 400, 'invalid_request_error', message);

// ── keys ──────────────────────────────────────────────────────────────────────────────────────────────────────────
/** The key a request carries: `Authorization: Bearer <key>`, or the legacy `x-api-key`. */
// source: https://platform.claude.com/docs/en/manage-claude/authentication "The legacy x-api-key: YOUR_API_KEY header is still supported in place of Authorization."
export function presentedKey(request: Request): string | undefined {
  const x = request.headers.get('x-api-key')?.trim();
  if (x) return x;
  return /^bearer\s+(\S+)/i.exec(request.headers.get('authorization') ?? '')?.[1];
}

/** The live key with this value: made on the API keys page, active (not disabled or deleted) and not expired ("After a
 *  key expires, requests made with it return a `401 authentication_error`"). */
// source: https://platform.claude.com/docs/en/manage-claude/authentication "After a key expires, requests made with it return a 401 authentication_error."
export function liveKey(ctx: Pick<HandlerContext, 'rowsRaw' | 'crypto' | 'occurredAt'>, value: string): Row | undefined {
  const hash = ctx.crypto.sha256(value);
  const k = ctx.rowsRaw(KEY).find((x) => x._sha256 === hash && x.deleted !== true);
  if (!k || k.status !== 'active') return undefined;
  return typeof k.expires_at === 'string' && Date.parse(k.expires_at) <= Date.parse(ctx.occurredAt) ? undefined : k;
}

/** A key's value as the Console shows it once: `sk-ant-api03-`, then its secret. Where the documentation stops: the
 *  secret's length and alphabet, as keys the Console makes have them. */
// source: https://platform.claude.com/docs/en/manage-claude/authentication "sk-ant-api"
export const keyValue = async (ctx: Pick<HandlerContext, 'secret'>, id: string): Promise<string> =>
  `sk-ant-api03-${await ctx.secret(`anthropic-key:${id}`)}${await ctx.secret(`anthropic-key-2:${id}`)}`.slice(0, 108) + 'AA';

// ── models ────────────────────────────────────────────────────────────────────────────────────────────────────────
/** The models the API answers: the spec's `Model` values. Where the documentation stops: any other id is refused as a
 *  resource that does not exist (`not_found_error`, "model: <id>"), as the API answers a retired or mistyped model. */
// source: spec:/components/schemas/Model "claude-sonnet-4-6"
export const MODELS = ['claude-fable-5-1', 'claude-opus-5-5', 'claude-mythos-5-1', 'claude-sonnet-5', 'claude-fable-5', 'claude-mythos-5', 'claude-opus-5', 'claude-opus-4-8', 'claude-opus-4-7',
  'claude-mythos-preview', 'claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5', 'claude-haiku-4-5-20251001', 'claude-opus-4-5', 'claude-opus-4-5-20251101', 'claude-sonnet-4-5', 'claude-sonnet-4-5-20250929'];

/** What the Models API answers of a model an organization can use: its id, name, release, limits, thinking and effort.
 *  The spec's models less its aliases (each lists as its pinned id), the deprecated preview, and the Mythos models,
 *  which are offered by invitation only; newest first. */
type Thinking = 'adaptive' | 'both' | 'enabled';
type CatalogEntry = { id: string; name: string; released: string; input: number; output: number; thinking: Thinking; effort: string[] };
const ALL_EFFORT = ['low', 'medium', 'high', 'xhigh', 'max'];
// source: https://platform.claude.com/docs/en/models/opus-5-5/overview "Released September 22, 2026"
const OPUS_5_5: CatalogEntry = { id: 'claude-opus-5-5', name: 'Claude Opus 5.5', released: '2026-09-22', input: 1_000_000, output: 128_000, thinking: 'adaptive', effort: ALL_EFFORT };
// source: https://platform.claude.com/docs/en/models/fable-5-1/overview "Released September 1, 2026"
const FABLE_5_1: CatalogEntry = { id: 'claude-fable-5-1', name: 'Claude Fable 5.1', released: '2026-09-01', input: 1_000_000, output: 128_000, thinking: 'adaptive', effort: ALL_EFFORT };
// source: https://platform.claude.com/docs/en/models/opus-5/overview "Released July 24, 2026"
const OPUS_5: CatalogEntry = { id: 'claude-opus-5', name: 'Claude Opus 5', released: '2026-07-24', input: 1_000_000, output: 128_000, thinking: 'adaptive', effort: ALL_EFFORT };
// source: https://platform.claude.com/docs/en/models/sonnet-5/overview "Released June 30, 2026"
const SONNET_5: CatalogEntry = { id: 'claude-sonnet-5', name: 'Claude Sonnet 5', released: '2026-06-30', input: 1_000_000, output: 128_000, thinking: 'adaptive', effort: ALL_EFFORT };
// source: https://platform.claude.com/docs/en/models/fable-5/overview "Released June 9, 2026"
const FABLE_5: CatalogEntry = { id: 'claude-fable-5', name: 'Claude Fable 5', released: '2026-06-09', input: 1_000_000, output: 128_000, thinking: 'adaptive', effort: ALL_EFFORT };
// source: https://platform.claude.com/docs/en/models/opus-4-8/overview "Released May 28, 2026"
const OPUS_4_8: CatalogEntry = { id: 'claude-opus-4-8', name: 'Claude Opus 4.8', released: '2026-05-28', input: 1_000_000, output: 128_000, thinking: 'adaptive', effort: ALL_EFFORT };
// source: https://platform.claude.com/docs/en/models/opus-4-7/overview "Released April 16, 2026"
const OPUS_4_7: CatalogEntry = { id: 'claude-opus-4-7', name: 'Claude Opus 4.7', released: '2026-04-16', input: 1_000_000, output: 128_000, thinking: 'adaptive', effort: ALL_EFFORT };
// source: https://platform.claude.com/docs/en/models/sonnet-4-6/overview "Released February 17, 2026"
const SONNET_4_6: CatalogEntry = { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', released: '2026-02-17', input: 1_000_000, output: 128_000, thinking: 'both', effort: ['low', 'medium', 'high', 'max'] };
// source: https://platform.claude.com/docs/en/models/opus-4-6/overview "Released February 5, 2026"
const OPUS_4_6: CatalogEntry = { id: 'claude-opus-4-6', name: 'Claude Opus 4.6', released: '2026-02-05', input: 1_000_000, output: 128_000, thinking: 'both', effort: ['low', 'medium', 'high', 'max'] };
// source: https://platform.claude.com/docs/en/models/opus-4-5/overview "Released November 24, 2025"
const OPUS_4_5: CatalogEntry = { id: 'claude-opus-4-5-20251101', name: 'Claude Opus 4.5', released: '2025-11-24', input: 200_000, output: 64_000, thinking: 'enabled', effort: ['low', 'medium', 'high'] };
// source: https://platform.claude.com/docs/en/models/haiku-4-5/overview "Released October 15, 2025"
const HAIKU_4_5: CatalogEntry = { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5', released: '2025-10-15', input: 200_000, output: 64_000, thinking: 'enabled', effort: [] };
// source: https://platform.claude.com/docs/en/models/sonnet-4-5/overview "Released September 29, 2025"
const SONNET_4_5: CatalogEntry = { id: 'claude-sonnet-4-5-20250929', name: 'Claude Sonnet 4.5', released: '2025-09-29', input: 200_000, output: 64_000, thinking: 'enabled', effort: [] };
// source: spec:models_list "More recently released models are listed first."
export const CATALOG: CatalogEntry[] = [OPUS_5_5, FABLE_5_1, OPUS_5, SONNET_5, FABLE_5, OPUS_4_8, OPUS_4_7, SONNET_4_6, OPUS_4_6, OPUS_4_5, HAIKU_4_5, SONNET_4_5];

/** The catalog's documented releases on the World's clock. Aliases share their pinned model's release.
 * Trusted-access Mythos models are outside this workspace's catalog; no invitation is synthesized. */
// source: spec:/components/schemas/ModelInfo "the time at which the model was released"
export const catalogAt = (at: string): CatalogEntry[] => CATALOG.filter((m) => m.released <= at.slice(0, 10));
export const modelAvailable = (model: string, at: string): boolean => catalogAt(at).some((m) => m.id === model || m.id.replace(/-\d{8}$/, '') === model);

const supported = (yes: boolean): Row => ({ supported: yes });
/** A model as the Models API answers it (`ModelInfo`). */
// source: spec:/components/schemas/ModelCapabilities "Model capability information."
export function modelInfo(m: CatalogEntry): Row {
  return {
    type: 'model', id: m.id, display_name: m.name, created_at: `${m.released}T00:00:00Z`, max_input_tokens: m.input, max_tokens: m.output,
    capabilities: {
      // source: https://platform.claude.com/docs/en/models/opus-4-6/overview "50% discount on input and output"
      batch: supported(true),
      // where the documentation stops: citations, code execution, PDFs and structured outputs are answered supported, as
      // the vendor's published List Models example answers them (https://platform.claude.com/docs/en/api/models/list)
      citations: supported(true),
      code_execution: supported(true),
      // source: https://platform.claude.com/docs/en/build-with-claude/context-editing "Context editing is available on all supported Claude models."
      context_management: { supported: true, clear_thinking_20251015: supported(true), clear_tool_uses_20250919: supported(true), compact_20260112: supported(true) },
      // source: https://platform.claude.com/docs/en/build-with-claude/effort "Not every model that supports max supports xhigh."
      effort: { supported: m.effort.length > 0, ...Object.fromEntries(ALL_EFFORT.map((level) => [level, supported(m.effort.includes(level))])) },
      // source: https://platform.claude.com/docs/en/models/opus-4-6/overview "Text and images → text"
      image_input: supported(true),
      pdf_input: supported(true),
      structured_outputs: supported(true),
      // source: https://platform.claude.com/docs/en/build-with-claude/extended-thinking "Claude 4.7 and later models do not support it and reject requests that use it, returning a 400 error."
      thinking: { supported: true, types: { adaptive: supported(m.thinking !== 'enabled'), enabled: supported(m.thinking !== 'adaptive') } },
    },
  };
}

/** Claude 4.7 and later models: high-resolution images, and manual extended thinking refused. */
// source: https://platform.claude.com/docs/en/build-with-claude/extended-thinking "Claude 4.7 and later models do not support it and reject requests that use it, returning a 400 error."
// source: spec:/components/schemas/CreateMessageParams "Models released after Claude Opus 4.6 do not accept top_k"
export const restrictedSampling = (model: string): boolean => isLatest(model) || model === 'claude-sonnet-4-6';

export const isLatest = (model: string): boolean => /^claude-(fable|mythos|opus-5|sonnet-5|opus-4-[78])/.test(model);

/** The shortest prefix a model caches. */
// source: https://platform.claude.com/docs/en/build-with-claude/prompt-caching "Shorter prompts cannot be cached, even if marked with cache_control."
export function minimumCacheable(model: string): number {
  if (/^claude-(fable|mythos-5|opus-5|sonnet-5)/.test(model)) return 512;
  if (/^claude-(mythos-preview|opus-4-7)/.test(model)) return 2048;
  if (/^claude-(opus-4-6|opus-4-5|haiku-4-5)/.test(model)) return 4096;
  return 1024;
}

// ── tokens ────────────────────────────────────────────────────────────────────────────────────────────────────────
/** An image's tokens: `⌈width / 28⌉ × ⌈height / 28⌉` visual tokens, at most the model's limit (1568, or 4784 on Claude
 *  4.7 and later), read from a base64 PNG's or JPEG's header. Where the documentation stops: an image whose size the
 *  twin cannot read (a URL, another format) counts as the limit, and text as one token per four characters. */
// source: https://platform.claude.com/docs/en/build-with-claude/vision "An image, therefore, costs ⌈width / 28⌉ × ⌈height / 28⌉ visual tokens."
export function imageTokens(source: Row | undefined, model: string): number {
  const cap = isLatest(model) ? 4784 : 1568;
  const size = source?.type === 'base64' && typeof source.data === 'string' ? dimensions(source.data) : undefined;
  return size ? Math.min(cap, Math.ceil(size[0] / 28) * Math.ceil(size[1] / 28)) : cap;
}

function dimensions(b64: string): [number, number] | undefined {
  let bin: string;
  try { bin = atob(b64.slice(0, 65536).replace(/[^A-Za-z0-9+/]/g, '').slice(0, 87380 - (87380 % 4))); } catch { return undefined; }
  const at = (i: number): number => bin.charCodeAt(i) & 0xff;
  return bin.startsWith('\x89PNG') ? [(at(16) << 24) | (at(17) << 16) | (at(18) << 8) | at(19), (at(20) << 24) | (at(21) << 16) | (at(22) << 8) | at(23)] : at(0) === 0xff && at(1) === 0xd8 ? jpegDimensions(bin) : undefined;
}

/** Reads JPEG frame headers; the customer's screenshot and the published example use PNG. */
function jpegDimensions(bin: string): [number, number] | undefined {
  for (let i = 2; i + 9 < bin.length;) {
    if ((bin.charCodeAt(i) & 0xff) !== 0xff) return undefined;
    const marker = (bin.charCodeAt(i + 1) & 0xff);
    const len = ((bin.charCodeAt(i + 2) & 0xff) << 8) | (bin.charCodeAt(i + 3) & 0xff);
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return [((bin.charCodeAt(i + 7) & 0xff) << 8) | (bin.charCodeAt(i + 8) & 0xff), ((bin.charCodeAt(i + 5) & 0xff) << 8) | (bin.charCodeAt(i + 6) & 0xff)];
    i += 2 + len;
  }
  return undefined;
}

const textTokens = (s: string): number => Math.ceil(s.length / 4);

/** A content block's tokens. */
export function blockTokens(block: unknown, model: string): number {
  if (typeof block === 'string') return textTokens(block);
  const b = (block ?? {}) as Row;
  switch (b.type) {
    case 'text': return textTokens(String(b.text ?? ''));
    case 'image': return imageTokens(b.source as Row | undefined, model);
    case 'document': return textTokens(JSON.stringify(b.source ?? ''));
    case 'tool_use': case 'server_tool_use': return textTokens(`${String(b.name)}${JSON.stringify(b.input ?? {})}`);
    case 'tool_result': return Array.isArray(b.content) ? (b.content as unknown[]).reduce<number>((n, c) => n + blockTokens(c, model), 0) : textTokens(String(b.content ?? ''));
    case 'thinking': return textTokens(String(b.thinking ?? ''));
    default: return textTokens(JSON.stringify(b));
  }
}

/** A request's parts in the order a prompt is read and cached (tools, system, then messages), each with its tokens and
 *  whether it is a cache breakpoint. */
// source: https://platform.claude.com/docs/en/build-with-claude/prompt-caching "Cache prefixes are created in the following order: tools, system, then messages."
export type Segment = { tokens: number; breakpoint?: { ttl: '5m' | '1h' }; canonical: string };
export function segmentsOf(body: Row, model: string): Segment[] {
  const out: Segment[] = [];
  const mark = (x: Row): Segment['breakpoint'] => {
    const cc = x.cache_control as Row | undefined;
    return cc && cc.type === 'ephemeral' ? { ttl: cc.ttl === '1h' ? '1h' : '5m' } : undefined;
  };
  for (const t of (body.tools as Row[] | undefined) ?? []) out.push({ tokens: textTokens(JSON.stringify({ name: t.name, description: t.description, input_schema: t.input_schema, type: t.type })), breakpoint: mark(t), canonical: JSON.stringify(t) });
  const system = body.system;
  if (typeof system === 'string') out.push({ tokens: textTokens(system), canonical: system });
  else for (const s of (system as Row[] | undefined) ?? []) out.push({ tokens: blockTokens(s, model), breakpoint: mark(s), canonical: JSON.stringify({ ...s, cache_control: undefined }) });
  for (const m of (body.messages as Row[] | undefined) ?? []) {
    out.push({ tokens: 4, canonical: `role:${String(m.role)}` });
    const content = m.content;
    if (typeof content === 'string') out.push({ tokens: textTokens(content), canonical: content });
    else for (const c of (content as Row[] | undefined) ?? []) out.push({ tokens: blockTokens(c, model), breakpoint: mark(c), canonical: JSON.stringify({ ...c, cache_control: undefined }) });
  }
  // a top-level cache_control marks the last cacheable block (automatic caching)
  const top = body.cache_control as Row | undefined;
  if (top?.type === 'ephemeral' && out.length) out[out.length - 1] = { ...out[out.length - 1]!, breakpoint: { ttl: top.ttl === '1h' ? '1h' : '5m' } };
  return out;
}

export const inputTokens = (segments: Segment[]): number => segments.reduce((n, s) => n + s.tokens, 0);

// ── the prompt cache ──────────────────────────────────────────────────────────────────────────────────────────────
export type CacheUsage = { cache_creation_input_tokens: number; cache_read_input_tokens: number; cache_creation: { ephemeral_5m_input_tokens: number; ephemeral_1h_input_tokens: number } };

/** A request's cache reads and writes. The longest prefix, up to a breakpoint, cached and not expired in the workspace
 *  is read, and its lifetime refreshed ("The cache is refreshed for no additional cost each time the cached content is
 *  used"). The prefix up to the last breakpoint beyond it is written, with that breakpoint's lifetime. A prefix shorter
 *  than the model's minimum is neither. Where the documentation stops: a prefix is keyed by its content, and the
 *  written tokens are those past the prefix read. */
// source: https://platform.claude.com/docs/en/build-with-claude/prompt-caching "By default, the cache has a 5-minute lifetime. The cache is refreshed for no additional cost each time the cached content is used."
export async function cacheFor(ctx: HandlerContext, workspace: string, model: string, segments: Segment[], write: boolean): Promise<CacheUsage> {
  const none: CacheUsage = { cache_creation_input_tokens: 0, cache_read_input_tokens: 0, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 } };
  const now = Date.parse(ctx.occurredAt);
  const min = minimumCacheable(model);
  const points: Array<{ key: string; tokens: number; ttl: '5m' | '1h' }> = [];
  let tokens = 0;
  let canonical = `${workspace}|${model}`;
  for (const s of segments) {
    tokens += s.tokens;
    canonical += `|${s.canonical}`;
    if (s.breakpoint && tokens >= min) points.push({ key: ctx.crypto.sha256(canonical), tokens, ttl: s.breakpoint.ttl });
  }
  if (!points.length) return none;
  const live = (key: string): Row | undefined => ctx.rowsRaw(CACHE).find((r) => r.id === key && Date.parse(String(r.expires_at)) > now);
  const hit = [...points].reverse().find((p) => live(p.key));
  const last = points[points.length - 1]!;
  const read = hit?.tokens ?? 0;
  const created = hit === last ? 0 : last.tokens - read;
  const hourPrefix = Math.max(0, ...points.filter(p => p.ttl === '1h').map(p => p.tokens));
  const hourCreated = Math.max(0, hourPrefix - read);
  if (write) {
    for (const p of points) {
      if (p.tokens > last.tokens) continue;
      const ms = p.ttl === '1h' ? 3_600_000 : 300_000;
      if (hit && p.tokens <= hit.tokens && !live(p.key)) continue;
      await ctx.record(CACHE, { tokens: p.tokens, ttl: p.ttl, expires_at: new Date(now + ms).toISOString() }, p.key);
    }
  }
  return { cache_creation_input_tokens: created, cache_read_input_tokens: read, cache_creation: { ephemeral_5m_input_tokens: created - hourCreated, ephemeral_1h_input_tokens: hourCreated } };
}

// ── the turn ──────────────────────────────────────────────────────────────────────────────────────────────────────
export type ToolUse = { id?: string; name: string; input: Row };
/** What a turn says: the scenario's `respond`, or the stub's. */
export type ServerTool = { name: 'web_search'; input: Row; results: Row[]; id?: string };
export type Turn = { serverTools?: ServerTool[]; text?: string; toolUses?: ToolUse[]; thinking?: string; stopReason?: string };
export const RESPOND_KEYS = new Set(['text', 'toolUses', 'serverTools', 'thinking', 'stopReason']);
export const STOP_REASONS = new Set(['end_turn', 'max_tokens', 'stop_sequence', 'tool_use', 'pause_turn', 'refusal']);

export const textOf = (content: unknown): string =>
  typeof content === 'string' ? content : Array.isArray(content) ? (content as Row[]).map((c) => (c.type === 'text' ? String(c.text ?? '') : c.type === 'tool_result' ? textOf(c.content) : '')).filter(Boolean).join('\n') : '';

export function lastUserText(messages: Row[]): string {
  for (let i = messages.length - 1; i >= 0; i--) if (messages[i]!.role === 'user') { const t = textOf(messages[i]!.content); if (t) return t; }
  return '';
}

/** The tool results the last message carries, by the names of the tool_use blocks they answer. */
export function toolResultNames(messages: Row[]): string[] {
  const last = messages[messages.length - 1];
  const ids = Array.isArray(last?.content) ? (last!.content as Row[]).filter((c) => c.type === 'tool_result').map((c) => c.tool_use_id) : [];
  if (!ids.length) return [];
  return messages.flatMap((m) => (Array.isArray(m.content) ? (m.content as Row[]) : [])).filter((c) => c.type === 'tool_use' && ids.includes(c.id)).map((c) => String(c.name));
}


/** The stub: no model runs, and the answer says so. With tools offered (tool_choice not `none`) and the last message
 *  not a tool's result, it calls the tool the choice names, else the first; with a JSON schema for the output, it
 *  answers a value the schema admits; otherwise it echoes the last user message, labeled. */
export function stubTurn(body: Row): Turn {
  const model = String(body.model);
  const messages = (body.messages as Row[]) ?? [];
  const tools = ((body.tools as Row[] | undefined) ?? []).filter((t) => t.input_schema !== undefined);
  const choice = (body.tool_choice as Row | undefined) ?? { type: 'auto' };
  const lastIsResult = toolResultNames(messages).length > 0;
  if (tools.length && choice.type !== 'none' && (!lastIsResult || choice.type === 'any' || choice.type === 'tool')) {
    const tool = (choice.type === 'tool' ? tools.find((t) => t.name === choice.name) : undefined) ?? tools[0]!;
    return { toolUses: [{ name: String(tool.name), input: sampleFromSchema(tool.input_schema, String(tool.name)) as Row }] };
  }
  const format = ((body.output_config as Row | undefined)?.format ?? body.output_format) as Row | undefined;
  if (format?.type === 'json_schema') return { text: JSON.stringify(sampleFromSchema(format.schema)) };
  const said = lastUserText(messages).trim();
  return { text: `[twin-stub:${model}] This is a deterministic stub from the Claude API twin (no model runs). Your last message: ${said.length > 200 ? `${said.slice(0, 200)}…` : said || '(empty)'}` };
}

/** The answer's content blocks: a thinking block when thinking is on (its signature the twin's), then the text or the
 *  tool calls. */
export function contentOf(ctx: Pick<HandlerContext, 'crypto'>, turn: Turn, thinking: boolean, seed: string): Row[] {
  const out: Row[] = [];
  if (thinking) {
    const text = turn.thinking ?? '[twin-stub] No model runs here, so there is no reasoning to show.';
    out.push({ type: 'thinking', thinking: text, signature: ctx.crypto.digest('sha256', `signature:${seed}:${text}`, 'base64') });
  }
  // source: spec:/components/schemas/ResponseServerToolUseBlock "server_tool_use"
  // source: spec:/components/schemas/ResponseWebSearchToolResultBlock "web_search_tool_result"
  (turn.serverTools ?? []).forEach((tool, i) => {
    const id = tool.id ?? `srvtoolu_${ctx.crypto.digest('sha256', `server-tool:${seed}:${i}`, 'hex').slice(0, 24)}`;
    out.push({ type: 'server_tool_use', id, name: tool.name, input: tool.input, caller: { type: 'direct' } });
    out.push({ type: 'web_search_tool_result', tool_use_id: id, content: tool.results, caller: { type: 'direct' } });
  });
  // source: spec:/components/schemas/ResponseTextBlock "Citations supporting the text block."
  if (turn.text !== undefined) out.push({ type: 'text', text: turn.text, citations: null });
  (turn.toolUses ?? []).forEach((t, i) => out.push({ type: 'tool_use', id: t.id ?? `toolu_01${ctx.crypto.digest('sha256', `tool:${seed}:${i}`, 'base64url').replace(/[-_]/g, '').slice(0, 22)}`, name: t.name, input: t.input, caller: { type: 'direct' } }));
  return out;
}

/** The answer's output tokens: its blocks' tokens, at most `max_tokens`. */
export const outputTokens = (content: Row[], model: string): number => Math.max(1, content.reduce((n, c) => n + blockTokens(c, model), 0));

/** A message as a stream of server-sent events: message_start with empty content, per block its start, deltas and
 *  stop (a ping after the first start), message_delta with the stop reason and output usage, message_stop. */
// source: https://platform.claude.com/docs/en/build-with-claude/streaming "message_start: contains a Message object with empty content."
export function streamOf(message: Row, headers: Record<string, string>): Response {
  const events: string[] = [];
  const send = (type: string, data: Row): void => { events.push(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`); };
  const usage = message.usage as Row;
  send('message_start', { message: { ...message, content: [], stop_reason: null, stop_sequence: null, usage: { ...usage, output_tokens: 1 } } });
  (message.content as Row[]).forEach((block, index) => {
    if (block.type === 'text') {
      send('content_block_start', { index, content_block: { type: 'text', text: '', citations: null } });
      if (index === 0) send('ping', {});
      for (const piece of chunks(String(block.text))) send('content_block_delta', { index, delta: { type: 'text_delta', text: piece } });
    } else if (block.type === 'thinking') {
      send('content_block_start', { index, content_block: { type: 'thinking', thinking: '', signature: '' } });
      if (index === 0) send('ping', {});
      for (const piece of chunks(String(block.thinking))) send('content_block_delta', { index, delta: { type: 'thinking_delta', thinking: piece } });
      send('content_block_delta', { index, delta: { type: 'signature_delta', signature: block.signature } });
    } else if (block.type === 'tool_use' || block.type === 'server_tool_use') {
      send('content_block_start', { index, content_block: { ...block, input: {} } });
      if (index === 0) send('ping', {});
      for (const piece of chunks(JSON.stringify(block.input))) send('content_block_delta', { index, delta: { type: 'input_json_delta', partial_json: piece } });
    }
    else send('content_block_start', { index, content_block: block });
    send('content_block_stop', { index });
  });
  send('message_delta', { delta: { stop_reason: message.stop_reason, stop_sequence: null }, usage: { output_tokens: usage.output_tokens } });
  send('message_stop', {});
  return new Response(events.join(''), { headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', ...headers } });
}

/** Text in the pieces a stream sends it in: a few words at a time. */
function chunks(text: string): string[] {
  const words = text.match(/\S+\s*|\s+/g) ?? [text];
  const out: string[] = [];
  for (let i = 0; i < words.length; i += 4) out.push(words.slice(i, i + 4).join(''));
  return out.length ? out : [''];
}
