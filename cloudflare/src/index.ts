// @volter/twin-cloudflare — the cloudflare twin (Protocol 3). A fixed file (create-pack): the descriptor is the manifest's, and the
// kernel derives the vendor-backed half from the generated surface, unless the manifest declares none (vendorBacked.none;
// architecture, "The real-system adapters").
import { packOf, registerPack, type DerivedSurface } from '@volter/world-core';
import { manifest } from './manifest.ts';
import { manifest as apiManifest } from '../api/src/manifest.ts';
import apiSurface from '../api/src/generated/surface.gen.json' with { type: 'json' };
import { manifest as r2Manifest } from '../r2/src/manifest.ts';
import r2Surface from '../r2/src/generated/surface.gen.json' with { type: 'json' };

export { createCloudflareFetch } from './fetch.ts';
export { createCloudflareTwinServer } from './server.ts';
export { manifest };

export const pack = registerPack(packOf(manifest, { "api": { manifest: apiManifest, surface: apiSurface as unknown as DerivedSurface }, "r2": { manifest: r2Manifest, surface: r2Surface as unknown as DerivedSurface } }));
