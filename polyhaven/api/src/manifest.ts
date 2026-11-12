// The api lane's manifest (../spec: Poly Haven's own document). The catalog is public and only read: every answer is
// a computed read (a map keyed by id, a count per category, an asset's files view), and the World's catalog is
// published through the door, as Poly Haven's team publishes an asset.
import type { DerivedManifest } from '@volter/world-core';

export const manifest: DerivedManifest = {
  vendor: 'polyhaven',
  service: 'polyhaven',
  body: { json: 'always' },
  // an asset's id is the slug its publisher names (ArmChair_01)
  ids: { template: '{uuid}' },
  time: 'unix',
  // source: spec:get_files_id "No asset found with that ID"
  error: '{message}',
  readOnly: { status: 403, message: 'This twin was started read-only; writes are refused.' },
  notFound: { status: 404, message: 'No asset with id {id}' },
  gap: { status: 404, message: 'Cannot GET' },
  list: { style: 'envelope', envelope: { data: '{data}' }, limit: { param: 'limit', default: 100, max: 100 } },
  deleted: {},
  unmodeled: ['get_author_id', 'get_info_id', 'get_search', 'get_taxonomy', 'get_taxonomy_type', 'get_types'],
  resources: {
    // source: spec:get_assets "A list of assets, including their individual metadata."
    asset: { idPrefix: '', refresh: { list: 'get_assets', items: '$body', keyed: true, unpaginated: true } },
    _file: { idPrefix: '' },
  },
  doors: [
    { id: 'assets', method: 'POST', path: '/_twin/assets', note: '{ id, type (hdris|textures|models), name, categories, tags?, authors?, description?, category?, date_published?, files: { <group>: { <resolution>: { <format>: { name?, text | base64, include?: { <path>: { text | base64 } } } } } }, thumbnail? (base64 PNG) }: Poly Haven publishes an asset; answers it as /info would' },
  ],
  discovery: {
    twinOf: "Poly Haven's catalog API: assets by type and category, their categories' counts, an asset's files",
    stores: 'the published assets and their files trees (the dl lane serves the bytes)',
    identity: 'none: the API is public',
  },
  descriptor: {
    protocol: '3',
    transport: 'rest',
    archetype: 'crud',
    bin: 'world-polyhaven-api',
    resources: ['asset'],
    specSource: "Poly Haven's OpenAPI document (spec/SOURCE.md)",
    description: "Poly Haven's api lane — the catalog.",
    adoption: { sdks: [], envStems: [] },
    hosts: [{ host: 'api.polyhaven.com' }],
    endpointEnvNone: 'the vendor lane',
  },
};
