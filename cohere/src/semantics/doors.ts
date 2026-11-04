// The World's doors: what Cohere's dashboard (API Keys) does.
//
//   POST /_twin/app-credentials     the application's key (the descriptor's credentialDoor), the same every boot
import type { HandlerContext } from '@volter/world-core';
import { KEY, makeKey, readKey } from './shared.ts';

// source: https://docs.cohere.com/docs/rate-limits "You can create a trial or production key on the API keys page"
export async function appCredentials(ctx: HandlerContext): Promise<Response> {
  const organization = await ctx.tenant('_organization', async (world) => {
    const owner = await ctx.createUnique('_owner', { email: world.members[0]!.toLowerCase() }, 'owner.create', { input: 'omit' });
    return String((await ctx.create('_organization', { name: world.label, owner_id: owner.row.id }, 'organization.create')).id);
  });
  const key = await ctx.accountKey(`api-key:${organization.id}`, KEY, {
    make: () => makeKey(ctx, ctx.deployment() || 'world-app', organization),
    read: (row) => row.organization_id === organization.id && row.owner_id === organization.owner_id ? readKey(ctx, row) : Promise.resolve(undefined),
  });
  return Response.json({ api_key: key.secret }, { status: 201 });
}

