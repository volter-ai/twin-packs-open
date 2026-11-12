// Demand is recorded in journeys/demand.json; retained operations still answer the vendor-shaped gap.
import type { DerivedManifest } from '@volter/world-core';

export const manifest: DerivedManifest = {
  vendor: 'turbopuffer', service: 'turbopuffer', body: {}, ids: { template: '{uuid}' }, time: 'iso',
  // source: https://turbopuffer.com/docs/auth "all endpoints will return a JSON payload in the format"
  error: { status: 'error', error: '{message}' },
  readOnly: { status: 403, message: 'This World is read-only.' },
  // source: https://raw.githubusercontent.com/turbopuffer/turbopuffer-typescript/v2.8.0/src/core/error.ts "export class NotFoundError extends APIError<404, Headers> {}"
  // The documentation specifies the error envelope but no unknown-path message; use not found in that envelope.
  notFound: { status: 404, message: 'not found' }, gap: { status: 404, message: 'not found' },
  // source: https://turbopuffer.com/docs/auth "The HTTP API expects the API key to be formatted as a standard Bearer token and passed in the Authorization header:"
  // Where documentation stops: Bearer authentication is documented, but missing-key versus unknown-route precedence is not; the gap stands.
  auth: { header: 'authorization', scheme: 'Bearer', gateWhenAbsent: true,
    // source: https://raw.githubusercontent.com/turbopuffer/turbopuffer-typescript/v2.8.0/src/core/error.ts "export class AuthenticationError extends APIError<401, Headers> {}"
    // Exact missing/invalid-key messages are not published.
    missing: { status: 401, message: 'API key required' }, invalidKeys: [], invalid: { status: 401, message: 'Invalid API key' } },
  deleted: {},
  resources: {},
  unmodeled: ['get_v1_namespaces', 'post_v1_namespaces_namespace_debug_recall', 'get_v1_namespaces_namespace_hint_cache_warm', 'get_v1_namespaces_namespace_metadata', 'patch_v1_namespaces_namespace_metadata', 'get_v1_namespaces_namespace_operations_token', 'get_v1_namespaces_namespace_schema', 'post_v1_namespaces_namespace_schema', 'post_v2_namespaces_namespace', 'delete_v2_namespaces_namespace', 'post_v2_namespaces_namespace_explain_query', 'get_v2_namespaces_namespace_metadata', 'post_v2_namespaces_namespace_query'],
  vendorBacked: { none: 'No vendor resource or operation is served; every spec operation answers the gap.' },
  discovery: { twinOf: 'turbopuffer namespaces API', stores: 'No vendor resources', behavior: 'Every spec operation answers the vendor-shaped gap; Dub indexing is demand and remains unserved; reads require an off-by-default flag.' },
  // source: https://raw.githubusercontent.com/turbopuffer/turbopuffer-typescript/v2.8.0/src/client.ts "baseURL = baseURL.replace('{region}', region);"
  pathPrefix: '/(?:aws|gcp|azure)-[a-z0-9-]+(?=/v\\d+/)',
  descriptor: {
    protocol: '3', transport: 'rest', archetype: 'crud', bin: 'world-turbopuffer', resources: [],
    specSource: 'The OpenAPI document for @turbopuffer/turbopuffer@2.8.0 (spec/openapi.yaml.gz), with provenance and hash in spec/SOURCE.md.',
    description: 'turbopuffer API twin: every spec operation answers the vendor-shaped gap.',
    adoption: { sdks: ['@turbopuffer/turbopuffer'], pypi: ['turbopuffer'], scopes: ['@turbopuffer/'], envStems: ['TURBOPUFFER'] },
    // source: https://raw.githubusercontent.com/turbopuffer/turbopuffer-typescript/v2.8.0/src/client.ts "https://{region}.turbopuffer.com"
    hosts: [{ hostPattern: '^(?:aws|gcp|azure)-[a-z0-9-]+\\.turbopuffer\\.com$' }],
    // source: https://raw.githubusercontent.com/turbopuffer/turbopuffer-typescript/v2.8.0/src/client.ts "TURBOPUFFER_BASE_URL"
    endpointEnv: { name: 'TURBOPUFFER_TWIN_URL', templates: { TURBOPUFFER_BASE_URL: '${url}/{region}' }, note: 'The pinned SDK requires the region placeholder when a region is supplied; its Node socket client reads TURBOPUFFER_BASE_URL.' },
    clientCasesNone: 'Demanded calls remain unserved; no SDK case is claimed for the retained gap.',
  },
};
