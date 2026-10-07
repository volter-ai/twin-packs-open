// @volter/twin-clerk — the clerk twin (Protocol 3). A fixed file (create-pack): the descriptor is the manifest's, and the
// kernel derives the vendor-backed half from the generated surface, unless the manifest declares none (vendorBacked.none;
// architecture, "The real-system adapters").
import { packOf, registerPack, type DerivedSurface } from '@volter/world-core';
import { manifest } from './manifest.ts';
import { manifest as fapiManifest } from '../fapi/src/manifest.ts';
import fapiSurface from '../fapi/src/generated/surface.gen.json' with { type: 'json' };
import surface from './generated/surface.gen.json' with { type: 'json' };

export { createClerkFetch } from './fetch.ts';
export { createClerkTwinServer } from './server.ts';
export { answerViews } from './semantics/answer-views.ts';
export { manifest };

export const pack = registerPack(packOf(manifest, surface as unknown as DerivedSurface, { "fapi": { manifest: fapiManifest, surface: fapiSurface as unknown as DerivedSurface } }));
