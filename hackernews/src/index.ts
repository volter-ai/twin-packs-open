// @volter/twin-hackernews — the hackernews twin (Protocol 3). A fixed file (create-pack): the descriptor is the manifest's, and the
// kernel derives the vendor-backed half from the generated surface, unless the manifest declares none (vendorBacked.none;
// architecture, "The real-system adapters").
import { packOf, registerPack, type DerivedSurface } from '@volter/world-core';
import { manifest } from './manifest.ts';
import { manifest as apiManifest } from '../api/src/manifest.ts';
import apiSurface from '../api/src/generated/surface.gen.json' with { type: 'json' };
import { manifest as siteManifest } from '../site/src/manifest.ts';
import siteSurface from '../site/src/generated/surface.gen.json' with { type: 'json' };

export { createHackernewsFetch } from './fetch.ts';
export { createHackernewsTwinServer } from './server.ts';
export { manifest };

export const pack = registerPack(packOf(manifest, { "api": { manifest: apiManifest, surface: apiSurface as unknown as DerivedSurface }, "site": { manifest: siteManifest, surface: siteSurface as unknown as DerivedSurface } }));
