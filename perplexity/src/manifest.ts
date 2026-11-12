// No scanned application calls Perplexity. Every spec operation answers the vendor-shaped gap.
import type { DerivedManifest } from '@volter/world-core';

export const manifest: DerivedManifest = {
  vendor: 'perplexity',
  service: 'perplexity',
  body: { json: 'always' },
  ids: { template: '{uuid}' },
  time: 'unix',
  // source: spec:/components/schemas/ErrorInfo "Human-readable error message"
  // source: https://docs.perplexity.ai/api-reference/agent-get "error"
  // The documented 404 envelope requires a message; its code and type are optional and no URL-refusal values are fixed.
  error: { error: { message: '{message}' } },
  readOnly: { status: 403, message: 'This twin was started read-only; writes are refused.' },
  // source: spec:/paths/~1v1~1agent~1{id}/get/responses/404 "Unknown id"
  // The vendor gives a 404 unknown-resource class but no literal unknown-URL message; use that class without an invented code.
  notFound: { status: 404, message: 'Not found' },
  gap: { status: 404, message: 'Not found' },
  deleted: {},
  resources: {},
  unmodeled: ["chatCompletionsLegacyPath", "search_search_post", "createAgent", "retrieveAgent", "cancelAgentResponse", "listAgentFiles", "downloadAgentFile", "getComputerUsageAnalytics", "list_async_chat_completions_async_chat_completions_get", "create_async_chat_completions_async_chat_completions_post", "get_async_chat_completion_response_async_chat_completions__api_request__get", "contextualized_embeddings_v1_contextualizedembeddings_post", "embeddings_v1_embeddings_post", "listModels", "listSkills", "createSkill", "getSkill", "updateSkill", "deleteSkill", "downloadSkill", "listSkillRevisions", "chat_completions_chat_completions_post", "getComputerUsageAnalyticsV2"],
  vendorBacked: { none: 'No vendor resource or operation is served; every spec operation answers the gap.' },
  // source: spec:/components/securitySchemes/HTTPBearer "bearer"
  // source: https://docs.perplexity.ai/docs/admin/api-key-management "Authorization: Bearer YOUR_EXISTING_API_KEY"
  // source: https://docs.perplexity.ai/docs/resources/faq "401 error codes indicate that the provided API key is invalid, deleted, or belongs to an account which ran out of credits."
  // source: https://docs.perplexity.ai/docs/admin/api-key-management "Authentication failed"
  // Where documentation stops: The pages describe invalid keys, not missing-key versus unknown-route precedence; the gap stands.
  auth: {
    header: 'authorization', scheme: 'Bearer', gateWhenAbsent: true, invalidKeys: [],
    missing: { status: 401, message: 'Authentication failed' },
    invalid: { status: 401, message: 'Authentication failed' },
  },
  discovery: {
    twinOf: 'Perplexity AI API', stores: 'No vendor resources',
    behavior: 'Every spec operation answers the vendor-shaped gap; no scanned application calls Perplexity.',
  },
  descriptor: {
    protocol: '3',
    transport: 'rest',
    archetype: 'crud',
    bin: 'world-perplexity',
    resources: [],
    specSource: "Perplexity's OpenAPI document (spec/openapi.json)",
    description: 'Perplexity API twin: every spec operation answers the vendor-shaped gap.',
    adoption: { sdks: ["@ai-sdk/perplexity"], envStems: ['PERPLEXITY'] },
    hosts: [{ host: 'api.perplexity.ai' }],
    endpointEnvNone: 'the SDK calls https://api.perplexity.ai unless given a base URL in code; the World claims the host',
    clientCasesNone: 'No scanned application calls Perplexity or uses its SDK.',
  },
};
