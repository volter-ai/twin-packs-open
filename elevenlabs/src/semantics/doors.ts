// The World's doors: what ElevenLabs' console does.
//
//   POST /_twin/app-credentials                 the application's key (the descriptor's credentialDoor), the same every boot
import type { HandlerContext } from '@volter/world-core';
import { accountFor, KEY, readKey, makeKey } from './shared.ts';

export async function appCredentials(ctx: HandlerContext): Promise<Response> {
  const owner = await accountFor(ctx);
  const key = await ctx.accountKey('api-key', KEY, {
    make: () => makeKey(ctx, ctx.deployment() || 'world-app', String(owner.id)),
    read: (row) => row._workspace === owner.id ? readKey(ctx, row) : Promise.resolve(undefined),
  });
  return Response.json({ api_key: key.secret }, { status: 201 });
}

