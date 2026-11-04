// The World's doors (architecture, "Doors, screens and the gap"): what Google AI Studio's pages do.
//
//   POST /_twin/app-credentials      the application's API key (the descriptor's credentialDoor), the same every boot
//   POST /_twin/api-keys { name }    an API key, shown once (Get API key > Create API key)
import type { HandlerContext } from '@volter/world-core';
import { KEY, keyProject, makeKey, readKey } from './shared.ts';

/** The World application's key, made the first time and answered from secret custody on later boots. */
export async function appCredentials(ctx: HandlerContext): Promise<Response> {
  const project = await keyProject(ctx);
  const key = await ctx.accountKey(`api-key:${project.id}`, KEY, {
    make: () => makeKey(ctx, ctx.deployment() || 'world-app', project),
    read: (row) => row.project === project.id ? readKey(ctx, row) : Promise.resolve(undefined),
  });
  return Response.json({ api_key: key.secret }, { status: 201 });
}

export async function apiKeys(ctx: HandlerContext): Promise<Response> {
  const b = (ctx.body && typeof ctx.body === 'object' ? ctx.body : {}) as Record<string, unknown>;
  if (typeof b.name !== 'string' || !b.name) return invalidKeyName();
  const id = await makeKey(ctx, b.name, await keyProject(ctx));
  return Response.json({ key: await readKey(ctx, ctx.row(KEY, id)!) }, { status: 201 });
}

// This is the World's credential-console guard, outside the vendor API surface.
function invalidKeyName(): Response {
  return Response.json({ error: 'a name is required' }, { status: 400 });
}
