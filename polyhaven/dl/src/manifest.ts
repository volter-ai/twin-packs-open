// The dl lane's manifest (../spec, written from the api document's urls and Backblaze's page): dl.polyhaven.org is a
// Backblaze B2 bucket served by file name (a name spans slashes), cdn.polyhaven.com the thumbnails. It keeps nothing
// of its own: the files and thumbnails are the api lane's door's.
import type { DerivedManifest } from '@volter/world-core';

export const manifest: DerivedManifest = {
  vendor: 'polyhaven',
  service: 'polyhaven',
  body: { json: 'always' },
  ids: { template: '{uuid}' },
  time: 'unix',
  // B2's error body, as dl.polyhaven.org answers a name no file has: {"code":"not_found","message":"File with such
  // name does not exist.","status":404} (spec/SOURCE.md)
  error: { code: '{code}', message: '{message}', status: '{status}' },
  readOnly: { status: 401, code: 'unauthorized', message: 'This twin was started read-only; writes are refused.' },
  notFound: { status: 404, code: 'not_found', message: 'File with such name does not exist.' },
  gap: { status: 404, code: 'not_found', message: 'File with such name does not exist.' },
  spanning: ['fileName'],
  deleted: {},
  resources: {},
  discovery: {
    twinOf: "Poly Haven's download hosts: an asset's files by name in the ph-assets bucket, and its thumbnail",
    stores: "nothing of its own: the files and thumbnails are the api lane's",
  },
  descriptor: {
    protocol: '3',
    transport: 'rest',
    archetype: 'crud',
    bin: 'world-polyhaven-dl',
    resources: [],
    specSource: 'the download hosts\' document (spec/SOURCE.md)',
    description: "Poly Haven's dl lane — files and thumbnails.",
    adoption: { sdks: [], envStems: [] },
    hosts: [{ host: 'dl.polyhaven.org' }, { host: 'cdn.polyhaven.com' }],
    endpointEnvNone: 'the vendor lane',
  },
};
