// Axiom's manifest: the vendor facts its spec (../spec/openapi.json, the Public API 1.0.0) does not carry.
//
// What is served: the legacy ingest (`POST /v1/datasets/{dataset_name}/ingest`) that @axiomhq/js sends every batch of
// Dub's logs to (its logger, ../journeys/demand.json), keeping each event as the vendor's own record (`event`, as a
// query answers an entry: `_time`, `_sysTime`, `_rowId` and the event's `data`) under its dataset, in the World's
// history; the dataset list a root refreshes the account's datasets by; and the World's sign-up door, which makes the
// account, its basic API token and the dataset the application's env names. Every other operation answers the gap.
import type { DerivedManifest } from '@volter/world-core';

export const manifest: DerivedManifest = {
  vendor: 'axiom', service: 'axiom',
  // an ingest body is JSON, NDJSON or CSV by its Content-Type (./semantics/datasets.ts reads its bytes); nothing is
  // parsed as JSON before the handler
  body: {},
  ids: { template: '{uuid}' }, time: 'iso',
  // source: spec:/components/schemas/NotFoundError/example "Not found"
  error: { code: '{status}', message: '{message}' },
  readOnly: { status: 403, message: 'This World is read-only.' },
  malformedBody: { status: 400, message: 'invalid request body' },
  // source: https://axiom.co/docs/restapi/introduction "If authentication is unsuccessful for a request, Axiom returns the error status code 403."
  // Where documentation stops: the page does not establish missing-token versus unknown-route precedence; the gap stands.
  notFound: { status: 404, message: 'Not found' }, gap: { status: 404, message: 'Not found' },
  deleted: {},
  pathPrefix: '^/api(?=/v1/)',
  // source: https://axiom.co/docs/reference/limits "Axiom accepts gzip, zstd, brotli, and deflate compression"
  // Where documentation stops: the page gives no answer for a body that does not decode; the twin refuses it as the
  // ingest page refuses data it cannot read (400).
  encodings: { request: ['gzip', 'zstd', 'br', 'deflate'], undecodable: { status: 400, message: 'invalid request body encoding' } },
  // source: https://axiom.co/docs/restapi/introduction "Authorization: Bearer API_TOKEN"
  // source: https://axiom.co/docs/restapi/endpoints/ingestIntoDataset "401 Unauthorized"
  // A token is held when the World issued it (its SHA-256 in `_api_token`); its dataset access is the handler's
  // (./semantics/datasets.ts), since the kernel's gate grants all or nothing.
  auth: {
    header: 'authorization', scheme: 'Bearer', gateWhenAbsent: true, invalidKeys: [],
    held: { storedAs: '_api_token', hashField: 'sha256' },
    missing: { status: 401, message: 'Unauthorized' },
    invalid: { status: 401, message: 'Unauthorized' },
  },
  // source: spec:getDatasets "Get list of datasets available to the current user."
  // The dataset list is a bare array, unpaged. Where the documentation stops: the spec names no page size; the limit
  // is no smaller than an account's datasets (the Axiom Cloud plan's soft limit, 100, can be raised on request).
  list: { style: 'envelope', envelope: '{data}', limit: { param: 'limit', default: 1000, max: 1000 } },
  resources: {
    // source: spec:getDatasets "Get list of datasets available to the current user."
    // A dataset's id is its name (the spec's example: "id": "example-dataset", "name": "example-dataset").
    DatasetSpec: { idPrefix: '', refresh: { list: 'getDatasets', items: '$body' } },
    // source: spec:/components/schemas/Entry/required "_sysTime"
    // An ingested event, as the legacy query answers an entry (the spec's Entry: `_rowId`, `_sysTime`, `_time`,
    // `data`), its dataset private (`_dataset`, the dataset's id). Its three `_` fields are the vendor's own.
    event: { idPrefix: '', ids: '{uuid}', vendorUnderscored: ['_time', '_sysTime', '_rowId'],
      parent: { param: 'dataset_name', field: '_dataset', resource: 'DatasetSpec' },
      refresh: { none: 'An ingested event is read back only by a query (APL, or the legacy query): a POST whose body is the query, which no list or get reads; the events a run wrote are its World history.' } },
    _api_token: { idPrefix: '', ids: '{uuid}' },
  },
  // What of an ingested event identifies a person (twin-world architecture, "Replicating an issue"): the request
  // @axiomhq/nextjs logs with a route's entry (its client's address, user agent and path) at the event's top or under its
  // `fields`, as Dub's logger sends both, the user rows a log names, and every instant, so one offset moves them all.
  privacy: {
    identifiers: {
      event: {
        'data.request.ip': 'ip', 'data.request.userAgent': 'agent', 'data.request.path': 'url', 'data.request.url': 'url', 'data.request.startTime': 'time', 'data.request.endTime': 'time',
        'data.fields.request.ip': 'ip', 'data.fields.request.userAgent': 'agent', 'data.fields.request.path': 'url', 'data.fields.request.url': 'url', 'data.fields.request.startTime': 'time', 'data.fields.request.endTime': 'time',
        'data.fields.cells.email': 'email', 'data.fields.cells.name': 'name',
        _time: 'time', _sysTime: 'time', 'data._time': 'time',
      },
    },
    // the counts a developer asks of an incident, none grouped by what identifies a person
    questions: [{ type: 'event' }, { type: 'event', by: 'data.level' }, { type: 'event', by: '_dataset' }, { type: 'event', by: 'data.request.statusCode' }],
  },
  unmodeled: ['createDataset', 'queryApl', 'getDataset', 'updateDataset', 'deleteDataset', 'queryDataset', 'trimDataset', 'getCurrentUser'],
  doors: [
    { id: 'appCredentials', method: 'POST', path: '/_twin/app-credentials', note: "the World application's basic API token and the dataset it ingests into (Settings > API tokens, and a new dataset), the same at every boot" },
  ],
  // source: https://axiom.co/docs/restapi/api-limits "Rate limits vary"
  rateBudget: { windowMs: 60000, ceiling: 30, defaultWeight: 1, maxRetryAfterSeconds: 60, reason: 'Axiom publishes varying header-based allowances; fallback 30 calls per minute.' },
  discovery: { twinOf: 'Axiom Public API: the legacy ingest @axiomhq/js sends to', stores: 'datasets, the events ingested into them (as a query answers them) and API tokens (by their SHA-256)', behavior: 'Ingest keeps each event with its _time and _sysTime; every other API operation answers the gap.' },
  descriptor: {
    protocol: '3', transport: 'rest', archetype: 'crud', bin: 'world-axiom', resources: ['DatasetSpec', 'event'],
    specSource: 'Axiom Public API 1.0.0; axiomhq/docs 44ace74b345f95629dae4a8ec9f1b9c558cfddc5',
    description: "Axiom twin: the legacy ingest Dub's logger sends to, each event kept as the vendor's record; the World issues the token and dataset.",
    adoption: { sdks: ['@axiomhq/js', '@axiomhq/logging', '@axiomhq/nextjs', '@axiomhq/winston', 'next-axiom'], envStems: ['AXIOM'] },
    hosts: [{ host: 'api.axiom.co' }, { host: 'cloud.axiom.co', pathPattern: '^/api/v1/datasets/' }],
    // next-axiom@0.17.0 dist/platform/generic.js:14 reads AXIOM_URL; @axiomhq/js 1.3.1 takes a `url` option only and
    // reaches the twin by its host (api.axiom.co).
    endpointEnv: { name: 'AXIOM_URL', note: 'next-axiom 0.17.0 reads this base URL; @axiomhq/js (Dub) sends to api.axiom.co, which the World claims.' },
    // source: https://raw.githubusercontent.com/dubinc/dub/7e0101363b2ab30afc537c1893f159d1dcba513a/apps/web/lib/axiom/server.ts "const isAxiomEnabled = process.env.AXIOM_DATASET && process.env.AXIOM_TOKEN;"
    clientCasesNone: 'Dub and Cal configure their @axiomhq transports only when an operator supplies AXIOM_TOKEN and AXIOM_DATASET (journeys/demand.json, optional); no demanded application uses the SDK as it ships.',
    credentialDoor: { path: '/_twin/app-credentials', body: {}, fill: { AXIOM_TOKEN: 'token', AXIOM_DATASET: 'dataset' } },
  },
};
