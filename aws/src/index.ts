// @volter/twin-aws — the aws twin (Protocol 3). A fixed file (create-pack): the descriptor is the manifest's, and the
// kernel derives the vendor-backed half from the generated surface, unless the manifest declares none (vendorBacked.none;
// architecture, "The real-system adapters").
import { packOf, registerPack, type DerivedSurface } from '@volter/world-core';
import { manifest } from './manifest.ts';
import { manifest as s3Manifest } from '../s3/src/manifest.ts';
import s3Surface from '../s3/src/generated/surface.gen.json' with { type: 'json' };
import { manifest as secretsmanagerManifest } from '../secretsmanager/src/manifest.ts';
import secretsmanagerSurface from '../secretsmanager/src/generated/surface.gen.json' with { type: 'json' };

export { createAwsFetch } from './fetch.ts';
export { createAwsTwinServer } from './server.ts';
export { manifest };

export const pack = registerPack(packOf(manifest, { "s3": { manifest: s3Manifest, surface: s3Surface as unknown as DerivedSurface }, "secretsmanager": { manifest: secretsmanagerManifest, surface: secretsmanagerSurface as unknown as DerivedSurface } }));
