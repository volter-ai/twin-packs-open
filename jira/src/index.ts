// @volter/twin-jira — the jira twin (Protocol 3). A fixed file (create-pack): the descriptor is the manifest's, and the
// kernel derives the vendor-backed half from the generated surface (architecture, "The real-system adapters").
import { packOf, registerPack, type DerivedSurface } from '@volter/world-core';
import { manifest } from './manifest.ts';
import { manifest as authManifest } from '../auth/src/manifest.ts';
import authSurface from '../auth/src/generated/surface.gen.json' with { type: 'json' };
import { manifest as platformManifest } from '../platform/src/manifest.ts';
import platformSurface from '../platform/src/generated/surface.gen.json' with { type: 'json' };

export { createJiraFetch } from './fetch.ts';
export { createJiraTwinServer } from './server.ts';
export { manifest };

export const pack = registerPack(packOf(manifest, { "auth": { manifest: authManifest, surface: authSurface as unknown as DerivedSurface }, "platform": { manifest: platformManifest, surface: platformSurface as unknown as DerivedSurface } }));
