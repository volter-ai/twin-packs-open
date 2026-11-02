// Vercel AI Gateway's manifest: the vendor facts its spec (../spec, written from its docs and SDK) does not carry. Served
// is what the applications call (../journeys/demand.json): the models, chat completions, and the AI SDK's language-model
// call; every other operation is `unmodeled`.
//
// THE TWIN RUNS NO MODEL. A turn is the World's scenario's when it scripts one (./semantics/scenario.ts), else the
// labeled stub of the kernel's wire (openaiWire), whose shapes the answers are.
import type { DerivedManifest } from '@volter/world-core';
import { states } from './semantics/states.ts';

export const manifest: DerivedManifest = {
  vendor: 'ai-gateway',
  service: 'ai-gateway',
  body: { json: 'always' },
  ids: { template: '{uuid}' },
  time: 'unix',
  // source: spec:/components/schemas/Error "The error body"
  error: { error: { message: '{message}', type: '{kind}', param: null, code: '{code}' } },
  defaultKind: 'invalid_request_error',
  readOnly: { status: 403, message: 'This twin was started read-only; writes are refused.' },
  notFound: { status: 404, message: 'Not Found' },
  gap: { status: 404, message: 'Not Found' },
  list: { style: 'envelope', envelope: { object: 'list', data: '{data}' }, limit: { param: 'limit', default: 100, max: 1000 } },
  deleted: {},
  resources: {
    _api_key: { ...states._api_key, idPrefix: 'key_', ids: '{prefix}{n}' },
    _generation: { ...states._generation, idPrefix: '', ids: '{letters:16}' },
    _call: { ...states._call, idPrefix: '', ids: '{letters:24}' },
  },
  unmodeled: ['retrieveModel', 'createEmbedding', 'embeddingModel', 'availableModels', 'credits'],
  vendorBacked: { none: 'The served inference calls are stateless compute and the catalogue is a recorded lookup. Issued keys and call ids are World bookkeeping, not vendor-stored API resources.' },
  // source: spec:listModels "Too Many Requests: rate limit exceeded"
  // The vendored reference gives no numeric per-minute allowance; use the platform fallback.
  rateBudget: { reason: 'No per-minute allowance is documented in the vendored reference; fallback 30 calls per minute.', windowMs: 60_000, ceiling: 30, defaultWeight: 1, maxRetryAfterSeconds: 60 },
  doors: [
    { id: 'appCredentials', method: 'POST', path: '/_twin/app-credentials', note: "the World application's key, as the runtime issues it" },
  ],
  // the key the World issued, sent as a bearer (its hash held: `_api_key`); none, or one it did not issue, is the 401
  // source: spec:/components/securitySchemes/bearer "An AI Gateway API key, or a Vercel OIDC token"
  auth: {
    header: 'authorization', scheme: 'Bearer', gateWhenAbsent: true, beforeRouting: true, invalidKeys: [],
    missing: { status: 401, kind: 'authentication_error', code: 'unauthorized', message: 'Authentication failed' },
    invalid: { status: 401, kind: 'authentication_error', code: 'unauthorized', message: 'Authentication failed' },
    held: { storedAs: '_api_key', hashField: 'sha256' },
  },
  discovery: {
    twinOf: "Vercel's AI Gateway (ai-gateway.vercel.sh): its model catalogue, OpenAI's chat completions at /v1, and the AI SDK's language-model and evaluation-model calls at /v4/ai",
    stores: 'API keys (by their SHA-256)',
    behavior: "a turn is the scenario's (on: modelEquals, userTextIncludes, anyTextIncludes, lastMessageIsToolResult, toolResultFor, hasTool; respond: text, toolCalls, reasoning, finishReason), else a labeled stub",
  },
  descriptor: {
    protocol: '3',
    transport: 'rest',
    archetype: 'crud',
    bin: 'world-ai-gateway',
    resources: [],
    specSource: "written from Vercel's AI Gateway docs and the @ai-sdk/gateway source (spec/openapi.json)",
    description: "Vercel AI Gateway twin — its recorded model catalogue, OpenAI's chat completions and the AI SDK's language-model and evaluation protocol (streamed and not; tools, JSON output) on the World's scenario or the kernel wire's labeled stub; API keys.",
    // the `ai` package is not a signal: an application on an explicit provider (@ai-sdk/openai) carries it and never
    // calls the gateway; one whose string model ids reach the gateway sets AI_GATEWAY_API_KEY
    adoption: { sdks: ['@ai-sdk/gateway'], envStems: ['AI_GATEWAY'] },
    hosts: [{ host: 'ai-gateway.vercel.sh' }],
    endpointEnvNone: '@ai-sdk/gateway calls https://ai-gateway.vercel.sh/v4/ai and an OpenAI client is given https://ai-gateway.vercel.sh/v1 in code; the World claims the host',
    credentialDoor: { account: { field: 'account' }, path: '/_twin/app-credentials', body: {}, fill: { AI_GATEWAY_API_KEY: 'api_key' } },
  },
};
