// ambientCG's manifest: a vendor of two lanes (architecture, "Other wires: lanes"): its v2 API (`api`, ambientcg.com:
// the search and the download redirect) and the Backblaze B2 bucket its answers point at (`media`: the zips on
// acg-download.struffelproductions.com, the thumbnails on acg-media.struffelproductions.com). Volter Editor
// searches and imports from both (../journeys/demand.json).
import type { VendorManifest } from '@volter/world-core';

export const manifest: VendorManifest = {
  vendor: 'ambientcg',
  discovery: {
    twinOf: "ambientCG's public asset catalog as Volter Editor searches it: materials and HDRIs by keyword, their zips and thumbnails",
    stores: "the published assets and each file's bytes (zips and thumbnails)",
  },
  lanes: {
    routes: [
      { lane: 'media', host: '^acg-(download|media)\\.struffelproductions\\.com$' },
      { lane: 'api', host: '^(www\\.)?ambientcg\\.com$' },
    ],
    default: 'api',
  },
  descriptor: {
    protocol: '3',
    transport: 'rest',
    archetype: 'crud',
    bin: 'world-ambientcg',
    resources: ['asset'],
    specSource: "the v2 API's document written from docs.ambientcg.com (api/spec/SOURCE.md) and the file hosts' written from Backblaze's page (media/spec/SOURCE.md)",
    description: 'ambientCG twin — the public asset catalog (materials and HDRIs searched by type and keyword, sorted and paged; their zips behind the download redirect; their thumbnails), as Volter Editor\'s asset library searches and imports it.',
    adoption: { sdks: [], envStems: [] },
    hosts: [{ host: 'ambientcg.com' }, { host: 'acg-download.struffelproductions.com' }, { host: 'acg-media.struffelproductions.com' }],
    endpointEnvNone: 'the editor calls ambientcg.com and the urls it answers; the World claims the hosts',
  },
};
