// Extract held web content; an unknown or timed-out URL is a per-URL failure, with no live fetch.
import type { HandlerContext } from '@volter/world-core';
import { chunks, webPage, pageContent, pageImages, tavilyError, type Row } from './shared.ts';

// source: spec:extract "Successful URLs appear in results; per-URL failures appear in failed_results."
export async function extract(ctx: HandlerContext): Promise<Response> {
  const invalid = ctx.validate();
  // source: spec:extract "Bad Request."
  // Extraction documents the 400 class; reuse native schema validation and render that class.
  if (invalid) return tavilyError(400, 'Invalid extraction parameters.');
  const b = ctx.body as Row;
  const urls: unknown[] = typeof b.urls === 'string' ? [b.urls] : Array.isArray(b.urls) ? b.urls : [];
  if (urls.some((url) => typeof url !== 'string')) return tavilyError(400, 'URLs must be strings.');
  // source: spec:extract "More than 20 URLs, an empty URL list, or no URLs passing validation are rejected."
  if (!urls.length) return tavilyError(400, 'urls is missing.');
  if (urls.length > 20) return tavilyError(400, 'Max 20 URLs are allowed.');
  const valid = (url: unknown): boolean => typeof url === 'string' && URL.canParse(url) && ['http:', 'https:'].includes(new URL(url).protocol);
  const bad = urls.filter((u) => !valid(u)).map((url) => ({ url, error: 'Validation Error: Invalid URL format' }));
  // source: spec:extract "When all URLs fail validation, detail.failed_results describes the individual failures."
  if (bad.length === urls.length) return Response.json({ detail: { error: 'All URLs failed validation.', failed_results: bad } }, { status: 400 });
  // source: spec:extract "extraction retrieves more data, including tables and embedded content"
  const depth = b.extract_depth ?? 'basic';
  if (!['basic', 'advanced'].includes(String(depth))) return tavilyError(400, 'Invalid extract_depth.');
  // source: spec:extract "returns plain text"
  if (!['markdown', 'text'].includes(String(b.format ?? 'markdown'))) return tavilyError(400, 'Invalid format.');
  const results: Row[] = [];
  const failed: Row[] = [...bad];
  // source: spec:extract "default timeouts are applied based on extract_depth: 10 seconds for basic extraction and 30 seconds for advanced extraction."
  const timeout = Number(b.timeout ?? (depth === 'advanced' ? 30 : 10));
  for (const url of urls.filter(valid)) {
    const held = await webPage(ctx, String(url));
    if (!held || Number(held.fetch_seconds ?? 0) > timeout) { failed.push({ url, error: 'Failed to retrieve content' }); continue; }
    const content = pageContent(held, b.format, depth === 'advanced');
    // source: spec:extract "When provided, chunks are reranked based on relevance to this query."
    results.push({ url, raw_content: b.query ? chunks(content, String(b.query), Number(b.chunks_per_source ?? 3)) : content,
      // source: spec:extract "A list of image URLs extracted from the page."
      images: b.include_images === true ? pageImages(held).map((i) => i.url) : [],
      ...(b.include_favicon === true && held.favicon ? { favicon: held.favicon } : {}),
    });
  }
  // source: https://docs.tavily.com/documentation/api-credits.md "Every 5 successful URL extractions cost"
  // The corpus's account keeps successful counts separately by depth; failed extractions consume no credits.
  const usageRow = ctx.rowsRaw('_extract_usage').find((p) => p.depth === depth);
  const previous = Number(usageRow?.successes ?? 0);
  const total = previous + results.length;
  await ctx.record('_extract_usage', { depth, successes: total }, usageRow ? String(usageRow.id) : ctx.mint('_extract_usage'));
  const credits = (Math.floor(total / 5) - Math.floor(previous / 5)) * (depth === 'advanced' ? 2 : 1);
  return Response.json({ results, failed_results: failed, response_time: 0.01,
    request_id: ctx.crypto.uuidFrom(`tavily-extract:${await ctx.issue('_request')}`),
    // source: spec:extract "Whether to include credit usage information in the response."
    ...(b.include_usage === true ? { usage: { credits } } : {}),
  });
}
