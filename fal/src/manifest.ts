// fal's manifest: the vendor facts its spec (../spec: fal-ai/ideogram/v2's queue document) does not carry. Served is what
// the applications call (../journeys/demand.json): fal-ai/ideogram/v2, directly on fal.run; the queue is `unmodeled`.
//
// THE TWIN RUNS NO MODEL: an image is the kernel's labeled placeholder PNG (placeholderPng), served at the twin's media
// URL.
import type { DerivedManifest } from '@volter/world-core';

export const manifest: DerivedManifest = {
  vendor: 'fal',
  service: 'fal',
  // source: https://fal.ai/docs/documentation/model-apis/errors.md "This error indicates that a required input field was not provided."
  // Exact legacy-endpoint type-error wording is not published; use the documented value_error class.
  tenant: { field: '_tenant_scope', storage: 'namespaced' },
  body: { json: 'always', validation: { operations: ['post_fal_ai_ideogram_v2'], status: 422,
    missing: { detail: [{ loc: ['body', '{name}'], msg: 'Field required', type: 'missing', url: 'https://docs.fal.ai/errors#missing' }] },
    type: { detail: [{ loc: ['body', '{name}'], msg: 'Invalid input type; expected {type}', type: 'value_error', url: 'https://docs.fal.ai/errors#value_error' }] },
    range: { detail: [{ loc: ['body', '{name}'], msg: 'Input outside allowed range', type: 'value_error', url: 'https://docs.fal.ai/errors#value_error' }] },
  } },
  ids: { template: '{uuid}' },
  time: 'iso',
  error: { detail: '{message}' },
  readOnly: { status: 403, message: 'This twin was started read-only; writes are refused.' },
  notFound: { status: 404, message: 'Not Found' },
  gap: { status: 404, message: 'Not Found' },
  list: { style: 'envelope', envelope: { items: '{data}' }, limit: { param: 'limit', default: 10, max: 100 } },
  deleted: {},
  resources: {
    _account: { idPrefix: '', ids: '{uuid}', shared: true },
    _image: { idPrefix: '', ids: '{letters:21}' },
    _api_key: { idPrefix: 'key_', ids: '{prefix}{n}' },
  },
  // Model computation stores only private call artifacts, not vendor records.
  vendorBacked: { none: 'Direct model calls answer generated media; only World-private key hashes and placeholder blobs are retained.' },
  // source: https://fal.ai/docs/api-reference/platform-apis/openapi-schema.md "https://api.fal.ai/v1"
  lanes: { routes: [{ lane: 'platform', host: '^api\\.fal\\.ai$' }] },
  unmodeled: ['get_fal_ai_ideogram_v2_requests_request_id', 'get_fal_ai_ideogram_v2_requests_request_id_status', 'put_fal_ai_ideogram_v2_requests_request_id_cancel'],
  doors: [
    { id: 'appCredentials', method: 'POST', path: '/_twin/app-credentials', note: "the World application's key, as the runtime issues it" },
    { id: 'media', method: 'GET', path: '/_twin/media/{name}', note: 'an image a model answered, by the URL it gave' },
  ],
  // source: https://fal.ai/docs/documentation/model-apis/overview.md "Authorization: Key $FAL_KEY"
  // the key the World issued, sent as `Authorization: Key <key>` (its hash held: `_api_key`)
  auth: {
    header: 'authorization', scheme: 'Key', gateWhenAbsent: true, beforeRouting: true, invalidKeys: [],
    missing: { status: 401, message: 'No authentication provided' },
    invalid: { status: 401, message: 'Invalid Key' },
    held: { storedAs: '_api_key', hashField: 'sha256' },
  },
  discovery: {
    twinOf: 'fal direct Ideogram and Platform pricing APIs',
    stores: 'World-private key hashes and placeholder media blobs',
    behavior: 'Model output is a labeled deterministic placeholder PNG; no model runs. Platform pricing uses a documented fixture or World scenario; its lane discovery and match counts are under lanes.',
  },
  descriptor: {
    protocol: '3',
    transport: 'rest',
    archetype: 'generative',
    bin: 'world-fal',
    resources: [],
    specSource: "fal's OpenAPI document for fal-ai/ideogram/v2 (spec/openapi.json)",
    description: 'fal direct Ideogram placeholder images and Platform pricing, with shared World credentials.',
    adoption: { sdks: ['@fal-ai/client'], envStems: ['FAL'] },
    clientCasesNone: 'The demanded application does not use @fal-ai/client: Volter Editor checks a key with fetch and Authorization: Key (packages/editor-core/server/provider-credentials.ts:27, b86dde8c); no official SDK behavior is relied on.',
    // source: https://fal.ai/docs/documentation/model-apis/overview.md "fal.run"
    // source: https://fal.ai/docs/api-reference/platform-apis/openapi-schema.md "https://api.fal.ai/v1"
    hosts: [{ host: 'fal.run' }, { host: 'api.fal.ai' }],
    endpointEnvNone: 'the customer life calls https://fal.run/fal-ai/<model>; the World claims the hosts',
    credentialDoor: { account: { field: 'account', tenancy: 'user/team account', source: 'https://fal.ai/docs/api-reference/platform-apis/authentication.md' }, deployment: { field: 'deployment', object: 'model-restricted API key', source: 'https://fal.ai/docs/documentation/model-apis/authentication/key-based.md' }, path: '/_twin/app-credentials', body: {}, fill: { FAL_KEY: 'api_key' } },
  },
};
