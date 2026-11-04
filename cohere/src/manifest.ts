// Cohere's manifest: the vendor facts its spec (../spec) does not carry. Served is what the applications call
// (../journeys/demand.json): rerank (v2), the shipped LibreChat web-search life; other operations answer the gap.
//
// THE TWIN RUNS NO MODEL: a document's relevance is its lexical overlap with the query (./semantics/rerank.ts).
import type { DerivedManifest } from '@volter/world-core';

export const manifest: DerivedManifest = {
  vendor: 'cohere',
  service: 'cohere',
  body: { json: 'always' },
  ids: { template: '{uuid}' },
  time: 'iso',
  // source: spec:/components/responses/BadRequest "This error is returned when the request is not well formed."
  error: { id: '{id}', message: '{message}' },
  readOnly: { status: 403, message: 'This twin was started read-only; writes are refused.' },
  // source: https://docs.cohere.com/v2/reference/errors "404 page not found"
  notFound: { status: 404, message: '404 page not found' },
  // source: https://docs.cohere.com/v2/reference/errors "401 responses are sent when the API key is missing, invalid or has expired."
  // Where documentation stops: the error page does not establish missing-key versus unknown-route precedence; the gap stands.
  gap: { status: 404, message: '404 page not found' },
  deleted: {},
  resources: {
    _organization: { idPrefix: '', ids: '{uuid}' },
    _owner: { idPrefix: '', ids: '{uuid}', unique: [{ fields: ['email'], refusal: { status: 409, message: 'Owner already exists' } }] },
    _api_key: { idPrefix: 'key_', ids: '{prefix}{n}' },
  },
  unmodeled: ["chat", "checkAPIKey", "classify", "list-connectors", "create-connector", "get-connector", "update-connector", "delete-connector", "oAuthAuthorize-connector", "list-datasets", "create-dataset", "get-dataset", "delete-dataset", "get-dataset-usage", "detokenize", "embed", "list-embed-jobs", "create-embed-job", "get-embed-job", "cancel-embed-job", "ListFinetunedModels", "CreateFinetunedModel", "ListEvents", "ListTrainingStepMetrics", "GetFinetunedModel", "UpdateFinetunedModel", "DeleteFinetunedModel", "generate", "list-models", "get-model", "rerank", "summarize", "tokenize", "create-transcription", "ListBatches", "CreateBatch", "GetBatch", "CancelBatch", "chatv2", "embedv2", "parsev2"],
  doors: [
    { id: 'appCredentials', method: 'POST', path: '/_twin/app-credentials', note: "the World application's key, as the runtime issues it" },
  ],
  // source: https://docs.cohere.com/v2/reference/rerank "Bearer authentication of the form Bearer <token>"
  // source: https://docs.cohere.com/v2/reference/errors "401 responses are sent when the API key is missing, invalid or has expired."
  auth: {
    header: 'authorization', scheme: 'Bearer', gateWhenAbsent: true, beforeRouting: true, invalidKeys: [],
    missing: { status: 401, message: 'no api key supplied' },
    invalid: { status: 401, message: 'invalid api token' },
    held: { storedAs: '_api_key', hashField: 'sha256', unless: 'revoked' },
  },
  // source: https://docs.cohere.com/docs/rate-limits "Rerank 10 req / min 1,000 req / min"
  rateBudget: { windowMs: 60000, ceiling: 10, defaultWeight: 1, allowance: { perMinute: 10, source: 'https://docs.cohere.com/docs/rate-limits' }, reason: 'Rerank trial keys allow 10 requests per minute; use that lower published tier.' },
  vendorBacked: { none: 'Rerank computes scores without storing vendor resources; _api_key is World credential bookkeeping.' },
  discovery: {
    twinOf: "Cohere's API (api.cohere.com): rerank",
    stores: 'API keys (by their SHA-256)',
    behavior: "a document's relevance is its lexical overlap with the query, labeled in the answer's meta; no model runs",
  },
  descriptor: {
    protocol: '3',
    transport: 'rest',
    archetype: 'crud',
    bin: 'world-cohere',
    resources: [],
    specSource: "Cohere's OpenAPI document (spec/openapi.yaml.gz)",
    description: "Cohere twin — rerank (v2) by lexical overlap with the query, labeled (no model runs); dashboard API keys.",
    // source: spec:rerankv2 "cohere-ai"
    // source: https://ai-sdk.dev/providers/ai-sdk-providers/cohere "The Cohere provider is available in the @ai-sdk/cohere module."
    // source: https://docs.cohere.com/docs/get-started-installation "pip install -U cohere"
    // source: https://docs.cohere.com/docs/rerank-overview.md "CO_API_KEY"
    adoption: { sdks: ['@ai-sdk/cohere', 'cohere-ai'], pypi: ['cohere'], envStems: ['CO', 'COHERE'] },
    // source: spec:rerankv2 "This endpoint takes in a query and a list of texts"
    hosts: [{ host: 'api.cohere.com' }, { host: 'api.cohere.ai' }],
    // source: https://unpkg.com/@librechat/agents@4.0.1/src/tools/search/rerankers.ts "process.env.COHERE_API_URL"
    endpointEnv: { name: 'COHERE_API_URL', templates: { COHERE_API_URL: '${url}/v2/rerank' }, note: 'The pinned LibreChat CohereReranker reads this full request URL; retain its /v2/rerank suffix.' },
    // source: https://unpkg.com/@librechat/agents@4.0.1/src/tools/search/rerankers.ts "import axios from"
    clientCasesNone: 'LibreChat uses axios in @librechat/agents@4.0.1 CohereReranker, not the official cohere-ai SDK; no official SDK behavior is relied on.',
    credentialDoor: { account: { field: 'account', tenancy: 'Organization', source: 'https://docs.cohere.com/docs/rate-limits' }, deployment: { field: 'deployment', object: 'API key', source: 'https://docs.cohere.com/docs/rate-limits' },  path: '/_twin/app-credentials', body: {}, fill: { COHERE_API_KEY: 'api_key' } },
  },
};
