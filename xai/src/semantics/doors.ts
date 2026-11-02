// The World's doors: what the xAI Console does.
//
//   POST /_twin/app-credentials     the application's key (the descriptor's credentialDoor), the same every boot
//   POST /_twin/api-keys { name }   a key, shown once (Console > API Keys > Create API key)
import type { HandlerContext } from '@volter/world-core';
import { heldKey, makeKey } from './shared.ts';

export async function appCredentials(ctx: HandlerContext): Promise<Response> {
  const account = await ctx.account();
  const name = account === 'default' ? 'world-app' : `world-app:${account}`;
  return Response.json({ api_key: (await heldKey(ctx, name)) ?? await makeKey(ctx, name, account) }, { status: 201 });
}

export async function apiKeys(ctx: HandlerContext): Promise<Response> {
  const b = (ctx.body && typeof ctx.body === 'object' ? ctx.body : {}) as Record<string, unknown>;
  if (typeof b.name !== 'string' || !b.name) return Response.json({ error: 'a name is required' }, { status: 400 });
  return Response.json({ key: await makeKey(ctx, b.name) }, { status: 201 });
}
