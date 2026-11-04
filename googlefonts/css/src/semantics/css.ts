import type { HandlerContext } from '@volter/world-core';
import { CATALOG, CSS, cssKey, htmlError } from './shared.ts';

// source: spec:getStylesheet "The representation is selected for the requesting browser."
export async function getStylesheet(ctx: HandlerContext): Promise<Response> {
  const query = new URL(ctx.call.request.url).searchParams;
  const family = query.get('family'), subset = query.get('subset') ?? 'latin';
  if (!family || [...query.keys()].some(k => !['family','subset'].includes(k)))
    return htmlError(400, 'Bad font request');
  const generation = ctx.row(CATALOG, 'published')?.fingerprint;
  const key = cssKey(ctx, family, subset, ctx.call.request.headers.get('user-agent') ?? '');
  const row = generation === undefined ? undefined : ctx.row(CSS, String(generation) + ':' + key);
  // Where the documentation stops: no supplied representation is a named
  // refusal, not an invented conversion or another browser's font format.
  if (!row) return htmlError(400, 'Font family or browser representation is not published');
  const body = await ctx.blobs.get(String(row.blob));
  if (!body) return htmlError(404, 'Font stylesheet not found');
  return new Response(Uint8Array.from(body).buffer, { headers: { 'content-type': 'text/css; charset=utf-8', 'content-length': String(body.length), 'vary': 'User-Agent' } });
}
