// Merge Gateway's manifest: the vendor facts its spec (../spec, Gateway's own document) does not carry. Served is what
// our products call (../journeys/demand.json): Open Autonomy's model rail (and through it RH2's, Volter Harness's and
// Substrate's workers) and Volter Editor's Pi in Substrate: a turn on OpenAI's chat completions, Gateway's native
// Responses and Anthropic's Messages, each priced and drawn from the organization's credit, and the model catalogue;
// every other operation is `unmodeled`.
//
// THE TWIN RUNS NO MODEL. A turn is the World's scenario's when it scripts one (./semantics/scenario.ts), else the
// labeled stub of the kernel's wires (openaiWire, anthropicWire), whose shapes the answers are.
import type { DerivedManifest } from '@volter/world-core';

export const manifest: DerivedManifest = {
  vendor: 'merge',
  service: 'merge',
  // source: https://docs.merge.dev/merge-gateway/errors "Schema validation failures on native"
  body: { json: 'always', validation: {
    operations: ['responses_create'], status: 422,
    missing: { detail: [{ type: 'missing', loc: ['body', '{name}'], msg: 'Field required', input: '{input}' }] },
    type: { detail: [{ type: '{type}_type', loc: ['body', '{name}'], msg: 'Input should be a valid {type}', input: '{input}' }] },
    range: { detail: [{ type: 'value_error', loc: ['body', '{name}'], msg: 'Input is outside the permitted range', input: '{input}' }] },
  } },
  vendorBacked: { none: 'Model calls are answered rather than stored; organizations, API keys and charge records are World bookkeeping under _ types, not vendor resources this model API refreshes or deploys.' },
  ids: { template: '{uuid}' },
  time: 'iso',
  // source: https://docs.merge.dev/merge-gateway/errors "Gateway errors carry a stable"
  error: { error: { type: '{kind}', message: '{message}', code: '{code}', param: '{param}', source: 'gateway', provider: null } },
  defaultKind: 'invalid_request_error',
  readOnly: { status: 403, code: 'read_only', message: 'This twin was started read-only; writes are refused.' },
  notFound: { status: 404, code: 'not_found', kind: 'not_found_error', message: 'Not Found' },
  gap: { status: 404, code: 'not_found', kind: 'not_found_error', message: 'Not Found' },
  list: { style: 'envelope', envelope: { object: 'list', data: '{data}' }, limit: { param: 'limit', default: 100, max: 1000 } },
  deleted: {},
  // Gateway's stored state is the World's bookkeeping: nothing a perform sends, and nothing its API reads back
  resources: {
    _organization: { idPrefix: '', refresh: { none: "an organization, its credit and its provider access are the dashboard's (billing settings, support's grant): the model API this pack's spec holds reads none of them back" } },
    _api_key: { idPrefix: '', refresh: { none: "keys are the Management API's (/v1/keys), outside the model API this pack's spec holds" } },
    // each turn's call, issued (ctx.issue): its ids follow from it
    _call: { idPrefix: '', refresh: { none: 'a model call is answered, not stored: nothing lists the calls an organization made' } },
  },
  unmodeled: ["audio_speech", "audio_transcribe", "batches_list", "batches_create", "batches_retrieve", "batches_delete", "batches_cancel", "batches_results", "decisions_create", "embeddings_create", "images_edit", "images_generate", "messages_countTokens", "models_retrieve", "models_listDiscounted", "responses_retrieve", "responses_delete", "routing_listPolicies", "routing_listStrategies", "tags_list", "vendors_list", "vendors_retrieve", "videos_list", "videos_create", "videos_retrieve", "videos_delete", "videos_content"],
  // Gateway sends no webhooks: a budget alert is an email to the budget's recipients
  // source: https://docs.merge.dev/merge-gateway/cost/budgets "Alerts go to the budget"
  // Paid plans have no request rate limit and Gateway publishes no per-minute allowance for them; the Free plan's cap is
  // 15 requests a day, and a key's optional rate_limit_rpm is a customer key's. The window holds a loop to the
  // platform's fallback, 30 calls a minute.
  // source: https://docs.merge.dev/merge-gateway/rate-limits "Paid organizations get no request or token rate limits by default"
  rateBudget: {
    reason: "Merge Gateway sets no request or token rate limit on paid plans and publishes no per-minute allowance (https://docs.merge.dev/merge-gateway/rate-limits: the Free plan is capped at 15 requests a UTC day, GET requests not counted; a customer key's optional rate_limit_rpm is answered 429 with Retry-After). With no documented per-minute allowance the window holds a loop to the platform's fallback, 30 calls a minute.",
    windowMs: 60_000, ceiling: 30, defaultWeight: 1, maxRetryAfterSeconds: 60,
  },
  doors: [
    { id: 'organizations', method: 'POST', path: '/_twin/organizations', note: "{ name?, credit_usd?, access? }: an organization on the Pro plan, made at the World's clock, with its prepaid credit (10 when unsaid), the gated providers support has granted it (['anthropic']), and its API key (mg_…)" },
    { id: 'access', method: 'POST', path: '/_twin/access', note: '{ organization_id, provider }: support grants a gated provider (anthropic) to the organization, as the in-app chat or support@merge.dev does' },
  ],
  discovery: {
    twinOf: "Merge's Gateway (api-gateway.merge.dev) as Open Autonomy's model rail and Volter Editor's Pi call it: a turn on OpenAI's chat completions, Gateway's native Responses and Anthropic's Messages, priced and drawn from the organization's credit, and the model catalogue (GET /v1/models)",
    stores: "organizations, their credit, spend and provider access, and their API keys (by their SHA-256)",
    behavior: "a turn is the scenario's (on: modelEquals, userTextIncludes, anyTextIncludes, lastMessageIsToolResult, toolResultFor, hasTool; respond: text, toolCalls, reasoning, finishReason), else a labeled stub",
    identity: '`Authorization: Bearer mg_…` or `X-API-Key`',
  },
  descriptor: {
    protocol: '3',
    transport: 'rest',
    archetype: 'crud',
    bin: 'world-merge',
    resources: [],
    specSource: "Merge Gateway's OpenAPI document (spec/SOURCE.md)",
    description: "Merge Gateway twin — a turn on OpenAI's chat completions, Gateway's native Responses and Anthropic's Messages (a scripted scenario's, else a labeled stub; no model runs), each priced at the catalogue's per-token prices with Merge's fee and drawn from the organization's credit, a gated provider refused to an organization without access, and the catalogue paged by cursor, as Open Autonomy's model rail forwards its agents' calls and Volter Editor's Pi calls it.",
    adoption: { sdks: [], envStems: ['MERGE_GATEWAY', 'MODEL_GATEWAY'] },
    hosts: [{ host: 'api-gateway.merge.dev' }],
    endpointEnvNone: 'Open Autonomy reads MODEL_GATEWAY_URL and defaults to api-gateway.merge.dev; the World claims the host',
    credentialDoor: { account: { field: 'account' }, path: '/_twin/organizations', body: {}, fill: { MODEL_GATEWAY_API_KEY: 'api_key', MERGE_GATEWAY_API_KEY: 'api_key' } },
  },
};
