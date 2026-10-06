// Anthropic's manifest: the Claude API, the vendor facts its published document does not carry (docs/contributing/
// architecture.md, "Protocol 3"). The surface is generated (./generated/surface.gen.json, from ../spec, the OpenAPI
// document Anthropic's TypeScript SDK is generated from).
//
// SCOPE FROM THE DEMAND (../journeys/demand.json). Dub, Twenty and LibreChat send Messages: streamed and not, with tools,
// thinking, prompt caching, images and structured output (Dub and Twenty through the AI SDK, LibreChat through the SDK);
// Claude Code, which Volter Harness runs, sends its turns and token counts through the SDK's beta namespace
// (`?beta=true`); LibreChat lists the models at startup. ./semantics/messages.ts and ./semantics/models.ts serve them.
// The non-beta token count, which no application sends, is `unmodeled`; every other operation (Message Batches, Files,
// Skills, Managed Agents, the Admin API) is the gap.
//
// THE TWIN RUNS NO MODEL. A turn is the World's scenario's when it scripts one (./semantics/scenario.ts), else a
// labeled deterministic stub; the protocol around it (the answer, the stream's events, tool_use, stop_reason, usage) is
// the vendor's.
//
// THE STATE: the organization and its Default workspace, its API keys (kept by their SHA-256, made and deleted on the
// Console's API keys page), and the prompt cache (`_prompt_cache`, one entry per cached prefix, with its lifetime).
//
// WHY NO `auth`: a key is refused in Anthropic's error envelope with its request id, and a request without the
// `anthropic-version` header is refused before it routes; the front (./semantics/around.ts) states both.
import type { DerivedManifest } from '@volter/world-core';
import { states } from './semantics/states.ts';

export const manifest: DerivedManifest = {
  vendor: 'anthropic',
  service: 'anthropic',
  body: { json: 'always' },
  ids: { template: '{letters:24}' },
  time: 'iso',
  // source: spec:messages_post "stateless multi-turn conversations."
  vendorBacked: { none: "the served Messages, token-count and model-list API calls store no vendor resource; organizations, workspaces and keys are local Console setup through screens and doors, not served Admin API mutations" },
  // https://platform.claude.com/docs/en/api/errors: {type: "error", error: {type, message}, request_id} (the front adds
  // the request id to every error it answers)
  error: { type: 'error', error: { type: '{kind}', message: '{message}' } },
  readOnly: { status: 403, message: 'the twin is read-only', kind: 'permission_error' },
  malformedBody: { status: 400, message: 'There was an issue with the format or content of your request.', kind: 'invalid_request_error' },
  notFound: { status: 404, message: 'The requested resource could not be found.', kind: 'not_found_error' },
  gap: { status: 404, message: 'Not Found', kind: 'not_found_error' },
  list: { style: 'envelope', envelope: { data: '{data}' }, limit: { param: 'limit', default: 20, max: 1000 } },
  deleted: {},
  doors: [
    { id: 'users', method: 'POST', path: '/_twin/users/{email}', note: '{ organization }: a person who signed up to the Console, the admin of their new organization and its Default workspace' },
    { id: 'mailbox', method: 'GET', path: '/_twin/mailbox/{email}', note: 'the mail the Console sent there (its login codes), newest first' },
    { id: 'keys', method: 'POST', path: '/_twin/api-keys', note: '{ email, organization?, name? }: a key made on the API keys page by that person (their organization made if new), shown once' },
    { id: 'appCredentials', method: 'POST', path: '/_twin/app-credentials', note: 'the key the World\'s application holds, as the runtime issues it at every boot' },
  ],
  screens: [{
    id: 'login', kind: 'flow', host: 'platform.claude.com', path: '/login',
    demand: 'the admin signs in to make the applications\' keys', status: 'done', controls: ['Email', 'Continue with email', 'Login code', 'Verify'],
    source: 'https://platform.claude.com/docs/en/manage-claude/authentication',
  }, {
    id: 'api-keys', kind: 'workspace', host: 'platform.claude.com', path: '/settings/keys',
    demand: "every application's ANTHROPIC_API_KEY is made here, and a leaked one deleted", status: 'done', controls: ['Create key', 'Name', 'Expiration', 'Disable', 'Re-enable', 'Delete'],
    source: 'https://platform.claude.com/docs/en/manage-claude/authentication',
  }],
  resources: {
    // keyed by their stored names: every served operation is a handler
    // a root's credential is an application's workspace API key, and only the Admin API reads an organization and its
    // workspaces back; it accepts an Admin API key, an org:admin token, or a personal or service account key "that isn't
    // scoped to a specific workspace" (https://platform.claude.com/docs/en/build-with-claude/administration-api)
    organization: { idPrefix: '', ...states.organization, refresh: { none: "the root holds a workspace API key; the organization is read only by the Admin API, which refuses a key scoped to a workspace" } },
    workspace: { idPrefix: 'wrkspc_', ids: '{letters:24}', ...states.workspace, refresh: { none: "the root holds a workspace API key; workspaces are listed only by the Admin API, which refuses a key scoped to a workspace" } },
    _api_key: { idPrefix: 'apikey_', ids: '{letters:24}', ...states._api_key },
    _mail: { idPrefix: '' },
    _prompt_cache: { idPrefix: '' },
    _message: { idPrefix: 'msg_', ids: '{letters:24}' },
    _request: { idPrefix: 'req_', ids: '{letters:24}' },
  },
  unmodeled: ['messages_count_tokens_post'],
  // the Messages API's limits: at the Start tier 1,000 requests a minute per model class, enforced by a token bucket
  // source: https://platform.claude.com/docs/en/api/rate-limits "The rate limits for the Messages API are measured in requests per minute (RPM)"
  // source: https://platform.claude.com/docs/en/api/rate-limits "Claude Opus 5.5 1,000 2,000,000 400,000"
  rateBudget: {
    // the vendor's documented allowance this budget stays inside (cited above)
    allowance: { perMinute: 1000, source: 'https://platform.claude.com/docs/en/api/rate-limits' },
    reason: "Anthropic limits the Messages API per model class in requests per minute, 1,000 at the Start tier, replenished continuously by a token bucket (https://platform.claude.com/docs/en/api/rate-limits); a 429 carries retry-after",
    windowMs: 60_000, ceiling: 1000, defaultWeight: 1, maxRetryAfterSeconds: 60,
  },
  discovery: {
    twinOf: "the Claude API: Messages (streamed and not, tools, thinking, prompt caching, structured output), token counting and the model list, with the Console's API keys",
    stores: 'the organization, its Default workspace, its API keys (hashed) and the prompt cache',
    behavior: 'a turn is the scenario\'s (on: modelEquals, userTextIncludes, anyTextIncludes, lastMessageTextIncludes, lastMessageIsToolResult, toolResultFor, hasTool; respond: text string, toolUses [{name,input}], serverTools [{name:web_search,input:{query},results:[{type:web_search_result,url,title,encrypted_content,page_age?}]}], thinking string, stopReason string), else a labeled stub',
    exampleHandler: { on: { userTextIncludes: 'refund' }, respond: { text: 'The refund was issued on 3 March.' } },
  },
  descriptor: {
    protocol: '3',
    transport: 'rest',
    archetype: 'generative',
    bin: 'world-anthropic',
    resources: ['organization', 'workspace'],
    specSource: "spec/openapi.json.gz, the OpenAPI document Anthropic's TypeScript SDK is generated from (spec/SOURCE.md)",
    description: 'Claude API twin — Messages (streamed and not: tools, thinking, prompt caching with its lifetimes, images, structured output), token counting and the model list, answered by the World\'s scenario or a labeled stub; API keys made on the Console.',
    adoption: { sdks: ['@anthropic-ai/sdk', '@ai-sdk/anthropic', '@anthropic-ai/vertex-sdk', '@anthropic-ai/bedrock-sdk', '@anthropic-ai/claude-agent-sdk'], scopes: ['@anthropic-ai/'], pypi: ['anthropic', 'claude-agent-sdk', 'claude-code-sdk'], envStems: ['ANTHROPIC'] },
    hosts: [{ host: 'api.anthropic.com' }, { host: 'platform.claude.com' }, { host: 'console.anthropic.com' }],
    // the World's applications hold a key the Console made (the keys door), never a fixture: the twin refuses any other
    credentialDoor: { path: '/_twin/app-credentials', body: {}, fill: { ANTHROPIC_API_KEY: 'key' } },
    endpointEnv: { name: 'ANTHROPIC_BASE_URL', note: "the SDKs' base URL (the TypeScript and Python SDKs and Claude Code read ANTHROPIC_BASE_URL)" },
  },
};
