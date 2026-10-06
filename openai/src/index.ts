// @volter/twin-openai — the openai twin (Protocol 3). A fixed file (create-pack): the descriptor is the manifest's, and the
// kernel derives the vendor-backed half from the generated surface, unless the manifest declares none (vendorBacked.none;
// architecture, "The real-system adapters").
import { packOf, registerPack, type DerivedSurface } from '@volter/world-core';
import { manifest } from './manifest.ts';
import { manifest as codexManifest } from '../codex/src/manifest.ts';
import codexSurface from '../codex/src/generated/surface.gen.json' with { type: 'json' };
import { manifest as mediaManifest } from '../media/src/manifest.ts';
import mediaSurface from '../media/src/generated/surface.gen.json' with { type: 'json' };
import surface from './generated/surface.gen.json' with { type: 'json' };

export { createOpenaiFetch } from './fetch.ts';
export { createOpenaiTwinServer } from './server.ts';
export { manifest };

export const pack = registerPack(packOf(manifest, surface as unknown as DerivedSurface, { "codex": { manifest: codexManifest, surface: codexSurface as unknown as DerivedSurface }, "media": { manifest: mediaManifest, surface: mediaSurface as unknown as DerivedSurface } }));
