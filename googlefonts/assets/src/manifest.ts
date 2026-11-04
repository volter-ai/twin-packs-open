// Vendor wire facts; the surface is derived from the retained spec.
import type { DerivedManifest } from '@volter/world-core';
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
  discovery: { twinOf: 'Google Fonts font bytes', stores: 'Published catalog and font representations in the shared googlefonts store' },
  spanning: ['file'],
  descriptor: { protocol: '3', transport: 'rest', archetype: 'crud', bin: 'world-googlefonts-assets',
    resources: [], specSource: 'assets/spec/SOURCE.md', description: 'Google Fonts font bytes',
    adoption: { sdks: [], envStems: [] }, hosts: [{ host: 'fonts.gstatic.com', pathPattern: '^/(s/|l/font$)' }],
    endpointEnvNone: 'The application hardcodes this vendor lane host.' },
};
