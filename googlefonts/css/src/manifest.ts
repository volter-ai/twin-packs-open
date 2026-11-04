// Vendor wire facts; the surface is derived from the retained spec.
import type { DerivedManifest } from '@volter/world-core';
import { notState } from './semantics/states.ts';
export const manifest: DerivedManifest = {
  vendor: 'googlefonts', service: 'googlefonts', body: { json: 'always' },
  ids: { template: '{uuid}' }, time: 'iso',
  error: { error: { code: '{status}', message: '{message}', status: '{kind}' } },
  readOnly: { status: 403, kind: 'PERMISSION_DENIED', message: 'Read-only World' },
  notFound: { status: 404, kind: 'NOT_FOUND', message: 'Not Found' },
  gap: { status: 404, kind: 'NOT_FOUND', message: 'Not Found' },
  list: { style: 'envelope', envelope: { items: '{data}' }, limit: { param: 'limit', default: 100, max: 100 } },
  deleted: {},
  resources: {},
  discovery: { twinOf: 'Google Fonts browser-selected CSS', stores: 'Published catalog and font representations in the shared googlefonts store' },
  
  descriptor: { protocol: '3', transport: 'rest', archetype: 'crud', bin: 'world-googlefonts-css',
    resources: [], specSource: 'css/spec/SOURCE.md', description: 'Google Fonts browser-selected CSS',
    adoption: { sdks: [], envStems: [] }, hosts: [{ host: 'fonts.googleapis.com', pathPattern: '^/css2?$' }],
    endpointEnvNone: 'The application hardcodes this vendor lane host.' },
};
