// OpenRouter's manifest: the vendor facts its spec (../spec: OpenRouter's own OpenAPI document) does not carry. Served is
// what the applications call (../journeys/demand.json): a turn on chat completions, the Responses API and Anthropic's
// Messages, streamed and not; the key a request is made with (GET /key); the model catalogue; and the PKCE exchange of
// a code for a key, with the /auth page a person approves an application on (a screen). Every other operation is
// `unmodeled`.
//
// THE TWIN RUNS NO MODEL. A turn is the World's scenario's when it scripts one (./semantics/scenario.ts), else the
// labeled deterministic stub of the kernel's wires (openaiWire, anthropicWire).
import type { DerivedManifest } from '@volter/world-core';
import { states } from './semantics/states.ts';

export const manifest: DerivedManifest = {
  vendor: 'openrouter',
  service: 'openrouter',
  body: { json: 'always' },
  ids: { template: '{uuid}' },
  time: 'unix',
  // OpenRouter's error body: `{error: {code, message, metadata?}}` (docs/api/reference/errors-and-debugging)
  error: { error: { code: '{status}', message: '{message}' } },
  readOnly: { status: 403, message: 'This twin was started read-only; writes are refused.' },
  notFound: { status: 404, message: 'Not Found' },
  gap: { status: 404, message: 'Not Found' },
  // source: https://openrouter.ai/docs/guides/overview/auth/oauth "using POST and HTTPS for your request"
  wrongMethod: { status: 405, message: 'Method Not Allowed' },
  list: { style: 'envelope', envelope: { data: '{data}' }, limit: { param: 'limit', default: 100, max: 100 } },
  deleted: {},
  resources: {
    // a person who signs in at openrouter.ai (the users door): the API this pack's spec holds reads no person back
    user: { unique: [{ fields: ['email'], refusal: { status: 409, message: 'User already exists' } }], idPrefix: 'user_', ids: '{prefix}{letters:24}', refresh: { none: "a person is openrouter.ai's account, made by signing in: no operation of the API reads one back (organization members are a management key's, outside what our applications call)" } },
    _serial: { idPrefix: '', ids: '{n}', refresh: { none: "the World's own counter" } },
    _api_key: { idPrefix: 'key_', ids: '{prefix}{n}', refresh: { none: "a key's secret is shown once and never read back; listing keys is the management API's (GET /keys), outside what our applications call" } },
    _auth_code: { ...states._auth_code, idPrefix: '', refresh: { none: 'an authorization code lives ten minutes and is spent by its exchange: nothing reads one back' } },
    _generation: { idPrefix: '', ids: '{letters:20}', refresh: { none: 'a turn is answered, not stored: nothing lists the generations a key made' } },
    _call: { idPrefix: '', ids: '{letters:24}', refresh: { none: 'a turn is answered, not stored' } },
  },
  unmodeled: ["getUserActivity", "getAnalyticsMeta", "queryAnalytics", "createApiAlphaDecisions", "createAudioSpeech", "createAudioTranscriptions", "createAuthKeysCode", "listBatches", "createBatches", "getBatches", "deleteBatch", "getBenchmarks", "listBYOKKeys", "createBYOKKey", "getBYOKKey", "updateBYOKKey", "deleteBYOKKey", "getTaskClassifications", "listContainerFiles", "getContainerFile", "downloadContainerFileContent", "promoteContainerFile", "getCredits", "createCoinbaseCharge", "getAppRankings", "getRankingsDaily", "getSessionCost", "createEmbeddings", "listEmbeddingsModels", "listEndpointsZdr", "listFiles", "uploadFile", "getFileMetadata", "deleteFile", "downloadFileContent", "getGeneration", "listGenerationContent", "submitGenerationFeedback", "listGuardrails", "createGuardrail", "getGuardrail", "updateGuardrail", "deleteGuardrail", "listGuardrailKeyAssignments", "bulkAssignKeysToGuardrail", "bulkUnassignKeysFromGuardrail", "listGuardrailMemberAssignments", "bulkAssignMembersToGuardrail", "bulkUnassignMembersFromGuardrail", "listKeyAssignments", "listMemberAssignments", "createImages", "listImageModels", "listImageModelEndpoints", "listInterns", "createIntern", "getIntern", "updateIntern", "deleteIntern", "createInternChatCompletion", "getInternDaemon", "getInternDaemonAccess", "invokeIntern", "provisionIntern", "suspendIntern", "list", "createKeys", "getKey", "updateKeys", "deleteKeys", "getModel", "listEndpoints", "listModelsCount", "listModelsUser", "listOauthJwks", "createOauthToken", "listObservabilityDestinations", "createObservabilityDestination", "getObservabilityDestination", "updateObservabilityDestination", "deleteObservabilityDestination", "listOrganizationMembers", "listPresets", "getPreset", "createPresetsChatCompletions", "createPresetsMessages", "createPresetsResponses", "listPresetVersions", "getPresetVersion", "listPrivateEndpoints", "createPrivateEndpoint", "getPrivateEndpoint", "updatePrivateEndpoint", "deletePrivateEndpoint", "activatePrivateEndpoint", "disablePrivateEndpoint", "enablePrivateEndpoint", "updatePrivateEndpointPricing", "validatePrivateEndpoint", "listProviders", "createRerank", "listScimGroupMappings", "createScimGroupMapping", "getScimGroupMapping", "updateScimGroupMapping", "deleteScimGroupMapping", "listScimGroups", "createScimSyncJob", "getScimSyncJob", "createSystemone", "listTools", "getTool", "listInternEffectiveVaultSecrets", "listInternVaultSecrets", "storeInternVaultSecret", "deleteInternVaultSecret", "copyVaultSecretsToIntern", "listVaultSecrets", "storeVaultSecret", "deleteVaultSecret", "createVideos", "getVideos", "listVideosContent", "listVideosModels", "listWorkspaces", "createWorkspace", "getWorkspace", "updateWorkspace", "deleteWorkspace", "listWorkspaceMembers", "bulkAddWorkspaceMembers", "bulkRemoveWorkspaceMembers", "listWorkspaceBudgets", "getWorkspaceBudget", "upsertWorkspaceBudget", "deleteWorkspaceBudget"],
  vendorBacked: { none: 'Inference is stateless compute. Keys and account identities are local stand-ins for dashboard flows; no served operation writes a resource the vendor stores through its API.' },
  // source: spec:/components/schemas/UnauthorizedResponse "Missing Authentication header"
  // OpenRouter sends the application no webhooks: its observability destinations receive traces, not events about
  // stored resources, so there is nothing to ingest.
  // OpenRouter documents no per-minute allowance for paid models: its platform limits are the free variants' (a
  // per-minute and a per-day count the limits page renders from a template) and Cloudflare's DDoS protection. With no
  // documented per-minute allowance the window holds a loop to the platform's fallback, 30 calls a minute.
  // source: https://openrouter.ai/docs/api_reference/limits "Rate limits govern how many requests you can make. There are a few rate limits that apply to certain types of requests, regardless of account status:"
  // source: https://openrouter.ai/docs/api_reference/limits "will block requests that dramatically exceed reasonable usage."
  rateBudget: {
    reason: "OpenRouter documents no per-minute allowance for paid models (https://openrouter.ai/docs/api_reference/limits: its limits are the free variants' per-minute and per-day counts and Cloudflare's DDoS protection; a 429 carries error.metadata). With no documented per-minute allowance the window holds a loop to the platform's fallback, 30 calls a minute.",
    windowMs: 60_000, ceiling: 30, defaultWeight: 1, maxRetryAfterSeconds: 60,
  },
  // openrouter.ai's /auth page (./screens/auth.ts): a person approves an application, and it is sent back with a code
  screens: [{
    id: 'auth', kind: 'flow', host: 'openrouter.ai', path: '/auth',
    demand: 'an application that connects a person\'s OpenRouter account (browser-substrate\'s vibecode) sends them here to approve it', status: 'done',
    controls: ['Authorize'], source: 'https://openrouter.ai/docs/guides/overview/auth/oauth',
  }],
  // the World's doors (./semantics/doors.ts): what openrouter.ai's pages do
  doors: [
    { id: 'appCredentials', method: 'POST', path: '/_twin/app-credentials', note: "the World application's key, as the runtime issues it" },
    { id: 'users', method: 'POST', path: '/_twin/users', note: 'a person who signs in at openrouter.ai' },
    { id: 'keys', method: 'POST', path: '/_twin/keys', note: 'a key of theirs, shown once (Settings > Keys > Create Key)' },
  ],
  // browser-substrate's vibecode exchanges its code from the browser
  cors: { origin: '*', methods: 'GET, POST, OPTIONS', headers: 'authorization, content-type, http-referer, x-title', maxAge: 3600 },
  // the key the World issued, sent as a bearer to the API's paths but the key exchange's, the catalogue's (it needs none)
  // with the Messages skin's error wire selected by the kernel; its hash held as
  // `_api_key`, a disabled one not
  auth: {
    header: 'authorization', scheme: 'Bearer', paths: '^/api/v1/(?!auth/keys$|models$)', gateWhenAbsent: true, beforeRouting: true, invalidKeys: [],
    missing: { status: 401, message: 'No auth credentials found' },
    invalid: { status: 401, message: 'User not found.' },
    held: { storedAs: '_api_key', hashField: 'sha256', unless: 'disabled' },
    // source: https://openrouter.ai/docs/api_reference/errors-and-debugging "the canonical error_type is added inside the error object alongside it"
    wires: [{ paths: '^/api/v1/messages$', error: { type: 'error', error: { type: 'authentication_error', error_type: 'authentication', message: '{message}' }, request_id: null },
      missing: { status: 401, message: 'Invalid API key' }, invalid: { status: 401, message: 'Invalid API key' } }],
  },
  discovery: {
    twinOf: "OpenRouter (openrouter.ai/api/v1): a turn on chat completions, the Responses API and Anthropic's Messages, streamed and not (tools, reasoning, structured output); the current key; the model catalogue; and OAuth PKCE's key exchange with its /auth page",
    stores: 'people, API keys (by their SHA-256) and authorization codes (by their SHA-256)',
    behavior: 'a turn is the scenario\'s (on: modelEquals, userTextIncludes, anyTextIncludes, lastMessageIsToolResult, toolResultFor, hasTool; respond: text, toolCalls, reasoning, finishReason), else a labeled stub',
    exampleHandler: { on: { userTextIncludes: 'summarize the deploy' }, respond: { text: 'Deploy 412 shipped the new billing page.' } },
  },
  descriptor: {
    protocol: '3',
    transport: 'rest',
    archetype: 'generative',
    bin: 'world-openrouter',
    resources: ['user'],
    specSource: "OpenRouter's OpenAPI document (spec/openapi.json.gz, fetched 2026-09-30 from openrouter.ai/openapi.json)",
    description: "OpenRouter twin — a turn on chat completions (streamed as its SSE with keep-alives and a final usage chunk, or whole; tools, reasoning, structured output), the Responses API and Anthropic's Messages, on the World's scenario or a labeled stub; the current key (GET /key); the model catalogue with its prices; and OAuth PKCE (the /auth page and the key exchange); keys made on Settings > Keys.",
    adoption: { sdks: ['@openrouter/sdk', '@openrouter/ai-sdk-provider'], envStems: ['OPENROUTER'] },
    hosts: [{ host: 'openrouter.ai' }],
    endpointEnvNone: 'the SDKs call https://openrouter.ai/api/v1 unless given a base URL in code; the World claims the host',
    credentialDoor: { account: { field: 'account', tenancy: 'User account', source: 'https://openrouter.ai/docs/guides/overview/auth/provisioning-api-keys' }, deployment: { field: 'deployment', object: 'Named API key with spending limit', source: 'https://openrouter.ai/docs/guides/overview/auth/provisioning-api-keys' },  path: '/_twin/app-credentials', body: {}, fill: { OPENROUTER_API_KEY: 'api_key' } },
  },
};
