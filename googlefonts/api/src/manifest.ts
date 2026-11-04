// Vendor wire facts; the surface is derived from the retained spec.
import type { DerivedManifest } from '@volter/world-core';
import { states } from './semantics/states.ts';
export const manifest: DerivedManifest = {
  vendor: 'googlefonts', service: 'googlefonts', body: { json: 'always' },
  ids: { template: '{uuid}' }, time: 'iso',
  error: { error: { code: '{status}', message: '{message}', status: '{kind}' } },
  readOnly: { status: 403, kind: 'PERMISSION_DENIED', message: 'Read-only World' },
  notFound: { status: 404, kind: 'NOT_FOUND', message: 'Not Found' },
  gap: { status: 404, kind: 'NOT_FOUND', message: 'Not Found' },
  list: { style: 'envelope', envelope: { items: '{data}' }, limit: { param: 'limit', default: 100, max: 100 } },
  deleted: {},
  resources: { webfont: { idPrefix: '', ...states.webfont,
    refresh: { none: 'The selected reference snapshot is publisher data, not an account-owned font mutation; no full-live-catalog refresh is claimed.' } },
    _project: { idPrefix: '' },
    _api_key: { idPrefix: '', ...states._api_key } },
  discovery: { twinOf: 'Google Fonts Developer API', stores: 'Published catalog and font representations in the shared googlefonts store' },
  // The pinned helper uses the older documented prefix; no app request is rewritten.
  pathPrefix: '^/webfonts(?=/v1/webfonts$)',
  // The core reads query keys and gates against actual issued hashes. Doors bypass the API gate.
  auth: { header: 'x-goog-api-key', scheme: '', also: [{ query: 'key' }], paths: '^/(webfonts/)?v1/webfonts$',
    missing: { status: 403, kind: 'PERMISSION_DENIED', message: 'The request is missing a valid API key.' },
    invalid: { status: 400, kind: 'INVALID_ARGUMENT', message: 'API key not valid. Please pass a valid API key.' },
    invalidKeys: [], gateWhenAbsent: true, held: { storedAs: '_api_key', hashField: 'sha256' } },
  doors: [{ id: 'appCredentials', method: 'POST', path: '/_twin/app-credentials', note: 'Issue the World application key' },
    { id: 'publishCatalog', method: 'POST', path: '/_twin/catalog', note: 'Google publishes fonts without a Developer API create operation; import its actual catalog/CSS/blob snapshot' }],
  descriptor: { protocol: '3', transport: 'rest', archetype: 'crud', bin: 'world-googlefonts-api',
    resources: [], specSource: 'api/spec/SOURCE.md', description: 'Google Fonts Developer API',
    adoption: { sdks: [], envStems: [] }, hosts: [{ host: 'webfonts.googleapis.com' }, { host: 'www.googleapis.com', pathPattern: '^/webfonts/v1/webfonts$' }],
    endpointEnvNone: 'The application hardcodes this vendor lane host.' },
};
