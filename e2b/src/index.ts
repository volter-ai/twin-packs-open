// @volter/twin-e2b — the e2b twin (Protocol 3). A fixed file (create-pack): the descriptor is the manifest's, and the
// kernel derives the vendor-backed half from the generated surface, unless the manifest declares none (vendorBacked.none;
// architecture, "The real-system adapters").
import { packOf, registerPack, type DerivedSurface } from '@volter/world-core';
import { manifest } from './manifest.ts';
import { manifest as apiManifest } from '../api/src/manifest.ts';
import apiSurface from '../api/src/generated/surface.gen.json' with { type: 'json' };
import { manifest as envdManifest } from '../envd/src/manifest.ts';
import envdSurface from '../envd/src/generated/surface.gen.json' with { type: 'json' };
import { manifest as jupyterManifest } from '../jupyter/src/manifest.ts';
import jupyterSurface from '../jupyter/src/generated/surface.gen.json' with { type: 'json' };

export { createE2bFetch } from './fetch.ts';
export { createE2bTwinServer } from './server.ts';
export { manifest };

export const pack = registerPack(packOf(manifest, { "api": { manifest: apiManifest, surface: apiSurface as unknown as DerivedSurface }, "envd": { manifest: envdManifest, surface: envdSurface as unknown as DerivedSurface }, "jupyter": { manifest: jupyterManifest, surface: jupyterSurface as unknown as DerivedSurface } }));
