// The api lane's manifest (../spec, written from docs.ambientcg.com): the search and the download redirect, both
// computed reads; the World's catalog is published through the door.
import type { DerivedManifest } from '@volter/world-core';

export const manifest: DerivedManifest = {
  vendor: 'ambientcg',
  service: 'ambientcg',
  body: { json: 'always' },
  // an asset's id is the one ambientCG names it by (Wood096)
  ids: { template: '{uuid}' },
  time: 'iso',
  // the host answers its errors as text (a download it cannot find: "This download could not be found.")
  error: '{message}',
  readOnly: { status: 403, message: 'This twin was started read-only; writes are refused.' },
  notFound: { status: 404, message: 'This download could not be found.' },
  gap: { status: 404, message: 'Not Found' },
  list: { style: 'envelope', envelope: { data: '{data}' }, limit: { param: 'limit', default: 100, max: 100 } },
  deleted: {},
  unmodeled: [],
  resources: {
    // source: spec:fullJson "It delivers metadata and downloadable files for all assets in a JSON-format."
    asset: { idPrefix: '', idAs: 'assetId', refresh: { list: 'fullJson', items: 'foundAssets', unpaginated: true, blobs: [
      { path: 'downloadFolders.*.downloadFiletypeCategories.*.downloads.*.downloadLink', key: '{header:x-bz-file-name}', resource: '_file', fields: { name: '{key}', contentType: '{header:content-type}', _sha1: '{header:x-bz-content-sha1}', _fileId: '{header:x-bz-file-id}', _uploadTimestamp: '{header:x-bz-upload-timestamp}' } },
      { path: 'previewImage.*', key: '{header:x-bz-file-name}', resource: '_file', fields: { name: '{key}', contentType: '{header:content-type}', _sha1: '{header:x-bz-content-sha1}', _fileId: '{header:x-bz-file-id}', _uploadTimestamp: '{header:x-bz-upload-timestamp}' } },
    ] } },
    // source: https://www.backblaze.com/apidocs/b2-download-file-by-name "X-Bz-File-Id"
    // source: https://www.backblaze.com/apidocs/b2-download-file-by-name "X-Bz-Upload-Timestamp"
    _file: { idPrefix: '', ids: '{letters:8}' },
  },
  doors: [
    { id: 'assets', method: 'POST', path: '/_twin/assets', note: '{ assetId, dataType, displayName, tags?, creationMethod?, displayCategory?, releaseDate?, popularityScore?, downloadCount?, downloads: [{ attribute, base64 }], thumbnail? (base64 PNG) }: ambientCG publishes an asset; answers it as /full_json lists it' },
  ],
  discovery: {
    twinOf: "ambientCG's v2 API: the search (/full_json) and the download redirect (/get)",
    stores: 'the published assets (the media lane serves their files)',
    identity: 'none: the API is public',
  },
  descriptor: {
    protocol: '3',
    transport: 'rest',
    archetype: 'crud',
    bin: 'world-ambientcg-api',
    resources: ['asset'],
    specSource: 'the v2 API document (spec/SOURCE.md)',
    description: "ambientCG's api lane — the search and downloads.",
    adoption: { sdks: [], envStems: [] },
    hosts: [{ host: 'ambientcg.com' }, { host: 'acg-download.struffelproductions.com' }, { host: 'acg-media.struffelproductions.com' }],
    endpointEnvNone: 'the vendor lane',
  },
};
