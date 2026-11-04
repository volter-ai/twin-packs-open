// @volter/twin-googlefonts — the googlefonts twin (Protocol 3). A fixed file (create-pack): the descriptor is the manifest's, and the
// kernel derives the vendor-backed half from the generated surface, unless the manifest declares none (vendorBacked.none;
// architecture, "The real-system adapters").
import { packOf, registerPack, type DerivedSurface } from '@volter/world-core';
import { manifest } from './manifest.ts';
import { manifest as apiManifest } from '../api/src/manifest.ts';
import apiSurface from '../api/src/generated/surface.gen.json' with { type: 'json' };
import { manifest as assetsManifest } from '../assets/src/manifest.ts';
import assetsSurface from '../assets/src/generated/surface.gen.json' with { type: 'json' };
import { manifest as cssManifest } from '../css/src/manifest.ts';
import cssSurface from '../css/src/generated/surface.gen.json' with { type: 'json' };

export { createGooglefontsFetch } from './fetch.ts';
export { createGooglefontsTwinServer } from './server.ts';
export { manifest };

export const pack = registerPack(packOf(manifest, { "api": { manifest: apiManifest, surface: apiSurface as unknown as DerivedSurface }, "assets": { manifest: assetsManifest, surface: assetsSurface as unknown as DerivedSurface }, "css": { manifest: cssManifest, surface: cssSurface as unknown as DerivedSurface } }));
