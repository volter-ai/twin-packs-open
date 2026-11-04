import type { HandlerContext } from '@volter/world-core';
import { CATALOG, CSS, css2Key, css2Query, htmlError } from './shared.ts';

// source: spec:getStylesheet2 "To request multiple families, specify the family= param for each family."
export async function getStylesheet2(ctx: HandlerContext): Promise<Response> {
  const pairs = css2Query(new URL(ctx.call.request.url).searchParams);
  if (!pairs) return htmlError(400, 'Bad font request');
  const generation = ctx.row(CATALOG, 'published')?.fingerprint;
  const userAgent = ctx.call.request.headers.get('user-agent') ?? '';
  const sheet = (agent: string) => generation === undefined ? undefined : ctx.row(CSS, String(generation) + ':' + css2Key(ctx, pairs, agent));
  // Where the evidence stops: Google answered the same truetype stylesheet to no User-Agent, "node" and "undici"
  // (vendor/inter.json). A request whose agent is not a browser's ("Mozilla/...") and has no representation of its
  // own reads the one published for no agent; a browser without its own representation is refused, never sent
  // another browser's format.
  const row = sheet(userAgent) ?? (userAgent.startsWith('Mozilla/') ? undefined : sheet(''));
  if (!row) return htmlError(400, 'Font family or browser representation is not published');
  const body = await ctx.blobs.get(String(row.blob));
  if (!body) return htmlError(404, 'Font stylesheet not found');
  return new Response(Uint8Array.from(body).buffer, { headers: { 'content-type': 'text/css; charset=utf-8', 'content-length': String(body.length), 'access-control-allow-origin': '*' } });
}
