// @volter/twin-sigstore — the sigstore twin (Protocol 3). A fixed file (create-pack): the descriptor is the manifest's, and the
// kernel derives the vendor-backed half from the generated surface, unless the manifest declares none (vendorBacked.none;
// architecture, "The real-system adapters").
import { packOf, registerPack, type DerivedSurface } from '@volter/world-core';
import { manifest } from './manifest.ts';
import { manifest as fulcioManifest } from '../fulcio/src/manifest.ts';
import fulcioSurface from '../fulcio/src/generated/surface.gen.json' with { type: 'json' };
import { manifest as rekorManifest } from '../rekor/src/manifest.ts';
import rekorSurface from '../rekor/src/generated/surface.gen.json' with { type: 'json' };

export { createSigstoreFetch } from './fetch.ts';
export { createSigstoreTwinServer } from './server.ts';
export { manifest };

export const pack = registerPack(packOf(manifest, { "fulcio": { manifest: fulcioManifest, surface: fulcioSurface as unknown as DerivedSurface }, "rekor": { manifest: rekorManifest, surface: rekorSurface as unknown as DerivedSurface } }));
