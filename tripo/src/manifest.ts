// Tripo's manifest: the vendor facts its spec (../spec, written from Tripo's Python SDK) does not carry. Served is
// what Volter Editor calls (../journeys/demand.json): the balance a connected key is tested by. An account
// and its key are the World's door.
// The declared surface is the pinned SDK's API, including task generation and both upload channels.
// source: https://raw.githubusercontent.com/VAST-AI-Research/tripo-python-sdk/4115894a0a603c5183c9ed6dc8662745562c8941/tripo3d/client.py "Create a task."
// source: https://raw.githubusercontent.com/VAST-AI-Research/tripo-python-sdk/4115894a0a603c5183c9ed6dc8662745562c8941/tripo3d/client_impl/aiohttp_client_impl.py "Upload a file to the API using aiohttp."
// source: https://raw.githubusercontent.com/VAST-AI-Research/tripo-python-sdk/4115894a0a603c5183c9ed6dc8662745562c8941/tripo3d/client_impl/legacy_client_impl.py "Implementation using raw sockets."
// source: https://raw.githubusercontent.com/VAST-AI-Research/tripo-python-sdk/4115894a0a603c5183c9ed6dc8662745562c8941/tripo3d/models.py "User balance data model."
// source: https://raw.githubusercontent.com/VAST-AI-Research/tripo-python-sdk/4115894a0a603c5183c9ed6dc8662745562c8941/docs/API.md "Get the user's account balance."
import type { DerivedManifest } from '@volter/world-core';

export const manifest: DerivedManifest = {
  vendor: 'tripo',
  service: 'tripo',
  body: { json: 'always' },
  // source: recording:unknown.json "application/json"
  jsonContentType: 'application/json',
  ids: { template: '{uuid}' },
  time: 'unix',
  // source: recording:bad-key.json "Authentication failed"
  error: { code: '{code}', message: '{message}', suggestion: 'Check if your credentials is valid, and ensure you set it correctly' },
  // source: recording:bad-key.json "Authentication failed"
  auth: {
    header: 'authorization', scheme: 'Bearer', gateWhenAbsent: true, invalidKeys: [],
    // source: recording:unknown.json "Authentication failed"
    missing: { status: 401, code: 1002, message: 'Authentication failed' },
    // source: recording:bad-key.json "Authentication failed"
    invalid: { status: 401, code: 1002, message: 'Authentication failed' },
    // source: recording:unknown.json "https://api.tripo3d.ai/v2/openapi/unknown-path"
    // The recorded protected-prefix unknown request also checks authentication before dispatch (spec/recordings/unknown.json).
    // source: spec:/security "bearer"
    // v3's bearer requirement is declared security, not a claimed v3 response recording.
    paths: '^/(?:v2/openapi|v3)(?:/|$)', beforeRouting: true,
  },
  // World policy, not a vendor error code: this API scope has no vendor write and documents no read-only refusal.
  readOnly: { status: 403, message: 'This World is read-only; writes are refused.' },
  // source: recording:gap.json "<title>404 Not Found</title>"
  // No stored vendor object can be requested in this scope. The front's observed unknown-path answer is the gap module.
  // Authenticated unknown paths are undocumented here; use the recorded front's HTTP 404 without inventing an API code.
  notFound: { status: 404, message: '404 Not Found' },
  list: { style: 'envelope', envelope: { code: 0, data: '{data}' }, limit: { param: 'limit', default: 20, max: 100 } },
  deleted: {},
  resources: {
    _api_key: { idPrefix: '', ids: '{uuid}' },
    _account: {
      idPrefix: '',
      refresh: { none: 'World-only account fixture; the balance API returns credits, never accounts or API keys.' },
    },
  },
  // These SDK-declared operations have no demanded application call or customer-life act.
  unmodeled: ['createTask', 'getTask', 'uploadFile', 'createUploadToken', 'uploadFileV3', 'getTaskV3', 'segmentMeshV3'],
  // source: spec:getBalance "Get the user's account balance."
  vendorBacked: { none: 'This scope only reads balance from World-only account fixtures. It models no vendor API writes, account enumeration or signed events; real account refresh is outside this pack.' },
  // No per-minute allowance is documented in the SDK sources used here: the procedure's conservative fallback.
  rateBudget: { windowMs: 60_000, ceiling: 30, defaultWeight: 1, reason: 'No documented allowance in the cited balance sources; fallback 30 requests per minute.' },
  doors: [
    // Twin-only choice: the published tsk_ prefix has a synthetic tail of 40 alphanumeric characters.
    { id: 'accounts', method: 'POST', path: '/_twin/accounts', note: '{ balance? }: a Tripo account with its credits, and its API key (tsk_…)' },
  ],
  discovery: {
    twinOf: "Tripo's API as Volter Editor tests a key: the account's balance",
    stores: 'accounts, their credits and their API keys (by their SHA-256)',
    identity: '`Authorization: Bearer tsk_…`',
  },
  descriptor: {
    protocol: '3',
    transport: 'rest',
    archetype: 'crud',
    bin: 'world-tripo',
    resources: [],
    specSource: "Tripo's official Python SDK 0.4.2 at 4115894a0a603c5183c9ed6dc8662745562c8941 (spec/SOURCE.md)",
    description: "Tripo twin — an account's balance, read with its API key, as Volter Editor tests a connected key.",
    // source: https://raw.githubusercontent.com/VAST-AI-Research/tripo-python-sdk/4115894a0a603c5183c9ed6dc8662745562c8941/tripo3d/client.py "TRIPO_API_KEY environment variable."
    adoption: { pypi: ['tripo3d'], envStems: ['TRIPO'] },
    // source: https://raw.githubusercontent.com/VAST-AI-Research/tripo-python-sdk/4115894a0a603c5183c9ed6dc8662745562c8941/README.md "The Tripo3d Python SDK is the official Python client library"
    clientCasesNone: 'The demanded editor uses fetch, not the official Python SDK; no SDK-specific behaviour is demanded (journeys/demand.json).',
    // source: spec:/servers "api.tripo3d.ai"
    // source: https://raw.githubusercontent.com/VAST-AI-Research/tripo-python-sdk/4115894a0a603c5183c9ed6dc8662745562c8941/tripo3d/client.py "https://api.tripo3d.com/v2/openapi"
    // source: https://raw.githubusercontent.com/VAST-AI-Research/tripo-python-sdk/4115894a0a603c5183c9ed6dc8662745562c8941/tripo3d/client.py "https://openapi.tripo3d.ai"
    // source: https://raw.githubusercontent.com/VAST-AI-Research/tripo-python-sdk/4115894a0a603c5183c9ed6dc8662745562c8941/tripo3d/client.py "https://openapi.tripo3d.com"
    hosts: [{ host: 'api.tripo3d.ai' }, { host: 'api.tripo3d.com' }, { host: 'openapi.tripo3d.ai', pathPattern: '^/v3(?:/|$)' }, { host: 'openapi.tripo3d.com', pathPattern: '^/v3(?:/|$)' }],
    endpointEnvNone: 'the editor calls api.tripo3d.ai; the World claims the host',
    credentialDoor: { account: { field: 'account', tenancy: 'Platform account', source: 'https://github.com/VAST-AI-Research/tripo-python-sdk/tree/4115894a0a603c5183c9ed6dc8662745562c8941' }, deployment: { field: 'deployment', object: 'API key', source: 'https://github.com/VAST-AI-Research/tripo-python-sdk/tree/4115894a0a603c5183c9ed6dc8662745562c8941' },  path: '/_twin/accounts', body: { balance: 3000 }, fill: { TRIPO_API_KEY: 'api_key' } },
  },
};
