// @volter/twin-intercom — the intercom twin (Protocol 3). A fixed file (create-pack): the descriptor is the manifest's, and the
// kernel derives the vendor-backed half from the generated surface, unless the manifest declares none (vendorBacked.none;
// architecture, "The real-system adapters").
import { packOf, registerPack, type DerivedSurface } from '@volter/world-core';
import { manifest } from './manifest.ts';
import surface from './generated/surface.gen.json' with { type: 'json' };

export { createIntercomFetch } from './fetch.ts';
export { createIntercomTwinServer } from './server.ts';
export { manifest };

export const pack = registerPack(packOf(manifest, surface as unknown as DerivedSurface));
