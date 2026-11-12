// No demanded application calls Deepgram; every spec operation answers the vendor-shaped gap.
import type { DerivedManifest } from '@volter/world-core';

export const manifest: DerivedManifest = {
  vendor: 'deepgram', service: 'deepgram', body: {}, ids: { template: '{uuid}' }, time: 'iso',
  // source: spec:/components/schemas/ErrorResponseLegacyError "The error code"
  // source: https://developers.deepgram.com/docs/errors "Invalid credentials."
  error: { err_code: '{code}', err_msg: '{message}', request_id: '{id}' },
  readOnly: { status: 403, message: 'This World is read-only.' },
  // source: https://developers.deepgram.com/docs/errors "Project not found."
  // The documentation gives no unknown-route body; use its documented not-found error class.
  notFound: { status: 404, code: 'PROJECT_NOT_FOUND', message: 'Project not found.' },
  gap: { status: 404, code: 'PROJECT_NOT_FOUND', message: 'Project not found.' },
  deleted: {},
  resources: {},
  unmodeled: ["models_list", "tokens_grant", "media_transcribe", "models_list_3", "models_get_2", "projects_list", "projects_get", "projects_update", "projects_delete", "variables_list", "variables_create", "variables_get", "variables_update", "variables_delete", "configurations_list", "configurations_create", "configurations_get", "configurations_update", "configurations_delete", "balances_list", "balances_get", "breakdown_list", "fields_list_2", "invites_list", "invites_create", "invites_delete", "keys_list", "keys_create", "keys_get", "keys_delete", "projects_leave", "members_list", "members_delete", "scopes_list", "scopes_update", "models_list_2", "models_get", "purchases_list", "requests_list", "requests_get", "distributionCredentials_list", "distributionCredentials_create", "distributionCredentials_get", "distributionCredentials_delete", "usage_get", "breakdown_get", "fields_list", "text_analyze", "audio_generate", "audio_generate_2"],
  // source: https://developers.deepgram.com/reference/authentication "Authorization: Token <YOUR_DEEPGRAM_API_KEY>"
  // source: spec:/components/securitySchemes/JwtAuth "Use `Authorization: Bearer <JWT>`"
  // source: https://developers.deepgram.com/docs/errors "Providing an invalid API key will return 401 Unauthorized"
  // Where documentation stops: required credentials do not establish unknown-route precedence; the existing answer stands.
  auth: {
    header: 'authorization', scheme: 'Token', also: [{ header: 'authorization', scheme: 'Bearer' }],
    gateWhenAbsent: true, beforeRouting: true, invalidKeys: [],
    missing: { status: 401, code: 'INVALID_AUTH', message: 'Invalid credentials.' },
    invalid: { status: 401, code: 'INVALID_AUTH', message: 'Invalid credentials.' },
  },
  vendorBacked: { none: 'No vendor resource or operation is served; every spec operation answers the gap.' },
  discovery: { twinOf: 'Deepgram REST API', stores: 'No vendor resources', behavior: 'Every spec operation answers the vendor-shaped gap.' },
  descriptor: {
    protocol: '3', transport: 'rest', archetype: 'crud', bin: 'world-deepgram', resources: [],
    specSource: 'Deepgram REST API 1.0.0 (spec/openapi.yaml.gz; provenance in spec/SOURCE.md)',
    description: 'Deepgram API twin: every spec operation answers the vendor-shaped gap.',
    adoption: { sdks: ['@deepgram/sdk'], envStems: ['DEEPGRAM'] },
    hosts: [{ host: 'api.deepgram.com' }],
    endpointEnvNone: 'No scanned application calls Deepgram; the World claims api.deepgram.com',
    clientCasesNone: 'No demanded application uses Deepgram or its official SDK.',
  },
};
