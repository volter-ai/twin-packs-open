// What Merge's Gateway shares: its organizations (their prepaid credit and what they have spent) and API keys (each by
// its SHA-256), its error envelope, and its catalogue: each model's per-token prices, from which a call's cost and
// Merge's fee are reckoned and drawn from the organization's credit. THE TWIN RUNS NO MODEL.
import type { HandlerContext } from '@volter/world-core';

export type Row = Record<string, unknown>;
export const ORG = '_organization';
export const KEY = '_api_key';

export const sha256 = (ctx: Pick<HandlerContext, 'crypto'>, v: string): string => ctx.crypto.digest('sha256', v);

// ── errors ─────────────────────────────────────────────────────────────────────────────────────
// source: https://docs.merge.dev/merge-gateway/errors "Gateway errors carry a stable"
/** The error envelope: `type`, `message`, and `code`, `param`, `source` and `provider` once the body is read; a
 *  rejection before Gateway reads the body (the key, the credit) sends only `type`, `message` and `code`. */
export function mergeError(status: number, type: string, message: string, more: { code?: string; param?: string | null; read?: boolean } = {}): Response {
  const error: Row = { type, message, ...(more.code ? { code: more.code } : {}) };
  if (more.read) Object.assign(error, { param: more.param ?? null, source: 'gateway', provider: null });
  return Response.json({ error }, { status });
}

// ── keys ───────────────────────────────────────────────────────────────────────────────────────

/** The organization a request's key opens, or the 401 Gateway answers. */
// source: https://docs.merge.dev/merge-gateway/errors "Missing key, or an"
export function organizationOf(ctx: HandlerContext): Row | Response {
  const h = ctx.call.request.headers;
  const auth = h.get('authorization');
  const bearer = auth ? /^Bearer\s+(\S+)$/i.exec(auth)?.[1] : undefined;
  const key = bearer ?? h.get('x-api-key') ?? undefined;
  // Where the documentation stops: the words are the ones api-gateway.merge.dev answers (spec/SOURCE.md)
  if (!key || (auth && !bearer)) return mergeError(401, 'invalid_request_error', "Missing API key. Provide via 'Authorization: Bearer <key>' or 'X-API-Key' header.");
  const held = ctx.rowsRaw(KEY).find((k) => k.deleted !== true && k.sha256 === sha256(ctx, key));
  // source: https://docs.merge.dev/merge-gateway/errors "Unknown, expired, or inactive key"
  const org = held ? ctx.row(ORG, String(held._organization)) : undefined;
  return org ?? mergeError(401, 'invalid_api_key', 'Invalid API key.');
}

// ── the catalogue ──────────────────────────────────────────────────────────────────────────────
// The models our products call (journeys/demand.json): the one Open Autonomy runs by default, at the per-token prices
// it measured against Gateway's reported costs (spec/SOURCE.md, "Model prices"), and the one Volter Editor's Pi runs
// in Substrate, at Anthropic's list prices (Gateway's cost is the vendor's: "Vendor cost plus a 5% Merge fee"). Prices
// in USD per million tokens; `gated` is the provider whose access a newer organization is granted before its calls.
export type Model = {
  id: string; vendor: string; name: string; input: number; output: number; cacheRead: number;
  context: number; maxOutput: number; inputs: string[]; gated?: string;
};
export const MODELS: Model[] = [
  // source: https://docs.z.ai/guides/vlm/glm-5.3-flash "with support for a 1M-token context window"
  // source: https://docs.z.ai/guides/vlm/glm-5.3-flash "Maximum Output Tokens"
  { id: 'zai/glm-5.3-flash', vendor: 'zai', name: 'GLM-5.3 Flash', input: 0.015, output: 0.05, cacheRead: 0.003, context: 1_000_000, maxOutput: 128_000, inputs: ['text', 'image', 'document', 'video'] },
  // source: https://platform.claude.com/docs/en/models/haiku-4-5/overview "Context window 200K tokens Max output 64K tokens Input pricing $1 / MTok Output pricing $5 / MTok"
  // source: https://platform.claude.com/docs/en/about-claude/pricing "A cache hit costs 10% of the standard input price"
  { id: 'anthropic/claude-haiku-4-5-20251001', vendor: 'anthropic', name: 'Claude Haiku 4.5 (20251001)', input: 1, output: 5, cacheRead: 0.1, context: 200_000, maxOutput: 64_000, inputs: ['text', 'image', 'document'], gated: 'anthropic' },
  // source: https://docs.merge.dev/merge-gateway/get-started "such as anthropic/claude-sonnet-5-5"
  // source: https://platform.claude.com/docs/en/about-claude/models/overview "$2 / input MTok $10 / output MTok"
  // source: https://platform.claude.com/docs/en/about-claude/models/overview "Max output 128K tokens"
  // source: https://platform.claude.com/docs/en/about-claude/pricing "A cache hit costs 10% of the standard input price"
  { id: 'anthropic/claude-sonnet-5-5', vendor: 'anthropic', name: 'Claude Sonnet 5.5', input: 2, output: 10, cacheRead: 0.2, context: 1_000_000, maxOutput: 128_000, inputs: ['text', 'image', 'document'], gated: 'anthropic' },
];

// ── provider access ────────────────────────────────────────────────────────────────────────────
// source: https://docs.merge.dev/merge-gateway/model-access/vendor-access "need access enabled before calling its models."
// source: https://docs.merge.dev/merge-gateway/model-access/vendor-access "September 4, 2026 at 5:00pm ET (21:00 UTC)"
export const GATED: Record<string, { cutoff: string; name: string }> = { anthropic: { cutoff: '2026-09-04T21:00:00.000Z', name: 'Anthropic' } };

/** Whether the organization still needs access to the model's provider: made on or after its cutoff, and not granted. */
export function accessRequired(org: Row, m: Model): boolean {
  const gate = m.gated ? GATED[m.gated] : undefined;
  if (!gate) return false;
  const granted = Array.isArray(org.access) && (org.access as unknown[]).includes(m.gated);
  return !granted && Date.parse(String(org.created_at)) >= Date.parse(gate.cutoff);
}

/** Gateway's refusal of a call to a gated model the organization has no access to: before the body is read. */
// source: https://docs.merge.dev/merge-gateway/model-access/vendor-access "models are not enabled for this organization."
export const accessRefusal = (org: Row, m: Model): Response | undefined =>
  accessRequired(org, m) ? mergeError(403, 'blocked_by_policy', `${GATED[m.gated!]!.name} models are not enabled for this organization. Contact support@merge.dev, or use the in-app chat, to request access.`, { code: 'vendor_access_required' }) : undefined;

/** A catalogue model as GET /v1/models lists it: identity at the top, its one route under `vendors`. */
// source: https://docs.merge.dev/merge-gateway/api-overview "returns canonical model identity at the top level and per-vendor execution details under"
// source: https://docs.merge.dev/merge-gateway/model-access/vendor-access "Gated models stay visible."
export function publicModel(org: Row, m: Model): Row {
  const gated = accessRequired(org, m);
  return {
    model: m.id, provider: m.id.split('/')[0], display_name: m.name, aliases: [],
    vendors: { [m.vendor]: {
      // Where the documentation stops: the route's launch date and ZDR flag are not published for these models
      launch_date: null, context_window: m.context, max_output_tokens: m.maxOutput, availability_status: 'available', zero_data_retention: false,
      capabilities: { input: m.inputs, output: ['text', 'tool_use'], supports_tool_calling: true, supports_tool_choice: true, supports_structured_outputs: true, streaming: true },
      service_tiers: ['standard'],
      pricing: { currency: 'USD', unit: 'per_token', input_per_million: m.input, output_per_million: m.output, cache_read_per_million: m.cacheRead, flex: null, priority: null },
    } },
    availability_status: 'available', created_at: null, updated_at: null,
    access_required: gated, access_reason: gated ? 'vendor_access_required' : null,
  };
}

/** The model a request names (`provider/model`, or a bare name one provider has), or Gateway's refusal. */
export function modelOf(name: unknown): Model | Response {
  // source: https://docs.merge.dev/merge-gateway/errors "and no routing policy resolved"
  if (typeof name !== 'string' || !name) return mergeError(400, 'invalid_request_error', 'A model is required: send model, or set a default routing policy.', { code: 'model_required', param: 'model', read: true });
  const found = MODELS.filter((m) => m.id === name || m.id.split('/')[1] === name);
  // source: https://docs.merge.dev/merge-gateway/errors "Model 'openai/gpt-9' is not supported. Check /v1/models for available models."
  if (found.length !== 1) return mergeError(404, 'not_found_error', `Model '${name}' is not supported. Check /v1/models for available models.`, { code: 'model_not_found', param: 'model', read: true });
  return found[0]!;
}

// ── cost ───────────────────────────────────────────────────────────────────────────────────────

// source: https://docs.merge.dev/merge-gateway/cost/pricing "Vendor cost plus a 5% Merge fee"
export const PRO_FEE = 0.05;
const usd = (n: number): number => Math.round(n * 1e12) / 1e12;

/** A call's cost at the model's prices (cached input at the cache-read price), and Merge's fee on it. */
export function priced(m: Model, input: number, output: number, cached = 0): { cost: number; fee: number } {
  const cost = usd(((input - cached) * m.input + cached * m.cacheRead + output * m.output) / 1e6);
  return { cost, fee: usd(cost * PRO_FEE) };
}

/** The organization's credit left: what it bought less what its calls cost. */
export const creditLeft = (org: Row): number => Number(org.credit_usd) - Number(org.spent_usd ?? 0);

/** Gateway's refusal before any vendor call when the organization's credit is used up. */
// source: https://docs.merge.dev/merge-gateway/cost/pricing "Each block happens before any vendor call, so it costs nothing."
export const creditRefusal = (org: Row): Response | undefined =>
  creditLeft(org) > 0 ? undefined : mergeError(402, 'budget_exceeded', 'Organization credit is used up. Add credits or upgrade.', { code: 'budget_exceeded' });

/** The call's cost and fee drawn from the organization's credit. */
export async function spend(ctx: HandlerContext, org: Row, charge: { cost: number; fee: number }): Promise<void> {
  await ctx.accumulate(ORG, String(org.id), { spent_usd: charge.cost + charge.fee }, 'gateway.charged');
}

/** Whether the request asks for the routing metadata (the body's flag, or a header that turns it on). */
// source: https://docs.merge.dev/merge-gateway/api-overview "Headers only turn it on, never off."
export function routingAsked(ctx: HandlerContext, body: Row): boolean {
  const h = ctx.call.request.headers;
  return body.include_routing_metadata === true || ['include-routing-metadata', 'x-merge-include-routing'].some((n) => h.get(n) === 'true');
}

/** The routing metadata of a direct model call: the model asked and used, its vendor, the cost and Merge's fee. */
export const routingOf = (m: Model, requested: string, charge: { cost: number; fee: number }): Row => ({
  policy_id: null, policy_name: null, strategy: null, intelligent_routing_used: false, complexity_score: null, adjusted_score: null,
  selected_tier: null, total_tiers: null, routing_reason: 'Direct model request', router_decision_id: null,
  model_requested: requested, model_used: m.id, vendor_used: m.vendor, credential_type: 'managed', fallback: false,
  reasoning_effort_requested: null, reasoning_effort_applied: null, reasoning_effort_source: null,
  cost_usd: charge.cost, merge_fee_usd: charge.fee, latency: null,
});

// ── a turn ─────────────────────────────────────────────────────────────────────────────────────

export const LABEL = 'Merge Gateway twin';
export const obj = (v: unknown): Row => (v && typeof v === 'object' && !Array.isArray(v) ? v as Row : {});
export const arr = (v: unknown): Row[] => (Array.isArray(v) ? v as Row[] : []);
export const SSE = { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache' };

/** What every surface does first: the key, the credit, the model and its provider's access. */
export function admitted(ctx: HandlerContext): { org: Row; model: Model; body: Row } | Response {
  const org = organizationOf(ctx);
  if (org instanceof Response) return org;
  const refused = creditRefusal(org);
  if (refused) return refused;
  const invalid = ctx.validate();
  if (invalid) return invalid;
  const body = obj(ctx.body);
  const model = modelOf(body.model);
  if (model instanceof Response) return model;
  // source: spec:/components/schemas/ResponseRequest/properties/service_tier "a tier the route doesn't price returns 400"
  const tier = body.service_tier;
  if (tier != null && !['standard', 'default', 'auto', 'unspecified', 'standard_only'].includes(String(tier))) return mergeError(400, 'invalid_request_error', 'The route does not price the requested service tier.', { code: 'unsupported_params', param: 'service_tier', read: true });
  return accessRefusal(org, model) ?? { org, model, body };
}

/** An id of the turn's own, from the call's issued id (ctx.issue: each call's is another). */
export const idOf = (ctx: HandlerContext, call: string, kind: string): string => ctx.crypto.digest('sha256', `merge:${call}:${kind}`, 'base64url').replace(/[-_]/g, '').slice(0, 24);

/** The native Responses vocabulary translated only for the kernel's deterministic wire/scenario helpers. */
// source: https://docs.merge.dev/merge-gateway/capabilities/tool-calling "then add a tool_result for each tool_use"
// source: spec:/components/schemas/ResponseRequest/properties/tool_choice "function"
export function nativeResponsesBody(body: Row): Row {
  const choice = obj(body.tool_choice);
  const format = obj(body.response_format ?? obj(body.text).format);
  return {
    ...body,
    input: arr(body.input).map((item) => item.type === 'tool_result' ? { type: 'function_call_output', call_id: item.tool_use_id, output: item.content } : item),
    ...(choice.type === 'function' ? { tool_choice: { ...choice, name: choice.name ?? obj(choice.function).name } } : {}),
    text: { ...obj(body.text), format: format.type === 'json_schema' ? { ...format, schema: format.schema ?? obj(format.json_schema).schema } : format },
  };
}

/** Only the call's request id is present on streams; resolved vendor/model headers describe completed JSON calls. */
// source: https://docs.merge.dev/merge-gateway/api-overview "The vendor and canonical model that served a non-streaming request"
// source: https://docs.merge.dev/merge-gateway/streaming "No x-merge-vendor"
export const turnHeaders = (ctx: HandlerContext, call: string, model: Model, stream: boolean): Record<string, string> => ({
  'X-Request-ID': `req_${idOf(ctx, call, 'request')}`,
  ...(stream ? SSE : { 'x-merge-model': model.id, 'x-merge-vendor': model.vendor }),
});

// source: https://docs.merge.dev/merge-gateway/warnings "detail.ignored_fields lists them."
// source: spec:responses_create "OpenAI-only field is ignored"
export function nativeWarnings(body: Row): Row[] | undefined {
  const ignored = ['background', 'include', 'max_tool_calls', 'metadata', 'prompt', 'prompt_cache_key', 'stream_options', 'truncation'].filter((key) => Object.hasOwn(body, key));
  return ignored.length ? [{ code: 'openai_fields_ignored', message: 'OpenAI-only fields with no native equivalent were ignored.', detail: { ignored_fields: ignored } }] : undefined;
}
