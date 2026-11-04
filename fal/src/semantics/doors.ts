import { accountFor } from './tenant.ts';
import type { HandlerContext } from '@volter/world-core';
import { KEY, readKey, IMAGE, makeKey } from './shared.ts';
// source: https://fal.ai/docs/api-reference/platform-apis/authentication.md "generate a key from the UI"
export async function appCredentials(ctx: HandlerContext): Promise<Response> {
  const owner = await accountFor(ctx);
  const key = await ctx.accountKey('api-key', KEY, {
    make: () => makeKey(ctx, ctx.deployment() || 'world-app', String(owner.id)),
    read: (row) => row._account === owner.id ? readKey(ctx, row) : Promise.resolve(undefined),
  });
  return Response.json({ api_key: key.secret }, { status: 201 });
}
// source: spec:/components/schemas/File "The URL where the file can be downloaded from."
export async function media(ctx: HandlerContext): Promise<Response> {
  const id = String(ctx.call.params.name ?? '').replace(/\.png$/, '');
  const row = ctx.get(IMAGE, id);
  const bytes = row ? await ctx.blobs.get(String(row.blob)) : null;
  return bytes ? new Response(new Uint8Array(bytes), { headers: { 'content-type': 'image/png' } }) : new Response('Not Found', { status: 404 });
}
