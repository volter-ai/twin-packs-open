// World API credential testing for Volter Editor; the account door stands for the developer portal.
import type { DerivedManifest } from '@volter/world-core';

export const manifest: DerivedManifest = {
  vendor: 'worldlabs',
  service: 'worldlabs',
  // source: https://docs.worldlabs.ai/api/errors "Schema validation errors (422) return detail as an array, with one entry per invalid field:"
  body: { json: 'always', validation: {
    operations: ['list_worlds_marble_v1_worlds_list_post'], status: 422,
    missing: { detail: [{ loc: ['body'], msg: 'Field required', type: 'missing' }] },
    type: { detail: [{ loc: ['body'], msg: 'Input should be a valid dictionary', type: 'model_attributes_type', input: '{input}' }] },
    range: { detail: [{ loc: ['body', '{name}'], msg: 'Input is outside the allowed range', type: 'value_error', input: '{input}' }] },
  } },
  // source: spec:list_worlds_marble_v1_worlds_list_post "Returns worlds created through the API with optional filtering and pagination."
  reads: ['list_worlds_marble_v1_worlds_list_post'],
  unmodeled: [
    'get_credits_marble_v1_credits_get',
    'get_media_asset_marble_v1_media_assets__media_asset_id__get',
    'prepare_media_asset_upload_marble_v1_media_assets_prepare_upload_post',
    'get_operation_marble_v1_operations__operation_id__get',
    'pano_depth_to_rgb_marble_v1_pano_depth_to_rgb_post',
    'delete_world_marble_v1_worlds__world_id__delete',
    'get_world_marble_v1_worlds__world_id__get',
    'export_world_marble_v1_worlds__world_id__export_post',
    'generate_world_marble_v1_worlds_generate_post',
  ],
  vendorBacked: { none: 'This credential-check scope sends only a read-only list, stores no vendor world, and issues no vendor mutation. Its accounts and keys are local bookkeeping; populated live accounts and generation are outside this scope.' },
  ids: { template: '{uuid}' },
  time: 'iso',
  // source: https://docs.worldlabs.ai/api/errors "Most errors return a JSON body with a detail field that describes the problem"
  error: { detail: '{message}' },
  readOnly: { status: 403, message: 'This twin was started read-only; writes are refused.' },
  notFound: { status: 404, message: 'Not Found' },
  gap: { status: 404, message: 'Not Found' },
  // source: spec:/components/schemas/ListWorldsRequest "Number of results per page (1-100)"
  list: { style: 'envelope', envelope: { worlds: '{data}' }, limit: { param: 'page_size', default: 20, max: 100 } },
  deleted: {},
  resources: {
    _api_key: { idPrefix: '', ids: '{uuid}' },
    _account: { idPrefix: '' },
  },
  doors: [
    // source: https://docs.worldlabs.ai/api/index "Generate an API key from the API keys page."
    // Twin-only choice: this door issues 40 alphanumeric characters; the vendor publishes no key width.
    { id: 'accounts', method: 'POST', path: '/_twin/accounts', note: '{}: a World Labs account and its API key, as the developer portal gives it' },
  ],
  discovery: {
    twinOf: "World Labs' World API as Volter Editor tests a key: the account's worlds, listed",
    stores: 'accounts and their API keys (by their SHA-256)',
    identity: '`WLT-Api-Key: <key>`',
  },
  descriptor: {
    protocol: '3',
    transport: 'rest',
    archetype: 'crud',
    bin: 'world-worldlabs',
    resources: [],
    specSource: "the World API's OpenAPI document (spec/SOURCE.md)",
    description: "World Labs twin — the account's worlds, listed with its API key, as Volter Editor tests a connected key.",
    adoption: { sdks: [], envStems: ['WORLDLABS'] },
    // source: spec:/servers/0 "https://api.worldlabs.ai"
    hosts: [{ host: 'api.worldlabs.ai' }],
    endpointEnvNone: 'the editor calls api.worldlabs.ai; the World claims the host',
    // source: spec:/components/securitySchemes/ApiKeyAuth "API key for authentication. Get your key from the developer portal."
    credentialDoor: { account: { field: 'account', tenancy: 'Platform account', source: 'https://docs.worldlabs.ai/api/index' }, deployment: { field: 'deployment', object: 'API key', source: 'https://docs.worldlabs.ai/api/index' },  path: '/_twin/accounts', body: {}, fill: { WORLDLABS_API_KEY: 'api_key' } },
  },
};
