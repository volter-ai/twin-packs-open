// The media lane's manifest (../spec, written from Backblaze's page): the ambientCG-Web B2 bucket served by file name
// (a name spans slashes) on two hosts, zips and thumbnails. It keeps nothing of its own: the files are the api lane's
// door's.
import type { DerivedManifest } from '@volter/world-core';

export const manifest: DerivedManifest = {
  vendor: 'ambientcg',
  service: 'ambientcg',
  body: { json: 'always' },
  ids: { template: '{uuid}' },
  time: 'iso',
  // B2's error body: {"code":"not_found","message":"File with such name does not exist.","status":404} (spec/SOURCE.md)
  error: { code: '{code}', message: '{message}', status: '{status}' },
  readOnly: { status: 401, code: 'unauthorized', message: 'This twin was started read-only; writes are refused.' },
  notFound: { status: 404, code: 'not_found', message: 'File with such name does not exist.' },
  gap: { status: 404, code: 'not_found', message: 'File with such name does not exist.' },
  spanning: ['fileName'],
  deleted: {},
  resources: {},
  unmodeled: [],
  vendorBacked: { none: 'This lane serves public file bytes; the catalog is refreshed by the API lane. It exposes no customer mutation.' },
  discovery: {
    twinOf: "ambientCG's file hosts: the ambientCG-Web bucket's zips and thumbnails by name",
    stores: "nothing of its own: the files are the api lane's",
  },
  descriptor: {
    protocol: '3',
    transport: 'rest',
    archetype: 'crud',
    bin: 'world-ambientcg-media',
    resources: [],
    specSource: "the file hosts' document (spec/SOURCE.md)",
    description: "ambientCG's media lane — zips and thumbnails.",
    adoption: { sdks: [], envStems: [] },
    hosts: [{ host: 'acg-download.struffelproductions.com' }, { host: 'acg-media.struffelproductions.com' }],
    endpointEnvNone: 'the vendor lane',
  },
};
