// Poly Haven's manifest: a vendor of two lanes (architecture, "Other wires: lanes"): its catalog API (`api`,
// api.polyhaven.com: assets, their files, categories) and the hosts its answers point at (`dl`: dl.polyhaven.org, the
// ph-assets bucket the files are downloaded from, and cdn.polyhaven.com, the thumbnails). Volter Editor
// browses and imports from both (../journeys/demand.json).
import type { VendorManifest } from '@volter/world-core';

export const manifest: VendorManifest = {
  vendor: 'polyhaven',
  discovery: {
    twinOf: "Poly Haven's public asset catalog as Volter Editor browses it: assets by type and category, an asset's files, and the files and thumbnails themselves",
    stores: 'the published assets with their files trees, each file\'s bytes, and each thumbnail',
  },
  lanes: {
    routes: [
      { lane: 'dl', host: '^(dl\\.polyhaven\\.org|cdn\\.polyhaven\\.com)$' },
      { lane: 'api', host: '^api\\.polyhaven\\.com$' },
    ],
    default: 'api',
  },
  descriptor: {
    protocol: '3',
    transport: 'rest',
    archetype: 'crud',
    bin: 'world-polyhaven',
    resources: ['asset'],
    specSource: "Poly Haven's OpenAPI document (api/spec/SOURCE.md) and the download hosts' document written from it and Backblaze's page (dl/spec/SOURCE.md)",
    description: "Poly Haven twin — the public asset catalog (assets by type and category, an asset's files, their downloads and thumbnails), as Volter Editor's asset library browses and imports it.",
    adoption: { sdks: [], envStems: [] },
    hosts: [{ host: 'api.polyhaven.com' }, { host: 'dl.polyhaven.org' }, { host: 'cdn.polyhaven.com' }],
    endpointEnvNone: 'the editor calls api.polyhaven.com and the urls it answers; the World claims the hosts',
  },
};
