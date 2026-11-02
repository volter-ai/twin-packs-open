// @volter/twin-planetscale — the planetscale twin (Protocol 3). A fixed file (create-pack): the descriptor is the manifest's, and the
// kernel derives the vendor-backed half from the generated surface, unless the manifest declares none (vendorBacked.none;
// architecture, "The real-system adapters").
import { packOf, registerPack, type DerivedSurface } from '@volter/world-core';
import { manifest } from './manifest.ts';
import { manifest as apiManifest } from '../api/src/manifest.ts';
import apiSurface from '../api/src/generated/surface.gen.json' with { type: 'json' };
import surface from './generated/surface.gen.json' with { type: 'json' };

export { createPlanetscaleFetch } from './fetch.ts';
export { createPlanetscaleTwinServer } from './server.ts';
export { createPlanetscaleTwinStream } from './stream.ts';
export { answerViews } from './semantics/answer-views.ts';
export { manifest };

export const pack = registerPack(packOf(manifest, surface as unknown as DerivedSurface, { "api": { manifest: apiManifest, surface: apiSurface as unknown as DerivedSurface } }));
