// @volter/twin-hyperdx — the hyperdx twin (Protocol 3). A fixed file (create-pack): the descriptor is the manifest's, and the
// kernel derives the vendor-backed half from the generated surface, unless the manifest declares none (vendorBacked.none;
// architecture, "The real-system adapters").
import { packOf, registerPack, type DerivedSurface } from '@volter/world-core';
import { manifest } from './manifest.ts';
import { manifest as apiManifest } from '../api/src/manifest.ts';
import apiSurface from '../api/src/generated/surface.gen.json' with { type: 'json' };
import { manifest as ingestManifest } from '../ingest/src/manifest.ts';
import ingestSurface from '../ingest/src/generated/surface.gen.json' with { type: 'json' };

export { createHyperdxFetch } from './fetch.ts';
export { createHyperdxTwinServer } from './server.ts';
export { manifest };

export const pack = registerPack(packOf(manifest, { "api": { manifest: apiManifest, surface: apiSurface as unknown as DerivedSurface }, "ingest": { manifest: ingestManifest, surface: ingestSurface as unknown as DerivedSurface } }));
