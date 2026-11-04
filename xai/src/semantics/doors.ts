// The World's doors: what the xAI Console does.
//
//   POST /_twin/app-credentials     the application's key (the descriptor's credentialDoor), the same every boot
//   POST /_twin/api-keys { name }   a key, shown once (Console > API Keys > Create API key)
import type { HandlerContext } from '@volter/world-core';
import { KEY, keyTeam, makeKey, readKey } from './shared.ts';

export async function appCredentials(ctx: HandlerContext): Promise<Response> {
  const team = await keyTeam(ctx);
  const key = await ctx.accountKey(`api-key:${team.id}`, KEY, {
    make: () => makeKey(ctx, ctx.deployment() || 'world-app', team),
    read: (row) => row.teamId === team.id && row.userId === team.owner ? readKey(ctx, row) : Promise.resolve(undefined),
  });
  return Response.json({ api_key: key.secret }, { status: 201 });
}

export async function apiKeys(ctx: HandlerContext): Promise<Response> {
  const b = (ctx.body && typeof ctx.body === 'object' ? ctx.body : {}) as Record<string, unknown>;
  if (typeof b.name !== 'string' || !b.name) return Response.json({ error: 'a name is required' }, { status: 400 });
  const id = await makeKey(ctx, b.name, await keyTeam(ctx));
  return Response.json({ key: await readKey(ctx, ctx.row(KEY, id)!) }, { status: 201 });
}
