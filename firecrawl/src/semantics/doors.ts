// The World's doors: what Firecrawl's dashboard does, and the pages the World knows.
//
//   POST /_twin/app-credentials                       the application's key (the descriptor's credentialDoor)
//   POST /_twin/pages { url, html, title? }            a page on the World's web (its markdown is derived from its html);
//                                                     the same URL again replaces it
import type { HandlerContext } from '@volter/world-core';
import { accountFor, KEY, readKey, makeKey, PAGE } from './shared.ts';

type Row = Record<string, unknown>;
const bodyOf = (ctx: HandlerContext): Row => (ctx.body && typeof ctx.body === 'object' ? ctx.body : {}) as Row;

export async function appCredentials(ctx: HandlerContext): Promise<Response> {
  const owner = await accountFor(ctx);
  const key = await ctx.accountKey('api-key', KEY, {
    make: () => makeKey(ctx, ctx.deployment() || 'world-app', String(owner.id)),
    read: (row) => row._team === owner.id ? readKey(ctx, row) : Promise.resolve(undefined),
  });
  return Response.json({ api_key: key.secret }, { status: 201 });
}


export async function pages(ctx: HandlerContext): Promise<Response> {
  const b = bodyOf(ctx);
  if (typeof b.url !== 'string' || !/^https?:\/\//.test(b.url)) return Response.json({ error: 'url is an http(s) URL' }, { status: 400 });
  if (typeof b.html !== 'string') return Response.json({ error: 'html is a string' }, { status: 400 });
  const existing = ctx.rowsRaw(PAGE).find((p) => p.deleted !== true && p.url === b.url);
  const id = String(existing?.id ?? ctx.mint(PAGE));
  await ctx.record(PAGE, { url: b.url, title: typeof b.title === 'string' ? b.title : '', html: b.html, put: ctx.occurredAt }, id);
  return Response.json({ url: b.url, id }, { status: 201 });
}
