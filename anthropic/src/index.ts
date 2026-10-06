// @volter/twin-anthropic — the anthropic twin (Protocol 3). A fixed file (create-pack): the descriptor is the manifest's, and the
// kernel derives the vendor-backed half from the generated surface (architecture, "The real-system adapters").
import { packOf, registerPack, type DerivedSurface } from '@volter/world-core';
import { manifest } from './manifest.ts';
import surface from './generated/surface.gen.json' with { type: 'json' };

export { createAnthropicFetch } from './fetch.ts';
export { createAnthropicTwinServer } from './server.ts';
export { manifest };

export const pack = registerPack(packOf(manifest, surface as unknown as DerivedSurface));
