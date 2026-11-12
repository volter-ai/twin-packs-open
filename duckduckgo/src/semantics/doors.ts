import { invalidPage, type HandlerContext, type Row } from './shared.ts';
// World setup publishes the external searchable web; no demanded vendor API publishes arbitrary web pages.
export async function pages(ctx: HandlerContext): Promise<Response> {
  const b = (ctx.body && typeof ctx.body === 'object' ? ctx.body : {}) as Row;
  if (typeof b.html !== 'string' || typeof b.indexText !== 'string' || typeof b.title !== 'string' || typeof b.href !== 'string' || typeof b.snippet !== 'string' || !b.html.includes('class="result__a"') || !b.html.includes('class="result__snippet"')) return invalidPage();
  const id = ctx.mint('page');
  await ctx.blobs.put('pages/' + id, new TextEncoder().encode(b.html));
  await ctx.write('page', id, { title: b.title, href: b.href, snippet: b.snippet, _indexText: b.indexText }, 'page.publish');
  return Response.json(ctx.get('page', id), { status: 201 });
}
