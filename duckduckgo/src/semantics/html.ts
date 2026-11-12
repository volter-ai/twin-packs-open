import { fallback, render, type HandlerContext } from './shared.ts';
// source: recording:results.html "result__a"
// source: recording:results.html "result__snippet"
export async function searchHtml(ctx: HandlerContext): Promise<Response> {
  const query = new URL(ctx.call.request.url).searchParams.get('q') ?? '';
  // Corpus selection is deterministic World input; vendor ranking is not established.
  const terms = query.toLocaleLowerCase('en-US').split(/\s+/).filter(Boolean);
  const matches = ctx.rowsRaw('page').filter(row => terms.length > 0 && terms.some(term => String(row._indexText).toLocaleLowerCase('en-US').includes(term)));
  // No no-results response was obtained; the source-limited empty flow takes the recorded gap.
  if (matches.length === 0) return fallback();
  const blocks: string[] = [];
  for (const row of matches) {
    const bytes = await ctx.blobs.get('pages/' + row.id);
    if (bytes === null) throw new Error('World page has no stored HTML blob');
    blocks.push(new TextDecoder().decode(bytes));
  }
  return render(query, blocks);
}
