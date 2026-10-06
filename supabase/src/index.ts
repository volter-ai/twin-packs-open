// @volter/twin-supabase — the supabase twin (Protocol 3). A fixed file (create-pack): the descriptor is the manifest's, and the
// kernel derives the vendor-backed half from the generated surface (architecture, "The real-system adapters").
import { packOf, registerPack, type DerivedSurface } from '@volter/world-core';
import { manifest } from './manifest.ts';
import { manifest as authManifest } from '../auth/src/manifest.ts';
import authSurface from '../auth/src/generated/surface.gen.json' with { type: 'json' };
import { manifest as restManifest } from '../rest/src/manifest.ts';
import restSurface from '../rest/src/generated/surface.gen.json' with { type: 'json' };
import { manifest as storageManifest } from '../storage/src/manifest.ts';
import storageSurface from '../storage/src/generated/surface.gen.json' with { type: 'json' };
import surface from './generated/surface.gen.json' with { type: 'json' };

export { createSupabaseFetch } from './fetch.ts';
export { createSupabaseTwinServer } from './server.ts';
export { manifest };

export const pack = registerPack(packOf(manifest, surface as unknown as DerivedSurface, { "auth": { manifest: authManifest, surface: authSurface as unknown as DerivedSurface }, "rest": { manifest: restManifest, surface: restSurface as unknown as DerivedSurface }, "storage": { manifest: storageManifest, surface: storageSurface as unknown as DerivedSurface } }));
