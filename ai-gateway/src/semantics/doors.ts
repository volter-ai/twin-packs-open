// The World's doors: what the AI Gateway's API Keys page does.
//
//   POST /_twin/app-credentials     the application's key (the descriptor's credentialDoor), the same every boot
import type { HandlerContext } from '@volter/world-core';
import { heldKey, makeKey } from './shared.ts';

export async function appCredentials(ctx: HandlerContext): Promise<Response> {
  const account = await ctx.account();
  const name = account === 'default' ? 'world-app' : `world-app:${account}`;
  return Response.json({ api_key: (await heldKey(ctx, name)) ?? await makeKey(ctx, name, account) }, { status: 201 });
}

