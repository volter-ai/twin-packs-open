// @volter/twin-github — the github twin (Protocol 3). A fixed file (create-pack): the descriptor is the manifest's, and the
// kernel derives the vendor-backed half from the generated surface, unless the manifest declares none (vendorBacked.none;
// architecture, "The real-system adapters").
import { packOf, registerPack, type DerivedSurface } from '@volter/world-core';
import { manifest } from './manifest.ts';
import surface from './generated/surface.gen.json' with { type: 'json' };
import schema from './generated/graphql-sdl.gen.json' with { type: 'json' };

export { createGithubFetch } from './fetch.ts';
export { createGithubTwinServer } from './server.ts';
export { answerViews } from './semantics/answer-views.ts';
export { manifest };

export const pack = registerPack(packOf(manifest, { ...surface, graphql: { sdl: schema.sdl } } as unknown as DerivedSurface));
