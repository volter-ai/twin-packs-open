// Dashboard credential bootstrap and the synthetic web corpus, which no Tavily operation creates.
import type { HandlerContext } from '@volter/world-core';
import { heldKey, makeKey, PAGE, type Row } from './shared.ts';

// source: https://docs.tavily.com/documentation/rate-limits.md "Create your Development or Production API keys."
export async function appCredentials(ctx: HandlerContext): Promise<Response> {
  return Response.json({ api_key: (await heldKey(ctx, 'world-app')) ?? await makeKey(ctx, 'world-app') }, { status: 201 });
}

// Door configuration refusals are local World authoring errors, not additional vendor API rules.
function invalidPage(message: string): Response {
  return Response.json({ error: message }, { status: 400 });
}

export async function pages(ctx: HandlerContext): Promise<Response> {
  const b = (ctx.body && typeof ctx.body === 'object' ? ctx.body : {}) as Row;
  if (typeof b.url !== 'string' || !URL.canParse(b.url) || !['http:', 'https:'].includes(new URL(b.url).protocol)) return invalidPage('url is an http(s) URL');
  if (typeof b.title !== 'string' || typeof b.content !== 'string') return invalidPage('title and content are strings');
  const topic = b.topic ?? 'general';
  if (!['general', 'news', 'finance'].includes(String(topic))) return invalidPage('topic is general, news or finance');
  const held = ctx.rowsRaw(PAGE).find((p) => p.url === b.url && p.deleted !== true);
  const id = held ? String(held.id) : ctx.mint(PAGE);
  await ctx.record(PAGE, { ...b, topic, published_date: b.published_date ?? null }, id);
  return Response.json({ url: b.url, id }, { status: 201 });
}
