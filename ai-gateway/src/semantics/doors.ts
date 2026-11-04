// The World's doors: what the AI Gateway's API Keys page does.
//
//   POST /_twin/app-credentials     the application's key (the descriptor's credentialDoor), the same every boot
import type { HandlerContext } from '@volter/world-core';
import { KEY, makeKey, readKey } from './shared.ts';

export async function appCredentials(ctx: HandlerContext): Promise<Response> {
  const team = await ctx.tenant('_team', (organization) => ctx.record('_team', { name: organization.label, owner: organization.members[0]!.toLowerCase() }));
  const name = ctx.deployment() || 'world-app';
  const key = await ctx.accountKey('api-key', KEY, {
    make: () => makeKey(ctx, name, team),
    read: (row) => row._team === team.id ? readKey(ctx, row) : Promise.resolve(undefined),
  });
  return Response.json({ api_key: key.secret }, { status: 201 });
}

