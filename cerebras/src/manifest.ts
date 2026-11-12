// No scanned application calls Cerebras. Every spec operation answers the vendor-shaped gap.
import type { DerivedManifest } from '@volter/world-core';

export const manifest: DerivedManifest = {
  vendor: 'cerebras',
  service: 'cerebras',
  body: { json: 'always' },
  ids: { template: '{uuid}' },
  time: 'unix',
  // source: spec:/components/schemas/ErrorChunkContent/properties "message"
  // source: spec:/components/schemas/ErrorChunkResponse/properties "error"
  // The spec names error fields but fixes no type or code for an unknown request.
  error: { error: { message: '{message}', type: '{kind}', code: '{code}' } },
  readOnly: { status: 403, message: 'This twin was started read-only; writes are refused.' },
  // source: https://inference-docs.cerebras.ai/support/error "404 NotFoundError"
  // The page gives the not-found class, not literal URL-refusal words; use that class without an invented code.
  notFound: { status: 404, message: 'Not found' },
  gap: { status: 404, message: 'Not found' },
  deleted: {},
  resources: {},
  unmodeled: ["list_public_models_endpoint_public_v1_models_get", "get_public_model_public_v1_models__model_id__get", "chat_v1_chat_completions_post", "completions_v1_completions_post", "list_models_v1_models_get", "get_model_v1_models__model_id__get", "tcp_warming_v1_tcp_warming_get"],
  vendorBacked: { none: 'No vendor resource or operation is served; every spec operation answers the gap.' },
  // source: https://inference-docs.cerebras.ai/api-reference/authentication "API keys are passed using HTTP Bearer authentication:"
  // source: https://inference-docs.cerebras.ai/support/error "401 AuthenticationError"
  // Where documentation stops: The error table names 401 but does not document missing-key versus unknown-route precedence; the gap stands.
  auth: {
    header: 'authorization', scheme: 'Bearer', gateWhenAbsent: true, invalidKeys: [],
    missing: { status: 401, message: 'Authentication failed' },
    invalid: { status: 401, message: 'Authentication failed' },
  },
  discovery: {
    twinOf: 'Cerebras Cloud API', stores: 'No vendor resources',
    behavior: 'Every spec operation answers the vendor-shaped gap; no scanned application calls Cerebras.',
  },
  descriptor: {
    protocol: '3',
    transport: 'rest',
    archetype: 'crud',
    bin: 'world-cerebras',
    resources: [],
    specSource: "Cerebras's OpenAPI document (spec/openapi.yaml.gz)",
    description: 'Cerebras API twin: every spec operation answers the vendor-shaped gap.',
    adoption: { sdks: ["@ai-sdk/cerebras", "@cerebras/cerebras_cloud_sdk"], envStems: ['CEREBRAS'] },
    hosts: [{ host: 'api.cerebras.ai' }],
    endpointEnvNone: 'the SDK calls https://api.cerebras.ai/v1 unless given a base URL in code; the World claims the host',
    clientCasesNone: 'No scanned application calls Cerebras or uses its SDK.',
  },
};
