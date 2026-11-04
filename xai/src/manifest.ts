// xAI's manifest: the vendor facts its spec (../spec: xAI's own OpenAPI document) does not carry. Served is what the
// applications call (../journeys/demand.json): chat completions and responses; every other operation is `unmodeled`.
//
// THE TWIN RUNS NO MODEL. A turn is the World's scenario's when it scripts one (../journeys/scenario.json), else the
// labeled stub of the kernel's OpenAI-compatible wire (openaiWire), whose shapes the answers are.
import type { DerivedManifest } from '@volter/world-core';


export const manifest: DerivedManifest = {
  vendor: 'xai',
  service: 'xai',
  body: { json: 'always' },
  ids: { template: '{uuid}' },
  time: 'unix',
  // Documentation names HTTP classes, not stable error-body messages; preserve the existing xAI {code,error} envelope.
  error: { code: '{code}', error: '{message}' },
  readOnly: { status: 403, message: 'This twin was started read-only; writes are refused.', code: 'Permission denied' },
  notFound: { status: 404, message: 'Not found', code: 'Some requested entity was not found' },
  // source: https://docs.x.ai/developers/debugging.md "Check your request body and endpoint URL against the"
  gap: { status: 404, message: 'Not found', code: 'Some requested entity was not found' },
  // source: https://docs.x.ai/developers/debugging.md "The request method is not allowed."
  wrongMethod: { status: 405, message: 'Method not allowed', code: 'Method not allowed' },
  rateBudget: { windowMs: 60000, ceiling: 30, defaultWeight: 1, reason: 'Fallback: no single account-independent request allowance is stated by the cited API references.' },
  list: { style: 'envelope', envelope: { data: '{data}' }, limit: { param: 'limit', default: 100, max: 100 } },
  deleted: {},
  resources: {
    _team: { idPrefix: '', ids: '{uuid}' },
    _user: { idPrefix: '', ids: '{uuid}', unique: [{ fields: ['email'], refusal: { status: 409, message: 'User already exists' } }] },
    _api_key: { idPrefix: '', ids: '{uuid}', refresh: { none: 'The served inference API does not list management API-key records.' } },
    _completion: { idPrefix: '', ids: '{letters:16}', refresh: { none: 'World-only issued completion identities; Chat Completions answers prompts, not a list of these private identifiers' } },
    _response: { idPrefix: '', ids: '{letters:16}', refresh: { none: 'World-only issued response and item identities; stored Responses retrieval and continuation are outside this scope' } },
  },
  // source: spec:handle_generic_model_request "Generates a response based on text or image prompts."
  vendorBacked: { none: 'This scope generates Chat Completions and Responses from prompts as scripted turns or labelled stubs. It serves no stored-response retrieval, continuation, or vendor-signed events; inference is never performed against xAI.' },
  unmodeled: [
      "handle_get_api_key_info_request",
      "handle_get_deferred_completion_request",
      "handle_generic_complete_request",
      "handle_sample_request",
      "handle_document_search_request_v2",
      "handle_embedding_models_list_request",
      "handle_embedding_model_get_request",
      "handle_embedding_request",
      "handle_list_files_request",
      "handle_upload_file_request",
      "handle_retrieve_file_request",
      "handle_delete_file_request",
      "handle_download_file_content_request",
      "handle_create_public_url_request",
      "handle_revoke_public_url_request",
      "handle_image_generation_models_list_request",
      "handle_image_generation_model_get_request",
      "handle_edit_image_request",
      "handle_generate_image_request",
      "handle_language_models_list_request",
      "handle_language_model_get_request",
      "handle_get_me_request",
      "handle_generic_messages_request",
      "handle_models_list_request",
      "handle_model_get_request",
      "handle_compact_request",
      "handle_get_stored_completion_request",
      "handle_delete_stored_completion_request",
      "handle_list_input_items",
      "handle_list_skills_request",
      "handle_upload_skill_request",
      "handle_retrieve_skill_request",
      "handle_delete_skill_request",
      "handle_download_skill_content_request",
      "handle_tokenize_text_request",
      "handle_video_generation_models_list_request",
      "handle_video_generation_model_get_request",
      "handle_edit_video_request",
      "handle_extend_video_request",
      "handle_generate_video_request",
      "handle_get_deferred_video_request"
  ],
  doors: [
    { id: 'appCredentials', method: 'POST', path: '/_twin/app-credentials', note: "the World application's key, as the runtime issues it" },
    { id: 'apiKeys', method: 'POST', path: '/_twin/api-keys', note: 'a key, shown once (xAI Console > API Keys)' },
  ],
  // the key the World issued, sent as a bearer to the API's /v1 paths (its hash held: `_api_key`)
  // source: https://docs.x.ai/developers/debugging.md "No authorization header or an invalid authorization token was provided."
  auth: {
    header: 'authorization', scheme: 'Bearer', paths: '^/v1/', gateWhenAbsent: true, beforeRouting: true, invalidKeys: [],
    missing: { status: 401, code: 'Client specified an invalid argument', message: 'No authorization header was provided.' },
    invalid: { status: 401, code: 'Client specified an invalid argument', message: 'Incorrect API key provided.' },
    held: { storedAs: '_api_key', hashField: 'sha256', unless: 'disabled' },
  },
  discovery: {
    twinOf: "xAI's API (api.x.ai): chat completions and responses, streamed and not, with a reasoning model's reasoning",
    stores: 'API keys (by their SHA-256)',
    behavior: 'a turn is the scenario\'s (on: modelEquals, userTextIncludes, anyTextIncludes, lastMessageIsToolResult, toolResultFor, hasTool; respond: text, toolCalls, reasoning, finishReason), else a labeled stub',
    exampleHandler: { on: { userTextIncludes: 'deal stage' }, respond: { text: 'Move it to Negotiation.' } },
  },
  descriptor: {
    protocol: '3',
    transport: 'rest',
    archetype: 'crud',
    bin: 'world-xai',
    resources: [],
    specSource: "xAI's OpenAPI document (spec/openapi.json, fetched 2026-09-30 from api.x.ai/api-docs/openapi.json)",
    description: "xAI API twin — chat completions and responses (streamed and not; tools, JSON output, reasoning) on the World's scenario or the kernel wire's labeled stub; Console API keys.",
    adoption: { sdks: ['@ai-sdk/xai'], envStems: ['XAI', 'GROK'] },
    hosts: [{ host: 'api.x.ai' }],
    endpointEnvNone: 'the SDK calls https://api.x.ai/v1 unless given a base URL in code; the World claims the host',
    credentialDoor: { account: { field: 'account', tenancy: 'Team', source: 'https://docs.x.ai/developers/rest-api-reference/management/auth.md' }, deployment: { field: 'deployment', object: 'Named API key with ACLs/limits', source: 'https://docs.x.ai/developers/rest-api-reference/management/auth.md' }, path: '/_twin/app-credentials', body: {}, fill: { XAI_API_KEY: 'api_key' } },
  },
};
