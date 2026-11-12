// @volter/twin-ambientcg — the ambientcg twin (Protocol 3). A fixed file (create-pack): the descriptor is the manifest's, and the
// kernel derives the vendor-backed half from the generated surface, unless the manifest declares none (vendorBacked.none;
// architecture, "The real-system adapters").
import { packOf, registerPack, type DerivedSurface } from '@volter/world-core';
import { manifest } from './manifest.ts';
import { manifest as apiManifest } from '../api/src/manifest.ts';
import apiSurface from '../api/src/generated/surface.gen.json' with { type: 'json' };
import { manifest as mediaManifest } from '../media/src/manifest.ts';
import mediaSurface from '../media/src/generated/surface.gen.json' with { type: 'json' };

export { createAmbientcgFetch } from './fetch.ts';
export { createAmbientcgTwinServer } from './server.ts';
export { manifest };

export const pack = registerPack(packOf(manifest, { "api": { manifest: apiManifest, surface: apiSurface as unknown as DerivedSurface }, "media": { manifest: mediaManifest, surface: mediaSurface as unknown as DerivedSurface } }));
