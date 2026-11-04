// @volter/twin-tiktok — the tiktok twin (Protocol 3). A fixed file (create-pack): the descriptor is the manifest's, and the
// kernel derives the vendor-backed half from the generated surface, unless the manifest declares none (vendorBacked.none;
// architecture, "The real-system adapters").
import { packOf, registerPack, type DerivedSurface } from '@volter/world-core';
import { manifest } from './manifest.ts';
import { manifest as businessManifest } from '../business/src/manifest.ts';
import businessSurface from '../business/src/generated/surface.gen.json' with { type: 'json' };
import { manifest as openManifest } from '../open/src/manifest.ts';
import openSurface from '../open/src/generated/surface.gen.json' with { type: 'json' };

export { createTiktokFetch } from './fetch.ts';
export { createTiktokTwinServer } from './server.ts';
export { manifest };

export const pack = registerPack(packOf(manifest, { "business": { manifest: businessManifest, surface: businessSurface as unknown as DerivedSurface }, "open": { manifest: openManifest, surface: openSurface as unknown as DerivedSurface } }));
