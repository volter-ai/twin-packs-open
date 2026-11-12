// No scanned application calls Groq. Every spec operation answers the vendor-shaped gap.
import type { DerivedManifest } from '@volter/world-core';

export const manifest: DerivedManifest = {
  vendor: 'groq',
  service: 'groq',
  body: { json: 'always' },
  ids: { template: '{uuid}' },
  time: 'unix',
  // source: https://console.groq.com/docs/errors "invalid_request_error"
  error: { error: { message: '{message}', type: 'invalid_request_error' } },
  readOnly: { status: 403, message: 'This twin was started read-only; writes are refused.' },
  // source: https://console.groq.com/docs/errors "404 Not Found"
  // source: https://console.groq.com/docs/errors "The requested resource could not be found."
  // The page describes this error class but gives no distinct literal URL-refusal body.
  notFound: { status: 404, message: 'The requested resource could not be found.' },
  gap: { status: 404, message: 'The requested resource could not be found.' },
  deleted: {},
  resources: {},
  unmodeled: ["createSpeech", "createTranscription", "createTranslation", "listBatches", "createBatch", "retrieveBatch", "cancelBatch", "createChatCompletion", "createEmbedding", "listFiles", "uploadFile", "retrieveFile", "deleteFile", "downloadFile", "listModels", "retrieveModel", "deleteModel", "createReranking", "createResponse", "listFineTunings", "createFineTuning", "getFineTuning", "deleteFineTuning"],
  vendorBacked: { none: 'No vendor resource or operation is served; every spec operation answers the gap.' },
  // source: spec:/components/securitySchemes/api_key "bearer"
  // source: https://console.groq.com/docs/errors "401 Unauthorized"
  // source: https://console.groq.com/docs/errors "The request was not successful because it lacks valid authentication credentials for the requested resource."
  // Where documentation stops: The 401 rule concerns credentials for the requested resource; precedence on unknown routes is undocumented, so the gap stands.
  auth: {
    header: 'authorization', scheme: 'Bearer', gateWhenAbsent: true, invalidKeys: [],
    missing: { status: 401, message: 'The request was not successful because it lacks valid authentication credentials for the requested resource.' },
    invalid: { status: 401, message: 'The request was not successful because it lacks valid authentication credentials for the requested resource.' },
  },
  discovery: {
    twinOf: 'GroqCloud API', stores: 'No vendor resources',
    behavior: 'Every spec operation answers the vendor-shaped gap; no scanned application calls Groq.',
  },
  descriptor: {
    protocol: '3',
    transport: 'rest',
    archetype: 'crud',
    bin: 'world-groq',
    resources: [],
    specSource: "Groq's OpenAPI document (spec/openapi.yaml.gz)",
    description: 'Groq API twin: every spec operation answers the vendor-shaped gap.',
    adoption: { sdks: ["@ai-sdk/groq", "groq-sdk"], envStems: ['GROQ'] },
    hosts: [{ host: 'api.groq.com' }],
    endpointEnvNone: 'the SDK calls https://api.groq.com/openai/v1 unless given a base URL in code; the World claims the host',
    clientCasesNone: 'No scanned application calls Groq or uses its SDK.',
  },
};
